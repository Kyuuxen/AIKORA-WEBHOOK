const axios = require("axios");

// ═══════════════════════════════════════════════════════════════════════════════
// AIKORA SELF-LEARNING SECURITY SYSTEM
// Learns from every interaction and gets smarter over time
// ═══════════════════════════════════════════════════════════════════════════════

const JSONBIN_KEY = process.env.JSONBIN_KEY;
const JSONBIN_BIN = process.env.JSONBIN_BIN;

// ── In-memory security brain ──────────────────────────────────────────────────
if (!global.securityBrain) {
  global.securityBrain = {
    // Learned threat patterns from past attacks
    learnedPatterns:   [],
    // User threat scores (uid -> score)
    threatScores:      new Map(),
    // Banned users (uid -> { reason, time, expires })
    banned:            new Map(),
    // Muted users (uid -> { reason, time, expires })
    muted:             new Map(),
    // Warned users (uid -> count)
    warnings:          new Map(),
    // Message history per user for flood detection (uid -> [timestamps])
    msgHistory:        new Map(),
    // Known spam messages (hash -> count)
    spamMessages:      new Map(),
    // Session log
    sessionLog:        [],
    // Stats
    stats: {
      totalAnalyzed:   0,
      threatsDetected: 0,
      autoBlocked:     0,
      learned:         0,
      lastSave:        null,
    },
    // Last DB load time
    lastLoad: 0,
  };
}
const brain = global.securityBrain;

// ── Known threat patterns (seed — grows as bot learns) ───────────────────────
const SEED_PATTERNS = [
  // Spam/flood
  { type: "spam",        pattern: /(.+)\1{4,}/i,                    score: 40, label: "Repeated text spam" },
  // Phishing links
  { type: "phishing",    pattern: /bit\.ly|tinyurl|is\.gd|t\.co/i,  score: 30, label: "Shortened link (possible phishing)" },
  // Scam keywords
  { type: "scam",        pattern: /send money|gcash|load|palitan|free coins|won a prize|claim now/i, score: 50, label: "Scam keywords" },
  // SQL injection
  { type: "injection",   pattern: /('\s*(or|and)\s*'?\d)|(--)|(;.*drop|insert|select|update|delete)/i, score: 80, label: "SQL injection attempt" },
  // XSS
  { type: "xss",         pattern: /<script|javascript:|onerror=|onload=|alert\(/i, score: 80, label: "XSS attempt" },
  // Impersonation
  { type: "impersonation", pattern: /i am (admin|owner|bot|aikora)|im the admin|i'm admin/i, score: 60, label: "Impersonation attempt" },
  // NSFW
  { type: "nsfw",        pattern: /porn|nude|naked|sex video|onlyfans/i, score: 45, label: "NSFW content" },
  // Hate speech
  { type: "hate",        pattern: /\b(kill yourself|kys|go die|i will hurt|i will kill)\b/i, score: 70, label: "Threatening language" },
];

// ── Utility: simple text hash ─────────────────────────────────────────────────
function hashText(text) {
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = (Math.imul(31, h) + text.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(16);
}

// ── Load brain from JSONBin ───────────────────────────────────────────────────
async function loadBrain() {
  if (!JSONBIN_KEY || !JSONBIN_BIN) return;
  // Only reload every 5 minutes
  if (Date.now() - brain.lastLoad < 5 * 60 * 1000) return;
  try {
    const res = await axios.get(
      "https://api.jsonbin.io/v3/b/" + JSONBIN_BIN + "/latest",
      { headers: { "X-Master-Key": JSONBIN_KEY }, timeout: 10000 }
    );
    const data = res.data && res.data.record && res.data.record.security;
    if (!data) return;

    // Restore learned patterns
    if (data.learnedPatterns) {
      brain.learnedPatterns = data.learnedPatterns;
    }
    // Restore bans
    if (data.banned) {
      data.banned.forEach(function(b) {
        if (!b.expires || b.expires > Date.now()) {
          brain.banned.set(b.uid, b);
        }
      });
    }
    // Restore warnings
    if (data.warnings) {
      data.warnings.forEach(function(w) {
        brain.warnings.set(w.uid, w.count);
      });
    }
    // Restore threat scores
    if (data.threatScores) {
      data.threatScores.forEach(function(t) {
        brain.threatScores.set(t.uid, t.score);
      });
    }
    // Restore stats
    if (data.stats) brain.stats = Object.assign(brain.stats, data.stats);

    // Auto-unban any admin who got accidentally banned
    const adminIds = (process.env.ADMIN_IDS || "").split(",").map(function(id) { return id.trim(); }).filter(Boolean);
    adminIds.forEach(function(aid) {
      if (brain.banned.has(aid)) {
        brain.banned.delete(aid);
        brain.warnings.delete(aid);
        brain.threatScores.delete(aid);
        console.log("[Security] Auto-unbanned admin: " + aid);
      }
    });

    brain.lastLoad = Date.now();
    console.log("[Security] Brain loaded — " + brain.learnedPatterns.length + " learned patterns, " + brain.banned.size + " bans");
  } catch(e) {
    console.log("[Security] Brain load failed:", e.message);
  }
}

// ── Save brain to JSONBin ─────────────────────────────────────────────────────
async function saveBrain() {
  if (!JSONBIN_KEY || !JSONBIN_BIN) return;
  try {
    // Load existing bin data first to not overwrite other data
    let existing = {};
    try {
      const r = await axios.get(
        "https://api.jsonbin.io/v3/b/" + JSONBIN_BIN + "/latest",
        { headers: { "X-Master-Key": JSONBIN_KEY }, timeout: 10000 }
      );
      existing = r.data && r.data.record ? r.data.record : {};
    } catch(e) {}

    existing.security = {
      learnedPatterns: brain.learnedPatterns.slice(-200), // keep last 200
      banned: Array.from(brain.banned.entries()).map(function(e) {
        return Object.assign({ uid: e[0] }, e[1]);
      }),
      warnings: Array.from(brain.warnings.entries()).map(function(e) {
        return { uid: e[0], count: e[1] };
      }),
      threatScores: Array.from(brain.threatScores.entries()).map(function(e) {
        return { uid: e[0], score: e[1] };
      }),
      stats: brain.stats,
      savedAt: new Date().toISOString(),
    };

    await axios.put(
      "https://api.jsonbin.io/v3/b/" + JSONBIN_BIN,
      existing,
      { headers: { "X-Master-Key": JSONBIN_KEY, "Content-Type": "application/json" }, timeout: 10000 }
    );
    brain.stats.lastSave = new Date().toISOString();
    console.log("[Security] Brain saved");
  } catch(e) {
    console.log("[Security] Brain save failed:", e.message);
  }
}

// ── Learn new pattern from confirmed threat ───────────────────────────────────
function learnPattern(text, type, label) {
  // Extract key phrases (3+ word sequences) from threat message
  const words  = text.toLowerCase().split(/\s+/).filter(function(w) { return w.length > 2; });
  if (words.length < 2) return;

  // Take a 2-3 word phrase as the learned pattern
  const phrase = words.slice(0, 3).join(" ");
  const exists = brain.learnedPatterns.find(function(p) { return p.phrase === phrase; });

  if (!exists) {
    brain.learnedPatterns.push({
      phrase:    phrase,
      type:      type,
      label:     label || "Learned threat pattern",
      score:     35,
      seenCount: 1,
      learnedAt: new Date().toISOString(),
    });
    brain.stats.learned++;
    console.log("[Security] Learned new pattern: '" + phrase + "' (" + type + ")");
  } else {
    // Pattern seen again — increase confidence score
    exists.seenCount++;
    exists.score = Math.min(90, exists.score + 5);
  }
}

// ── Analyze message for threats ───────────────────────────────────────────────
function analyzeMessage(uid, text) {
  const results  = [];
  let totalScore = 0;
  const lower    = text.toLowerCase();

  // 1. Check seed patterns
  for (let i = 0; i < SEED_PATTERNS.length; i++) {
    const p = SEED_PATTERNS[i];
    if (p.pattern.test(text)) {
      results.push({ type: p.type, label: p.label, score: p.score, source: "seed" });
      totalScore += p.score;
    }
  }

  // 2. Check learned patterns
  for (let i = 0; i < brain.learnedPatterns.length; i++) {
    const p = brain.learnedPatterns[i];
    if (lower.includes(p.phrase)) {
      results.push({ type: p.type, label: p.label + " (learned)", score: p.score, source: "learned" });
      totalScore += p.score;
      // Reinforce learning — seen again
      p.seenCount = (p.seenCount || 1) + 1;
    }
  }

  // 3. Flood detection — check message frequency
  const now       = Date.now();
  const history   = brain.msgHistory.get(uid) || [];
  const recent    = history.filter(function(t) { return now - t < 10000; }); // last 10 seconds
  recent.push(now);
  brain.msgHistory.set(uid, recent.slice(-20));

  if (recent.length >= 6) {
    results.push({ type: "flood", label: "Message flooding (" + recent.length + " msgs/10s)", score: 50, source: "flood" });
    totalScore += 50;
  } else if (recent.length >= 4) {
    results.push({ type: "flood", label: "Possible flooding", score: 20, source: "flood" });
    totalScore += 20;
  }

  // 4. Repeat spam detection
  const msgHash  = hashText(text.trim().toLowerCase());
  const spamCount = (brain.spamMessages.get(msgHash) || 0) + 1;
  brain.spamMessages.set(msgHash, spamCount);
  if (spamCount >= 3) {
    results.push({ type: "spam", label: "Same message repeated " + spamCount + " times", score: 40, source: "repeat" });
    totalScore += 40;
  }

  // 5. Apply user threat history (persistent bad actor)
  const pastScore = brain.threatScores.get(uid) || 0;
  if (pastScore > 100) {
    totalScore += 15; // past bad actor gets extra scrutiny
  }

  return { results, totalScore, isThreat: totalScore >= 50 };
}

// ── Update user threat score ──────────────────────────────────────────────────
function updateThreatScore(uid, delta) {
  const current = brain.threatScores.get(uid) || 0;
  const newScore = Math.max(0, current + delta);
  brain.threatScores.set(uid, newScore);
  return newScore;
}

// ── Check if user is banned ───────────────────────────────────────────────────
function isBanned(uid) {
  const ban = brain.banned.get(uid);
  if (!ban) return false;
  if (ban.expires && ban.expires < Date.now()) {
    brain.banned.delete(uid);
    return false;
  }
  return true;
}

// ── Check if user is muted ────────────────────────────────────────────────────
function isMuted(uid) {
  const mute = brain.muted.get(uid);
  if (!mute) return false;
  if (mute.expires && mute.expires < Date.now()) {
    brain.muted.delete(uid);
    return false;
  }
  return true;
}

// ── Send warning to user ──────────────────────────────────────────────────────
async function sendWarning(sendFn, uid, threat) {
  const warnings = (brain.warnings.get(uid) || 0) + 1;
  brain.warnings.set(uid, warnings);

  if (warnings >= 3) {
    // Auto-ban after 3 warnings
    brain.banned.set(uid, {
      uid:    uid,
      reason: "Auto-banned after 3 warnings. Last: " + threat.label,
      time:   new Date().toISOString(),
      expires: Date.now() + (24 * 60 * 60 * 1000), // 24 hour ban
    });
    learnPattern(threat.text || "", threat.type, threat.label);
    await saveBrain();
    return sendFn(
      "🚨 You have been automatically banned for 24 hours.\n" +
      "Reason: " + threat.label + "\n\n" +
      "Contact admin if you think this is a mistake."
    );
  }

  await sendFn(
    "⚠️ Warning " + warnings + "/3 — " + threat.label + "\n\n" +
    (warnings === 2 ? "🚨 One more violation and you will be banned!" :
     "Please follow the rules to avoid being banned.")
  );

  // Learn from this threat
  if (threat.text) learnPattern(threat.text, threat.type, threat.label);
  await saveBrain();
}

// ── Notify admin ──────────────────────────────────────────────────────────────
async function notifyAdmin(threat) {
  const admins = (process.env.ADMIN_IDS || "").split(",").map(function(id) { return id.trim(); }).filter(Boolean);
  if (admins.length === 0) return;
  const msg =
    "🚨 Security Alert!\n━━━━━━━━━━━━━━\n" +
    "User: "    + threat.uid   + "\n" +
    "Type: "    + threat.type  + "\n" +
    "Reason: "  + threat.label + "\n" +
    "Score: "   + threat.score + "\n" +
    "Message: " + (threat.text || "").substring(0, 100) + "\n" +
    "Time: "    + new Date().toLocaleString("en-PH", { timeZone: "Asia/Manila" });

  for (let i = 0; i < admins.length; i++) {
    try {
      await axios.post(
        "https://graph.facebook.com/v19.0/me/messages",
        { recipient: { id: admins[i] }, message: { text: msg }, messaging_type: "RESPONSE" },
        { params: { access_token: process.env.PAGE_ACCESS_TOKEN }, timeout: 10000 }
      );
    } catch(e) {}
  }
}

// ── Main security check — call this for every incoming message ────────────────
async function check(uid, text, sendFn) {
  if (!text || !uid) return { safe: true };
  brain.stats.totalAnalyzed++;

  // Admins are ALWAYS safe — never check or ban them
  const admins = (process.env.ADMIN_IDS || "").split(",").map(function(id) { return id.trim(); }).filter(Boolean);
  if (admins.includes(uid)) return { safe: true };

  await loadBrain();

  // Check ban first
  if (isBanned(uid)) {
    const ban = brain.banned.get(uid);
    const remaining = ban.expires ? Math.ceil((ban.expires - Date.now()) / 60000) + " minutes" : "permanently";
    await sendFn("🚫 You are banned. Remaining: " + remaining + "\nReason: " + (ban.reason || "Violation"));
    return { safe: false, action: "banned" };
  }

  // Check mute
  if (isMuted(uid)) {
    return { safe: false, action: "muted" };
  }

  // Analyze message
  const analysis = analyzeMessage(uid, text);

  if (!analysis.isThreat) {
    // Safe message — slightly reduce threat score over time (good behavior)
    updateThreatScore(uid, -2);
    return { safe: true };
  }

  // Threat detected!
  brain.stats.threatsDetected++;
  const topThreat = analysis.results.sort(function(a, b) { return b.score - a.score; })[0];
  const newScore   = updateThreatScore(uid, analysis.totalScore);

  console.log("[Security] Threat detected — uid:" + uid + " score:" + analysis.totalScore + " type:" + topThreat.type);

  // Decide action based on score
  if (analysis.totalScore >= 80) {
    // Immediate ban
    brain.banned.set(uid, {
      uid:     uid,
      reason:  topThreat.label,
      time:    new Date().toISOString(),
      expires: Date.now() + (24 * 60 * 60 * 1000),
    });
    brain.stats.autoBlocked++;
    learnPattern(text, topThreat.type, topThreat.label);
    await saveBrain();
    await notifyAdmin({ uid, type: topThreat.type, label: topThreat.label, score: analysis.totalScore, text });
    await sendFn(
      "🚨 You have been automatically banned!\n" +
      "Reason: " + topThreat.label + "\n\n" +
      "Contact admin if you think this is a mistake."
    );
    return { safe: false, action: "auto-banned", threat: topThreat };

  } else if (analysis.totalScore >= 50) {
    // Warning
    await sendWarning(sendFn, uid, { ...topThreat, text });
    await notifyAdmin({ uid, type: topThreat.type, label: topThreat.label, score: analysis.totalScore, text });
    return { safe: false, action: "warned", threat: topThreat };
  }

  return { safe: true };
}

// ── Auto-save brain every 10 minutes ─────────────────────────────────────────
setInterval(function() {
  saveBrain();
}, 10 * 60 * 1000);

// ── Load brain on startup ─────────────────────────────────────────────────────
setTimeout(function() {
  loadBrain();
}, 3000);

// ── Exports ───────────────────────────────────────────────────────────────────
module.exports = {
  check,
  isBanned,
  isMuted,
  brain,
  saveBrain,
  loadBrain,

  // Emergency self-unban — works even if banned
  selfUnban: function(uid) {
    brain.banned.delete(uid);
    brain.warnings.delete(uid);
    brain.threatScores.delete(uid);
    brain.muted.delete(uid);
    saveBrain();
    console.log("[Security] Self-unban: " + uid);
  },

  // Admin: manually ban a user
  ban: function(uid, reason, hours) {
    brain.banned.set(uid, {
      uid:     uid,
      reason:  reason || "Manual ban by admin",
      time:    new Date().toISOString(),
      expires: hours ? Date.now() + (hours * 60 * 60 * 1000) : null,
    });
    saveBrain();
  },

  // Admin: unban a user
  unban: function(uid) {
    brain.banned.delete(uid);
    brain.warnings.delete(uid);
    brain.threatScores.delete(uid);
    saveBrain();
  },

  // Admin: mute a user
  mute: function(uid, minutes) {
    brain.muted.set(uid, {
      uid:     uid,
      time:    new Date().toISOString(),
      expires: Date.now() + ((minutes || 60) * 60 * 1000),
    });
  },

  // Admin: unmute
  unmute: function(uid) {
    brain.muted.delete(uid);
  },

  // Admin: clear all data for a user
  clearUser: function(uid) {
    brain.banned.delete(uid);
    brain.muted.delete(uid);
    brain.warnings.delete(uid);
    brain.threatScores.delete(uid);
    brain.msgHistory.delete(uid);
    saveBrain();
  },

  // Get user security profile
  getUserProfile: function(uid) {
    return {
      uid:          uid,
      banned:       isBanned(uid),
      muted:        isMuted(uid),
      warnings:     brain.warnings.get(uid) || 0,
      threatScore:  brain.threatScores.get(uid) || 0,
      msgHistory:   (brain.msgHistory.get(uid) || []).length,
    };
  },

  // Get security stats
  getStats: function() {
    return {
      ...brain.stats,
      learnedPatterns: brain.learnedPatterns.length,
      bannedUsers:     brain.banned.size,
      mutedUsers:      brain.muted.size,
      warnedUsers:     brain.warnings.size,
      trackedUsers:    brain.threatScores.size,
    };
  },
};
