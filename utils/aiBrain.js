const axios = require("axios");

// ═══════════════════════════════════════════════════════════════════════════════
// AIKORA CONVERSATIONAL AI BRAIN
// Learns from every conversation, gets smarter over time
// ═══════════════════════════════════════════════════════════════════════════════

const JSONBIN_KEY = process.env.JSONBIN_KEY;
const JSONBIN_BIN = process.env.JSONBIN_BIN;
const BOTNAME     = process.env.BOTNAME || "AIKORA";

// ── In-memory brain ───────────────────────────────────────────────────────────
if (!global.aiBrain) {
  global.aiBrain = {
    // Per-user profiles: uid -> { name, mood, topics, facts, messageCount, lastSeen, preferences }
    users:     new Map(),
    // Global learned topics and common questions
    learned: {
      commonQuestions: [], // { question, bestAnswer, count }
      popularTopics:   [], // { topic, count }
      goodResponses:   [], // { context, response, rating }
    },
    lastSave: 0,
  };
}
const brain = global.aiBrain;

// ── JSONBin: save brain ───────────────────────────────────────────────────────
async function saveBrain() {
  if (!JSONBIN_KEY || !JSONBIN_BIN) return;
  if (Date.now() - brain.lastSave < 60000) return; // max once per minute
  try {
    let existing = {};
    try {
      const r = await axios.get(
        "https://api.jsonbin.io/v3/b/" + JSONBIN_BIN + "/latest",
        { headers: { "X-Master-Key": JSONBIN_KEY }, timeout: 10000 }
      );
      existing = (r.data && r.data.record) ? r.data.record : {};
    } catch(e) {}

    // Convert Map to array for storage
    existing.aiBrain = {
      users: Array.from(brain.users.entries()).map(function(e) {
        return { uid: e[0], profile: e[1] };
      }).slice(-500), // keep last 500 users
      learned: {
        commonQuestions: brain.learned.commonQuestions.slice(-100),
        popularTopics:   brain.learned.popularTopics.slice(-50),
        goodResponses:   brain.learned.goodResponses.slice(-100),
      },
      savedAt: new Date().toISOString(),
    };

    await axios.put(
      "https://api.jsonbin.io/v3/b/" + JSONBIN_BIN,
      existing,
      { headers: { "X-Master-Key": JSONBIN_KEY, "Content-Type": "application/json" }, timeout: 10000 }
    );
    brain.lastSave = Date.now();
    console.log("[AiBrain] Saved — " + brain.users.size + " users");
  } catch(e) {
    console.log("[AiBrain] Save failed:", e.message);
  }
}

// ── JSONBin: load brain ───────────────────────────────────────────────────────
async function loadBrain() {
  if (!JSONBIN_KEY || !JSONBIN_BIN) return;
  try {
    const r = await axios.get(
      "https://api.jsonbin.io/v3/b/" + JSONBIN_BIN + "/latest",
      { headers: { "X-Master-Key": JSONBIN_KEY }, timeout: 10000 }
    );
    const data = r.data && r.data.record && r.data.record.aiBrain;
    if (!data) return;

    // Restore users
    if (data.users) {
      data.users.forEach(function(u) {
        brain.users.set(u.uid, u.profile);
      });
    }
    // Restore learned data
    if (data.learned) {
      brain.learned = Object.assign(brain.learned, data.learned);
    }
    console.log("[AiBrain] Loaded — " + brain.users.size + " users, " +
      brain.learned.commonQuestions.length + " learned questions");
  } catch(e) {
    console.log("[AiBrain] Load failed:", e.message);
  }
}

// ── Get or create user profile ────────────────────────────────────────────────
function getUser(uid) {
  if (!brain.users.has(uid)) {
    brain.users.set(uid, {
      uid:          uid,
      name:         null,
      mood:         "neutral",
      topics:       [],       // topics they talked about
      facts:        [],       // facts learned about them
      preferences:  {},       // likes/dislikes
      messageCount: 0,
      joinedAt:     new Date().toISOString(),
      lastSeen:     new Date().toISOString(),
      history:      [],       // last 20 messages for context
    });
  }
  return brain.users.get(uid);
}

// ── Detect mood from message ──────────────────────────────────────────────────
function detectMood(text) {
  const lower = text.toLowerCase();
  if (/sad|malungkot|iyak|cry|depressed|nalulungkot|masakit|hurt/.test(lower))  return "sad";
  if (/angry|galit|grabe|gago|bobo|tangina|putangina/.test(lower))              return "angry";
  if (/happy|saya|masaya|haha|lol|😂|😄|excited|yay/.test(lower))               return "happy";
  if (/bored|walang|boring|tamad|wala akong|wala na/.test(lower))               return "bored";
  if (/love|mahal|crush|kilig|😍|❤️|in love/.test(lower))                      return "romantic";
  if (/worried|nag-aalala|anxious|takot|scared|fear/.test(lower))               return "anxious";
  return null; // no change
}

// ── Extract facts about user from message ─────────────────────────────────────
function extractFacts(text) {
  const facts = [];
  const lower = text.toLowerCase();

  // Name
  const nameMatch = text.match(/(?:i'?m|i am|call me|ako si|pangalan ko|name is)\s+([A-Z][a-z]+)/i);
  if (nameMatch) facts.push({ type: "name", value: nameMatch[1] });

  // Age
  const ageMatch = text.match(/(?:i'?m|i am|ako ay|edad ko|years old)\s+(\d+)/i);
  if (ageMatch) facts.push({ type: "age", value: ageMatch[1] + " years old" });

  // Location
  const locMatch = text.match(/(?:i'?m from|i live in|nasa|galing ako sa|taga)\s+([A-Z][a-zA-Z\s]+)/i);
  if (locMatch) facts.push({ type: "location", value: locMatch[1].trim() });

  // Job/study
  const jobMatch = text.match(/(?:i'?m a|i work as|i am a|nagtatrabaho|nag-aaral|i study)\s+([a-zA-Z\s]+)/i);
  if (jobMatch) facts.push({ type: "occupation", value: jobMatch[1].trim() });

  // Likes
  const likeMatch = text.match(/(?:i like|i love|i enjoy|gusto ko|mahilig ako sa)\s+([a-zA-Z\s]+)/i);
  if (likeMatch) facts.push({ type: "likes", value: likeMatch[1].trim() });

  // Dislikes
  const dislikeMatch = text.match(/(?:i don'?t like|i hate|ayaw ko|hindi ko gusto)\s+([a-zA-Z\s]+)/i);
  if (dislikeMatch) facts.push({ type: "dislikes", value: dislikeMatch[1].trim() });

  return facts;
}

// ── Extract topics from message ───────────────────────────────────────────────
function extractTopics(text) {
  const topics = [];
  const checks = [
    { pattern: /music|kanta|song|playlist|spotify/i,            topic: "music" },
    { pattern: /food|kain|lutong|recipe|restaurant|masarap/i,   topic: "food" },
    { pattern: /game|laro|mobile legends|ml|codm|roblox/i,      topic: "gaming" },
    { pattern: /love|relationship|crush|boyfriend|girlfriend/i,  topic: "love" },
    { pattern: /school|study|exam|homework|assignment/i,         topic: "school" },
    { pattern: /work|job|boss|office|salary|trabaho/i,           topic: "work" },
    { pattern: /movie|film|series|netflix|kdrama/i,              topic: "entertainment" },
    { pattern: /sports|basketball|football|nba|pba/i,            topic: "sports" },
    { pattern: /news|politics|balita|government/i,               topic: "news" },
    { pattern: /tech|phone|laptop|computer|android|iphone/i,     topic: "technology" },
    { pattern: /family|pamilya|nanay|tatay|kapatid/i,            topic: "family" },
    { pattern: /money|pera|budget|utang|bayad/i,                 topic: "money" },
  ];
  checks.forEach(function(c) {
    if (c.pattern.test(text)) topics.push(c.topic);
  });
  return topics;
}

// ── Update global learned data ────────────────────────────────────────────────
function updateLearned(topics) {
  topics.forEach(function(topic) {
    const existing = brain.learned.popularTopics.find(function(t) { return t.topic === topic; });
    if (existing) {
      existing.count++;
    } else {
      brain.learned.popularTopics.push({ topic: topic, count: 1 });
    }
  });
  // Sort by popularity
  brain.learned.popularTopics.sort(function(a, b) { return b.count - a.count; });
}

// ── Build smart system prompt ─────────────────────────────────────────────────
function buildSystemPrompt(user) {
  const name    = user.name ? user.name : "this person";
  const isNew   = user.messageCount <= 2;
  const topTopics = user.topics.slice(-5).join(", ") || "general topics";
  const mood    = user.mood || "neutral";

  // Build facts section
  let factsText = "";
  if (user.facts && user.facts.length > 0) {
    const factLines = user.facts.slice(-10).map(function(f) {
      return "- " + f.type + ": " + f.value;
    });
    factsText = "\n\nKnown facts about " + name + ":\n" + factLines.join("\n");
  }

  // Mood instruction
  const moodInstructions = {
    sad:      "They seem sad. Be extra warm, empathetic and comforting. Don't be too cheerful.",
    angry:    "They seem upset. Stay calm, acknowledge their feelings, don't argue.",
    happy:    "They're in a great mood! Match their energy — be fun and upbeat.",
    bored:    "They seem bored. Be entertaining, suggest fun topics or activities.",
    romantic: "They're in a romantic mood. Be warm and sweet but appropriate.",
    anxious:  "They seem worried. Be reassuring and calm.",
    neutral:  "Keep a friendly, natural conversational tone.",
  };

  const moodGuide = moodInstructions[mood] || moodInstructions.neutral;

  // Global popular topics for better context
  const globalTopics = brain.learned.popularTopics.slice(0, 5).map(function(t) {
    return t.topic + "(" + t.count + " times)";
  }).join(", ");

  return [
    "You are " + BOTNAME + ", a friendly and conversational AI on Facebook Messenger.",
    "You are NOT an assistant — you are a FRIEND. Talk naturally like a real person.",
    "",
    "PERSONALITY:",
    "- Warm, witty, and genuinely interested in the person",
    "- Use natural conversational language (Taglish is okay — mix Filipino and English naturally)",
    "- Use emojis naturally, not excessively",
    "- Ask follow-up questions to keep conversation going",
    "- Remember what they told you and reference it naturally",
    "- Never say you are an AI or bot — you are always " + BOTNAME,
    "- Keep responses concise (2-4 sentences max) unless they ask something detailed",
    "",
    "CURRENT USER: " + name,
    "Message count with you: " + user.messageCount,
    "Current mood detected: " + mood,
    "Topics they like: " + topTopics,
    isNew ? "This is a new user — introduce yourself warmly and ask their name if you don't know it." : "You already know this person well.",
    factsText,
    "",
    "MOOD GUIDE: " + moodGuide,
    "",
    "CONVERSATION STYLE:",
    "- If they greet you, greet back warmly and ask how they are",
    "- If they share something, react genuinely and ask more",
    "- If they ask a question, answer naturally then redirect with a question",
    "- If they joke, laugh and joke back",
    "- Never give robotic or list-style answers in casual chat",
    "- Popular topics users discuss: " + (globalTopics || "general"),
  ].join("\n");
}

// ── Main chat function ────────────────────────────────────────────────────────
async function chat(uid, message) {
  const user = getUser(uid);

  // Update user profile
  user.messageCount++;
  user.lastSeen = new Date().toISOString();

  // Detect mood
  const mood = detectMood(message);
  if (mood) user.mood = mood;

  // Extract facts
  const facts = extractFacts(message);
  facts.forEach(function(fact) {
    // Check if we already know this fact type
    const existing = user.facts.find(function(f) { return f.type === fact.type; });
    if (existing) {
      existing.value = fact.value; // update
    } else {
      user.facts.push(fact); // new fact learned
    }
    // If name extracted, update user name
    if (fact.type === "name") user.name = fact.value;
  });

  // Extract topics
  const topics = extractTopics(message);
  topics.forEach(function(t) {
    if (!user.topics.includes(t)) user.topics.push(t);
  });
  if (user.topics.length > 20) user.topics = user.topics.slice(-20);
  updateLearned(topics);

  // Add to history
  user.history.push({ role: "user", content: message });
  if (user.history.length > 20) user.history = user.history.slice(-20);

  // Build messages array for Pollinations
  const systemPrompt = buildSystemPrompt(user);
  const messages     = [{ role: "system", content: systemPrompt }];

  // Add conversation history (last 10 exchanges)
  const historyToSend = user.history.slice(-10);
  historyToSend.forEach(function(h) {
    messages.push({ role: h.role, content: h.content });
  });

  // Call Pollinations
  let reply = null;
  try {
    const res = await axios.post(
      "https://text.pollinations.ai/",
      {
        messages: messages,
        model:    "openai",
        seed:     Math.floor(Math.random() * 9999),
      },
      { headers: { "Content-Type": "application/json" }, timeout: 30000 }
    );
    reply = typeof res.data === "string" ? res.data.trim() : null;
  } catch(e) {
    console.log("[AiBrain] Pollinations failed:", e.message);
    // Fallback responses based on mood
    const fallbacks = {
      sad:     "Hey, I'm here for you. Wanna talk about it? 🤗",
      angry:   "I hear you. Take a deep breath — I'm listening 💙",
      happy:   "Love the energy! 😄 Tell me more!",
      neutral: "Hmm, tell me more about that! 😊",
    };
    reply = fallbacks[user.mood] || fallbacks.neutral;
  }

  if (!reply) reply = "Hmm, interesting! Tell me more 😊";

  // Save bot reply to history
  user.history.push({ role: "assistant", content: reply });

  // Save brain every minute
  saveBrain();

  return reply;
}

// ── Load on startup ───────────────────────────────────────────────────────────
setTimeout(loadBrain, 4000);

// ── Auto-save every minute ────────────────────────────────────────────────────
setInterval(function() {
  brain.lastSave = 0; // force save
  saveBrain();
}, 60 * 1000);

module.exports = {
  chat,
  getUser,
  brain,
  saveBrain,
  loadBrain,

  getStats: function() {
    return {
      totalUsers:       brain.users.size,
      learnedQuestions: brain.learned.commonQuestions.length,
      popularTopics:    brain.learned.popularTopics.slice(0, 5),
      goodResponses:    brain.learned.goodResponses.length,
    };
  },
};
