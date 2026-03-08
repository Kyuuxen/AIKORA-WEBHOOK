const security = require("../../utils/security");

module.exports.config = {
  name:        "security",
  description: "Self-learning security system management",
  usage:       "!security [status|stats|ban|unban|mute|unmute|profile|patterns|clear]",
  category:    "Security",
};

function isAdmin(uid) {
  return (process.env.ADMIN_IDS || "").split(",").map(function(id) { return id.trim(); }).includes(uid);
}

module.exports.run = async function ({ api, args, event }) {
  const uid    = event.senderId;
  const action = (args[0] || "status").toLowerCase();
  const target = args[1] || "";
  const extra  = args.slice(2).join(" ");

  // ── Status ────────────────────────────────────────────────────────────────
  if (action === "status" || action === "stats") {
    const stats = security.getStats();
    return api.send(
      "🛡️ Security System\n━━━━━━━━━━━━━━\n" +
      "Status: 🟢 Active (Self-Learning)\n\n" +
      "📊 Stats:\n" +
      "• Analyzed: "       + stats.totalAnalyzed   + " messages\n" +
      "• Threats found: "  + stats.threatsDetected  + "\n" +
      "• Auto-blocked: "   + stats.autoBlocked      + "\n" +
      "• Patterns learned: " + stats.learnedPatterns + "\n\n" +
      "👥 Users:\n" +
      "• Banned: "    + stats.bannedUsers  + "\n" +
      "• Muted: "     + stats.mutedUsers   + "\n" +
      "• Warned: "    + stats.warnedUsers  + "\n" +
      "• Tracked: "   + stats.trackedUsers + "\n\n" +
      "💾 Last save: " + (stats.lastSave || "Not yet")
    );
  }

  // ── Patterns learned ──────────────────────────────────────────────────────
  if (action === "patterns") {
    const patterns = security.brain.learnedPatterns.slice(-10);
    if (patterns.length === 0) return api.send("📚 No learned patterns yet. The bot will learn as threats are detected.");
    let msg = "📚 Last " + patterns.length + " Learned Patterns:\n━━━━━━━━━━━━━━\n";
    patterns.forEach(function(p, i) {
      msg += (i + 1) + ". \"" + p.phrase + "\"\n";
      msg += "   Type: " + p.type + " | Score: " + p.score + " | Seen: " + (p.seenCount || 1) + "x\n\n";
    });
    return api.send(msg);
  }

  // ── Profile ───────────────────────────────────────────────────────────────
  if (action === "profile") {
    const checkUid = target || uid;
    const profile  = security.getUserProfile(checkUid);
    return api.send(
      "👤 Security Profile\n━━━━━━━━━━━━━━\n" +
      "User ID: "      + profile.uid         + "\n" +
      "Banned: "       + (profile.banned  ? "🔴 Yes" : "🟢 No") + "\n" +
      "Muted: "        + (profile.muted   ? "🔴 Yes" : "🟢 No") + "\n" +
      "Warnings: "     + profile.warnings    + "/3\n" +
      "Threat Score: " + profile.threatScore + "\n" +
      "Msg History: "  + profile.msgHistory  + " tracked"
    );
  }

  // ── Admin-only commands ───────────────────────────────────────────────────
  if (!isAdmin(uid)) {
    return api.send("🚫 Admin only command.");
  }

  if (action === "ban") {
    if (!target) return api.send("Usage: !security ban [userID] [hours] [reason]");
    const hours  = parseInt(args[2]) || 24;
    const reason = args.slice(3).join(" ") || "Banned by admin";
    security.ban(target, reason, hours);
    return api.send("🔨 User " + target + " banned for " + hours + " hours.\nReason: " + reason);
  }

  if (action === "unban") {
    if (!target) return api.send("Usage: !security unban [userID]");
    security.unban(target);
    return api.send("✅ User " + target + " unbanned and warnings cleared.");
  }

  if (action === "mute") {
    if (!target) return api.send("Usage: !security mute [userID] [minutes]");
    const mins = parseInt(args[2]) || 60;
    security.mute(target, mins);
    return api.send("🔇 User " + target + " muted for " + mins + " minutes.");
  }

  if (action === "unmute") {
    if (!target) return api.send("Usage: !security unmute [userID]");
    security.unmute(target);
    return api.send("🔊 User " + target + " unmuted.");
  }

  if (action === "clear") {
    if (!target) return api.send("Usage: !security clear [userID]");
    security.clearUser(target);
    return api.send("🧹 All security data cleared for user " + target + ".");
  }

  if (action === "save") {
    await security.saveBrain();
    return api.send("💾 Security brain saved to JSONBin.");
  }

  if (action === "reload") {
    security.brain.lastLoad = 0;
    await security.loadBrain();
    return api.send("🔄 Security brain reloaded from JSONBin.");
  }

  api.send(
    "🛡️ Security Commands\n━━━━━━━━━━━━━━\n" +
    "!security status     — System stats\n" +
    "!security patterns   — Learned threat patterns\n" +
    "!security profile [uid] — User threat profile\n\n" +
    "👑 Admin only:\n" +
    "!security ban [uid] [hours] [reason]\n" +
    "!security unban [uid]\n" +
    "!security mute [uid] [minutes]\n" +
    "!security unmute [uid]\n" +
    "!security clear [uid]\n" +
    "!security save\n" +
    "!security reload"
  );
};
