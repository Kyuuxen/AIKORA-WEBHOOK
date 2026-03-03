"use strict";

const express    = require("express");
const bodyParser = require("body-parser");
const axios      = require("axios");
const logger = { log: (msg, type) => console.log(`[${type||"INFO"}] ${msg}`) };

const loadCommands = function() {
  const fs = require("fs");
  const path = require("path");
  const commands = new Map();
  const cmdFolder = path.join(__dirname, "modules/command");
  if (!fs.existsSync(cmdFolder)) return commands;
  fs.readdirSync(cmdFolder).filter(f => f.endsWith(".js")).forEach(file => {
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
const VERIFY_TOKEN      = process.env.VERIFY_TOKEN || "mybotverify123";
const PREFIX            = process.env.PREFIX || "!";
const BOTNAME           = process.env.BOTNAME || "AIKORA";

if (!PAGE_ACCESS_TOKEN) { console.log("[ERROR] PAGE_ACCESS_TOKEN not set!"); process.exit(1); }

const commands = loadCommands();
global.commands = commands;
global.sendMessage = sendMessage;
// ── Memory ────────────────────────────────────────────────────────────────────
const userMemory = new Map();
function addMemory(uid, role, text) {
  if (!userMemory.has(uid)) userMemory.set(uid, []);
  const m = userMemory.get(uid);
  m.push({ role, text });
  if (m.length > 20) m.splice(0, m.length - 20);
}
function buildContext(uid, msg) {
  const m = userMemory.get(uid) || [];
  if (!m.length) return "User: " + msg;
  return m.slice(-6).map(x => (x.role === "user" ? "User" : BOTNAME) + ": " + x.text).join("\n") + "\nUser: " + msg;
}

// ── AI Models — tries each one until one works ────────────────────────────────
const AI_MODELS = [
  {
    name: "Copilot",
    call: async (uid, msg, sys) => {
      const r = await axios.get("https://api-library-kohi.onrender.com/api/copilot", {
        params: { prompt: sys + "\n\n" + buildContext(uid, msg), model: "default", user: uid },
        timeout: 20000,
      });
      return r.data?.data?.text || null;
    }
  },
  {
    name: "GPT-5",
    call: async (uid, msg, sys) => {
      const r = await axios.get("https://api-library-kohi.onrender.com/api/pollination-ai", {
        params: { prompt: sys + "\n\nUser: " + msg, model: "openai-large", user: uid },
        timeout: 20000,
      });
      return r.data?.data || null;
    }
  },
  {
    name: "Aria",
    call: async (uid, msg) => {
      const r = await axios.get("https://betadash-api-swordslush-production.up.railway.app/Aria", {
        params: { ask: msg, userid: uid },
        timeout: 20000,
      });
      return r.data?.message || r.data?.response || r.data?.reply || null;
    }
  },
  {
    name: "You.com",
    call: async (uid, msg) => {
      const r = await axios.get("https://betadash-api-swordslush-production.up.railway.app/you", {
        params: { chat: msg },
        timeout: 20000,
      });
      return r.data?.message || r.data?.response || r.data?.youResponse || null;
    }
  },
  {
    name: "Perplexity",
    call: async (uid, msg, sys) => {
      const r = await axios.get("https://api-library-kohi.onrender.com/api/pollination-ai", {
        params: { prompt: sys + "\n\nUser: " + msg, model: "perplexity-reasoning", user: uid + "_p" },
        timeout: 20000,
      });
      return r.data?.data || null;
    }
  },
  {
    name: "Mistral",
    call: async (uid, msg, sys) => {
      const r = await axios.get("https://api-library-kohi.onrender.com/api/pollination-ai", {
        params: { prompt: sys + "\n\nUser: " + msg, model: "mistral", user: uid + "_m" },
        timeout: 20000,
      });
      return r.data?.data || null;
    }
  },
];

async function askAI(uid, message) {
  const sys = `You are ${BOTNAME}, a friendly AI assistant on Facebook Messenger. Be helpful and concise. Use emojis sometimes. Never say you are Copilot, GPT, or any other AI — you are always ${BOTNAME}.`;

  const keyMap = {
    copilot: "Copilot",
    gpt5: "GPT-5",
    aria: "Aria",
    you: "You.com",
    perplexity: "Perplexity",
    mistral: "Mistral",
  };

  const selectedKey = global.aiMode && global.aiMode !== "auto" ? global.aiMode : null;
  const selectedName = selectedKey ? keyMap[selectedKey] : null;

  // Try selected model first
  if (selectedName) {
    const selected = AI_MODELS.find(m => m.name === selectedName);
    if (selected) {
      try {
        const reply = await selected.call(uid, message, sys);
        if (reply && reply.trim().length > 0) {
          logger.log(`AI replied via ${selected.name} (selected)`, "AI");
          return reply.trim();
        }
      } catch (err) {
        logger.log(`${selected.name} failed: ${err.message} — trying others`, "WARN");
      }
    }
  }

  // Fallback — try all models in order
  for (const model of AI_MODELS) {
    if (selectedName && model.name === selectedName) continue;
    try {
      const reply = await model.call(uid, message, sys);
      if (reply && reply.trim().length > 0) {
        logger.log(`AI replied via ${model.name}`, "AI");
        return reply.trim();
      }
    } catch (err) {
      logger.log(`${model.name} failed: ${err.message}`, "WARN");
    }
  }
  return null;
      }
// ── Send message ──────────────────────────────────────────────────────────────
async function sendMessage(recipientId, text) {
  const MAX = 1900;
  let str = String(text);
  const parts = [];
  while (str.length > MAX) {
    let s = str.lastIndexOf("\n", MAX);
    if (s === -1) s = MAX;
    parts.push(str.slice(0, s));
    str = str.slice(s).trim();
  }
  parts.push(str);
  for (const part of parts) {
    try {
      await axios.post("https://graph.facebook.com/v19.0/me/messages",
        { recipient: { id: recipientId }, message: { text: part } },
        { params: { access_token: PAGE_ACCESS_TOKEN } }
      );
    } catch (err) {
      logger.log("Send error: " + JSON.stringify(err.response?.data || err.message), "ERROR");
    }
  }
}

async function markSeen(id) {
  try { await axios.post("https://graph.facebook.com/v19.0/me/messages", { recipient: { id }, sender_action: "mark_seen" }, { params: { access_token: PAGE_ACCESS_TOKEN } }); } catch {}
}
async function showTyping(id) {
  try { await axios.post("https://graph.facebook.com/v19.0/me/messages", { recipient: { id }, sender_action: "typing_on" }, { params: { access_token: PAGE_ACCESS_TOKEN } }); } catch {}
}

async function setPageOnline() {
  try {
    await axios.post("https://graph.facebook.com/v19.0/me/messenger_profile",
      { greeting: [{ locale: "default", text: `Hi! I'm ${BOTNAME} 🤖\nJust talk to me or type ${PREFIX}help for commands!` }], get_started: { payload: "GET_STARTED" } },
      { params: { access_token: PAGE_ACCESS_TOKEN } }
    );
    logger.log("Messenger profile set!", "SUCCESS");
    if (process.env.PAGE_ID && process.env.PAGE_FEED_TOKEN) {
      await axios.post(`https://graph.facebook.com/v19.0/${process.env.PAGE_ID}`, { is_always_open: true }, { params: { access_token: process.env.PAGE_FEED_TOKEN } });
      logger.log("Always open set!", "SUCCESS");
    }
    await axios.post("https://graph.facebook.com/v19.0/me/subscribed_apps",
      { subscribed_fields: ["messages", "messaging_postbacks", "messaging_optins", "message_reads"] },
      { params: { access_token: PAGE_ACCESS_TOKEN } }
    );
    logger.log("Subscriptions updated!", "SUCCESS");
  } catch (err) { logger.log("setPageOnline: " + (err.response?.data?.error?.message || err.message), "WARN"); }
}

const cooldowns = new Map();

async function handleCommand(senderId, text) {
  const args = text.trim().split(/\s+/);
  const cmdName = args[0].slice(PREFIX.length).toLowerCase();
  const cmdArgs = args.slice(1);
  const command = commands.get(cmdName);
  if (!command) return sendMessage(senderId, `❓ Unknown command "${PREFIX}${cmdName}".\nType ${PREFIX}help to see all commands.`);
  const key = senderId + ":" + cmdName;
  const now = Date.now();
  if (cooldowns.has(key)) { const left = cooldowns.get(key) - now; if (left > 0) return sendMessage(senderId, `⏳ Wait ${(left/1000).toFixed(1)}s before using ${PREFIX}${cmdName} again.`); }
  cooldowns.set(key, now + 5000);
  const api = { send: (m) => sendMessage(senderId, m), sendMessage: (m) => sendMessage(senderId, m), commands, PREFIX, BOTNAME };
  const event = { senderId, text, args: cmdArgs };
  try {
    logger.log(`CMD: ${cmdName} | User: ${senderId}`, "CMD");
    await command.run({ api, event, args: cmdArgs });
  } catch (err) {
    logger.log(`Error in ${cmdName}: ${err.message}`, "ERROR");
    sendMessage(senderId, `⚠️ Something went wrong: ${err.message}`);
  }
}

async function handleAI(senderId, text) {
  logger.log(`AI from ${senderId}: ${text}`, "AI");
  addMemory(senderId, "user", text);
  const reply = await askAI(senderId, text);
  if (!reply) {
    await sendMessage(senderId, `Sorry, all AI services are currently busy. Please try again in a moment! 🙏`);
    return;
  }
  addMemory(senderId, "bot", reply);
  await sendMessage(senderId, reply);
}

async function handleMessage(senderId, text) {
  if (!text) return;
  await markSeen(senderId);
  await showTyping(senderId);

  if (text.startsWith(PREFIX)) {
    await handleCommand(senderId, text);
    return;
  }

  // Check if user is in a random chat — relay message to partner
  const rcCmd = commands.get("randomchat");
  if (rcCmd && rcCmd.relay) {
    const relayed = await rcCmd.relay(senderId, text);
    if (relayed) return; // message was forwarded, don't send to AI
  }

  // Not in random chat — respond with AI
  await handleAI(senderId, text);
}

const app = express();
app.use(bodyParser.json());

app.get("/webhook", (req, res) => {
  if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === VERIFY_TOKEN)
    res.status(200).send(req.query["hub.challenge"]);
  else res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  const body = req.body;
  if (body.object !== "page") return res.sendStatus(404);
  for (const entry of body.entry) {
    for (const event of (entry.messaging || [])) {
      if (event.postback?.payload === "GET_STARTED") {
        const sid = event.sender.id;
        await markSeen(sid);
        await sendMessage(sid, `👋 Hey! I'm ${BOTNAME} 🤖\n\nJust talk to me like a friend — I'll respond with AI!\nOr type ${PREFIX}help to see all commands. 😊`);
        continue;
      }
      if (!event.message?.text) continue;
      const senderId = event.sender.id;
      const text = event.message.text;
      logger.log(`MSG from ${senderId}: ${text}`, "MSG");
      await handleMessage(senderId, text);
    }
  }
  res.status(200).send("EVENT_RECEIVED");
});

app.get("/", (req, res) => {
  res.send(`<html><head><title>${BOTNAME}</title></head><body style="font-family:sans-serif;text-align:center;padding:50px;background:#1a1a2e;color:white"><h1>🤖 ${BOTNAME}</h1><p style="color:#00ff88">✅ Online</p><p>Commands: ${commands.size} | AI: ${AI_MODELS.map(m=>m.name).join(" → ")}</p><p>Prefix: <strong>${PREFIX}</strong></p></body></html>`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  logger.log(`${BOTNAME} running on port ${PORT}`, "SYSTEM");
  logger.log(`Commands: ${commands.size}`, "SYSTEM");
  logger.log(`AI chain: ${AI_MODELS.map(m => m.name).join(" → ")}`, "SYSTEM");
  await setPageOnline();
});
