"use strict";

const express    = require("express");
const bodyParser = require("body-parser");
const axios      = require("axios");
const logger     = require("./utils/log");
const loadCommands = require("./utils/loadCommands");

// ── Config ────────────────────────────────────────────────────────────────────
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN      = process.env.VERIFY_TOKEN || "mybotverify123";
const PREFIX            = process.env.PREFIX || "!";
const BOTNAME           = process.env.BOTNAME || "AIKORA";
const ADMIN_ID          = process.env.ADMIN_ID || "";

if (!PAGE_ACCESS_TOKEN) {
  logger.log("PAGE_ACCESS_TOKEN is not set in environment variables!", "ERROR");
  process.exit(1);
}

// ── Load commands ─────────────────────────────────────────────────────────────
const commands = loadCommands();

// ── Send message to Facebook ──────────────────────────────────────────────────
async function sendMessage(recipientId, text) {
  try {
    await axios.post(
      "https://graph.facebook.com/v19.0/me/messages",
      {
        recipient: { id: recipientId },
        message:   { text: String(text) }
      },
      { params: { access_token: PAGE_ACCESS_TOKEN } }
    );
  } catch (err) {
    logger.log("Send error: " + JSON.stringify(err.response?.data || err.message), "ERROR");
  }
}

// ── Cooldown tracker ──────────────────────────────────────────────────────────
const cooldowns = new Map();

// ── Handle incoming message ───────────────────────────────────────────────────
async function handleMessage(senderId, text) {
  if (!text || !text.startsWith(PREFIX)) return;

  const args    = text.trim().split(/\s+/);
  const cmdName = args[0].slice(PREFIX.length).toLowerCase();
  const cmdArgs = args.slice(1);

  const command = commands.get(cmdName);
  if (!command) {
    return sendMessage(senderId, `❓ Unknown command "${PREFIX}${cmdName}".\nType ${PREFIX}help to see all commands.`);
  }

  // Cooldown check (5 seconds per user per command)
  const cooldownKey = `${senderId}:${cmdName}`;
  const now = Date.now();
  if (cooldowns.has(cooldownKey)) {
    const remaining = cooldowns.get(cooldownKey) - now;
    if (remaining > 0) {
      return sendMessage(senderId, `⏳ Please wait ${(remaining / 1000).toFixed(1)}s before using ${PREFIX}${cmdName} again.`);
    }
  }
  cooldowns.set(cooldownKey, now + 5000);

  // Build fake api object so commands work the same way
  const api = {
    send: (msg) => sendMessage(senderId, msg),
    sendMessage: (msg) => sendMessage(senderId, msg),
    commands,
    PREFIX,
    BOTNAME,
  };

  const event = { senderId, text, args: cmdArgs };

  try {
    logger.log(`CMD: ${cmdName} | User: ${senderId}`, "CMD");
    await command.run({ api, event, args: cmdArgs });
  } catch (err) {
    logger.log(`Error in ${cmdName}: ${err.message}`, "ERROR");
    sendMessage(senderId, `⚠️ Something went wrong: ${err.message}`);
  }
}

// ── Express app ───────────────────────────────────────────────────────────────
const app = express();
app.use(bodyParser.json());

// Webhook verification
app.get("/webhook", (req, res) => {
  if (
    req.query["hub.mode"]          === "subscribe" &&
    req.query["hub.verify_token"]  === VERIFY_TOKEN
  ) {
    logger.log("Webhook verified by Facebook!", "SUCCESS");
    res.status(200).send(req.query["hub.challenge"]);
  } else {
    logger.log("Webhook verification failed!", "ERROR");
    res.sendStatus(403);
  }
});

// Receive messages
app.post("/webhook", async (req, res) => {
  const body = req.body;
  if (body.object !== "page") return res.sendStatus(404);

  for (const entry of body.entry) {
    for (const event of (entry.messaging || [])) {
      if (!event.message) continue;

      const senderId = event.sender.id;
      const text     = event.message.text;

      if (!text) continue;

      logger.log(`Message from ${senderId}: ${text}`, "CMD");
      await handleMessage(senderId, text);
    }
  }

  res.status(200).send("EVENT_RECEIVED");
});

// Status page
app.get("/", (req, res) => {
  res.send(`
    <html>
    <head><title>${BOTNAME}</title></head>
    <body style="font-family:sans-serif;text-align:center;padding:50px;background:#1a1a2e;color:white">
      <h1>🤖 ${BOTNAME}</h1>
      <p style="color:#00ff88">✅ Bot is running!</p>
      <p>Commands loaded: ${commands.size}</p>
      <p>Prefix: <strong>${PREFIX}</strong></p>
      <hr style="border-color:#333">
      <p style="color:#888">Facebook Messenger Bot</p>
    </body>
    </html>
  `);
});

// ── Start server ──────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  logger.log(`${BOTNAME} running on port ${PORT}`, "SYSTEM");
  logger.log(`Commands loaded: ${commands.size}`, "SYSTEM");
  logger.log("Waiting for messages...", "SYSTEM");
});
