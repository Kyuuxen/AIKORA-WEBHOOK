"use strict";

const express    = require("express");
const bodyParser = require("body-parser");
const axios      = require("axios");
const fs         = require("fs");
const path       = require("path");

const logger = { log: function(msg, type) { console.log("[" + (type||"INFO") + "] " + msg); } };

const loadCommands = function() {
  const commands  = new Map();
  const cmdFolder = path.join(__dirname, "modules/command");
  if (!fs.existsSync(cmdFolder)) return commands;
  fs.readdirSync(cmdFolder).filter(function(f){ return f.endsWith(".js"); }).forEach(function(file) {
    try {
      const cmd = require(path.join(cmdFolder, file));
      if (cmd.config && cmd.config.name && typeof cmd.run === "function") {
        commands.set(cmd.config.name.toLowerCase(), cmd);
        console.log("[SUCCESS] Loaded: " + cmd.config.name);
      }
    } catch(e) { console.log("[ERROR] " + file + ": " + e.message); }
  });
  return commands;
};

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const PAGE_FEED_TOKEN   = process.env.PAGE_FEED_TOKEN;
const VERIFY_TOKEN      = process.env.VERIFY_TOKEN || "mybotverify123";
const PREFIX            = process.env.PREFIX       || "!";
const BOTNAME           = process.env.BOTNAME      || "AIKORA";
const PAGE_ID           = process.env.PAGE_ID      || "";

if (!PAGE_ACCESS_TOKEN) { console.log("[ERROR] PAGE_ACCESS_TOKEN not set!"); process.exit(1); }

const commands = loadCommands();
global.commands = commands;

// Memory
const userMemory = new Map();
function addMemory(uid, role, text) {
  if (!userMemory.has(uid)) userMemory.set(uid, []);
  const m = userMemory.get(uid);
  m.push({ role: role, text: text });
  if (m.length > 20) m.splice(0, m.length - 20);
}
function buildContext(uid, msg) {
  const m = userMemory.get(uid) || [];
  if (!m.length) return "User: " + msg;
  return m.slice(-6).map(function(x) {
    return (x.role === "user" ? "User" : BOTNAME) + ": " + x.text;
  }).join("\n") + "\nUser: " + msg;
}

// AI Models
// ── Claude AI via official Anthropic API ─────────────────────────────────────
async function askAI(uid, message) {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  // Build system prompt
  let sys = "You are " + BOTNAME + ", a friendly AI assistant on Facebook Messenger. Be helpful and concise. Use Taglish (mix of Tagalog and English) when appropriate. Use emojis sometimes. Never say you are Claude or any AI — you are always " + BOTNAME + ".";

  // Add bot commands context
  try {
    if (global.aiBotContext && global.aiBotContext.commands && global.aiBotContext.commands.length) {
      const prefix  = process.env.PREFIX || "!";
      const cmdList = global.aiBotContext.commands.map(function(c) { return prefix + c; }).join(", ");
      sys += "\n\nAVAILABLE BOT COMMANDS: " + cmdList;
      sys += "\nIf user asks about a command, check the list and answer accurately. Never make up commands not in the list.";
    }
  } catch(e) {}

  // Build conversation history as proper messages array for Anthropic API
  const rawMemory = userMemory.get(uid) || [];
  const messages  = [];

  // Add conversation history (last 6 messages)
  // Anthropic requires alternating user/assistant roles
  const history = rawMemory.slice(-6);
  for (let i = 0; i < history.length; i++) {
    const role = history[i].role === "user" ? "user" : "assistant";
    // Skip if same role as previous (Anthropic doesn't allow consecutive same roles)
    if (messages.length > 0 && messages[messages.length - 1].role === role) continue;
    messages.push({ role: role, content: String(history[i].text || "") });
  }

  // Make sure last message before current is not "user" (would cause consecutive user messages)
  if (messages.length > 0 && messages[messages.length - 1].role === "user") {
    messages.pop();
  }

  // Add current message
  messages.push({ role: "user", content: String(message || "") });

  // Use official Anthropic API if key is set
  if (apiKey) {
    try {
      const res = await axios.post(
        "https://api.anthropic.com/v1/messages",
        {
          model:      "claude-haiku-4-5-20251001",
          max_tokens: 1024,
          system:     sys,
          messages:   messages,
        },
        {
          headers: {
            "x-api-key":         apiKey,
            "anthropic-version": "2023-06-01",
            "content-type":      "application/json",
          },
          timeout: 30000,
        }
      );
      const text = res.data && res.data.content && res.data.content[0] && res.data.content[0].text
        ? res.data.content[0].text
        : null;
      if (text && text.trim().length > 2) {
        logger.log("AI: Claude (Anthropic API)", "AI");
        return text.trim();
      }
    } catch(e) {
      logger.log("Anthropic API failed: " + (e.response ? JSON.stringify(e.response.data) : e.message), "WARN");
    }
  } else {
    logger.log("ANTHROPIC_API_KEY not set — falling back to Pollinations", "WARN");
  }

  // Fallback to Pollinations if no API key or API failed
  try {
    const res = await axios.post(
      "https://text.pollinations.ai/",
      {
        messages: [
          { role: "system", content: sys },
          { role: "user",   content: message },
        ],
        model: "claude-hybridspace",
        seed:  Math.floor(Math.random() * 9999),
      },
      { headers: { "Content-Type": "application/json" }, timeout: 30000 }
    );
    const text = typeof res.data === "string" ? res.data : JSON.stringify(res.data);
    if (text && text.trim().length > 2) {
      logger.log("AI: Claude (Pollinations fallback)", "AI");
      return text.trim();
    }
  } catch(e) { logger.log("Pollinations fallback failed: " + e.message, "WARN"); }

  return null;
}

// Send message
async function sendMessage(recipientId, text) {
  const MAX   = 1900;
  let str     = String(text);
  const parts = [];
  while (str.length > MAX) {
    let s = str.lastIndexOf("\n", MAX);
    if (s === -1) s = MAX;
    parts.push(str.slice(0, s));
    str = str.slice(s).trim();
  }
  parts.push(str);
  for (let i = 0; i < parts.length; i++) {
    try {
      await axios.post(
        "https://graph.facebook.com/v19.0/me/messages",
        { recipient: { id: recipientId }, message: { text: parts[i] } },
        { params: { access_token: PAGE_ACCESS_TOKEN } }
      );
    } catch(err) {
      logger.log("Send error: " + JSON.stringify((err.response && err.response.data) ? err.response.data : err.message), "ERROR");
    }
  }
}

global.sendMessage = sendMessage;

async function markSeen(id) {
  try { await axios.post("https://graph.facebook.com/v19.0/me/messages", { recipient: { id: id }, sender_action: "mark_seen" }, { params: { access_token: PAGE_ACCESS_TOKEN } }); } catch(e) {}
}
async function showTyping(id) {
  try { await axios.post("https://graph.facebook.com/v19.0/me/messages", { recipient: { id: id }, sender_action: "typing_on" }, { params: { access_token: PAGE_ACCESS_TOKEN } }); } catch(e) {}
}

// Set page online
async function setPageOnline() {
  try {
    await axios.post(
      "https://graph.facebook.com/v19.0/me/messenger_profile",
      { greeting: [{ locale: "default", text: "Hi! I am " + BOTNAME + " - Just talk to me or type " + PREFIX + "help for commands!" }], get_started: { payload: "GET_STARTED" } },
      { params: { access_token: PAGE_ACCESS_TOKEN } }
    );
    logger.log("Messenger profile set!", "SUCCESS");

    if (PAGE_ID && PAGE_FEED_TOKEN) {
      await axios.post(
        "https://graph.facebook.com/v19.0/" + PAGE_ID,
        { is_always_open: true },
        { params: { access_token: PAGE_FEED_TOKEN } }
      );
      logger.log("Always open set!", "SUCCESS");

      // Subscribe page to webhook fields including feed
      await axios.post(
        "https://graph.facebook.com/v19.0/" + PAGE_ID + "/subscribed_apps",
        { subscribed_fields: ["messages", "messaging_postbacks", "messaging_optins", "message_reads", "feed"] },
        { params: { access_token: PAGE_FEED_TOKEN } }
      );
      logger.log("Subscriptions updated!", "SUCCESS");
    }
  } catch(err) {
    logger.log("setPageOnline: " + ((err.response && err.response.data && err.response.data.error) ? err.response.data.error.message : err.message), "WARN");
  }
}

// Cooldowns
const cooldowns = new Map();

// Handle command
async function handleCommand(senderId, text) {
  const args    = text.trim().split(/\s+/);
  const cmdName = args[0].slice(PREFIX.length).toLowerCase();
  const cmdArgs = args.slice(1);
  const command = commands.get(cmdName);

  if (!command) {
    return sendMessage(senderId, "Unknown command: " + PREFIX + cmdName + "\nType " + PREFIX + "help to see all commands.");
  }

  const key = senderId + ":" + cmdName;
  const now = Date.now();
  if (cooldowns.has(key)) {
    const left = cooldowns.get(key) - now;
    if (left > 0) return sendMessage(senderId, "Wait " + (left / 1000).toFixed(1) + "s before using " + PREFIX + cmdName + " again.");
  }
  cooldowns.set(key, now + 5000);

  const api = {
    send:           function(m) { return sendMessage(senderId, m); },
    sendMessage:    function(m) { return sendMessage(senderId, m); },
    commands:       commands,
    PREFIX:         PREFIX,
    PAGE_FEED_TOKEN: PAGE_FEED_TOKEN,
    BOTNAME:        BOTNAME,
  };
  const event = { senderId: senderId, text: text, args: cmdArgs };

  try {
    logger.log("CMD: " + cmdName + " | User: " + senderId, "CMD");
    await command.run({ api: api, event: event, args: cmdArgs });
  } catch(err) {
    logger.log("Error in " + cmdName + ": " + err.message, "ERROR");
    sendMessage(senderId, "Something went wrong: " + err.message);
  }
}

// Handle AI
async function handleAI(senderId, text) {
  logger.log("AI from " + senderId + ": " + text, "AI");
  addMemory(senderId, "user", text);
  const reply = await askAI(senderId, text);
  if (!reply) { await sendMessage(senderId, "Sandali lang, ulit ka mag-message! 😊"); return; }
  addMemory(senderId, "bot", reply);
  await sendMessage(senderId, reply);
}

// Handle message router
async function handleMessage(senderId, text) {
  if (!text) return;
  await markSeen(senderId);
  await showTyping(senderId);

  if (text.startsWith(PREFIX)) {
    await handleCommand(senderId, text);
    return;
  }

  // Check randomchat relay
  const rcCmd = commands.get("randomchat");
  if (rcCmd && typeof rcCmd.relay === "function") {
    const relayed = await rcCmd.relay(senderId, text);
    if (relayed) return;
  }

  await handleAI(senderId, text);
}

// Express
const app = express();
app.use(bodyParser.json());

// Webhook verification
app.get("/webhook", function(req, res) {
  if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === VERIFY_TOKEN) {
    res.status(200).send(req.query["hub.challenge"]);
  } else {
    res.sendStatus(403);
  }
});

// Webhook handler
app.post("/webhook", async function(req, res) {
  const body = req.body;
  if (body.object !== "page") return res.sendStatus(404);

  for (let i = 0; i < body.entry.length; i++) {
    const entry = body.entry[i];

    // Comment auto-reply
    const changes = entry.changes || [];
    for (let j = 0; j < changes.length; j++) {
      const change = changes[j];
      if (change.field === "feed" && change.value && change.value.comment_id) {
        const commentId = change.value.comment_id;
        const message   = change.value.message;
        const fromId    = change.value.from ? change.value.from.id : null;

        if (!message || !PAGE_FEED_TOKEN) continue;
        if (fromId === PAGE_ID) continue;
        if (message.length < 3) continue;
        if (message.toLowerCase().indexOf("http") !== -1) continue;

        logger.log("COMMENT from " + fromId + ": " + message, "COMMENT");
        try {
          // Random delay 3-7 seconds to look human
          await new Promise(function(resolve) { setTimeout(resolve, 3000 + Math.random() * 4000); });
          const reply = await askAI(fromId || "comment_user", "Reply naturally and friendly to this Facebook comment. Keep it short (1-2 sentences):\n\n" + message);
          if (!reply) continue;
          await axios.post(
            "https://graph.facebook.com/v19.0/" + commentId + "/comments",
            { message: reply },
            { params: { access_token: PAGE_FEED_TOKEN } }
          );
          await axios.post(
            "https://graph.facebook.com/v19.0/" + commentId + "/likes",
            {},
            { params: { access_token: PAGE_FEED_TOKEN } }
          );
          logger.log("Replied to comment: " + reply.substring(0, 50), "SUCCESS");
        } catch(err) {
          logger.log("Comment reply error: " + err.message, "ERROR");
        }
      }
    }

    // Messenger messages
    const messaging = entry.messaging || [];
    for (let j = 0; j < messaging.length; j++) {
      const event = messaging[j];

      if (event.postback && event.postback.payload === "GET_STARTED") {
        const sid = event.sender.id;
        await markSeen(sid);
        await sendMessage(sid, "Hey! I am " + BOTNAME + "!\n\nJust talk to me like a friend and I will respond with AI!\nOr type " + PREFIX + "help to see all commands.");
        continue;
      }

      if (!event.message || !event.message.text) continue;

      const senderId = event.sender.id;
      const text     = event.message.text;
      logger.log("MSG from " + senderId + ": " + text, "MSG");
      await handleMessage(senderId, text);
    }
  }

  res.status(200).send("EVENT_RECEIVED");
});

// Status page
app.get("/", function(req, res) {
  res.send(
    "<html><head><title>" + BOTNAME + "</title></head>" +
    "<body style='font-family:sans-serif;text-align:center;padding:50px;background:#1a1a2e;color:white'>" +
    "<h1>" + BOTNAME + "</h1>" +
    "<p style='color:#00ff88'>Online</p>" +
    "<p>Commands: " + commands.size + "</p>" +
    "<p>AI: Claude (Anthropic)</p>" +
    "<p>Prefix: " + PREFIX + "</p>" +
    "</body></html>"
  );
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, async function() {
  logger.log(BOTNAME + " running on port " + PORT, "SYSTEM");
  logger.log("Commands: " + commands.size, "SYSTEM");
  logger.log("AI: Claude (Pollinations)", "SYSTEM");
  await setPageOnline();
});
