"use strict";
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const app = express();

app.use(express.json());

const PAGE_ACCESS_TOKEN = "";
const VERIFY_TOKEN = "";
const PREFIX = "!";

// ── Commands ──────────────────────────────────────────────────────────────────
const commands = {
  ping: async (senderId) => {
    await sendMessage(senderId, "🏓 Pong! Bot is online!");
  },
  help: async (senderId) => {
    await sendMessage(senderId,
      "🤖 AIKORA Bot Commands:\n" +
      "!ping - Check if bot is online\n" +
      "!help - Show this menu\n" +
      "!say [text] - Bot repeats your text\n" +
      "!uid - Show your Facebook ID"
    );
  },
  say: async (senderId, args) => {
    if (!args.length) return sendMessage(senderId, "Give me something to say!");
    await sendMessage(senderId, args.join(" "));
  },
  uid: async (senderId) => {
    await sendMessage(senderId, "🪪 Your ID is: " + senderId);
  }
};

// ── Send message ──────────────────────────────────────────────────────────────
async function sendMessage(recipientId, text) {
  try {
    await axios.post(
      "https://graph.facebook.com/v18.0/me/messages",
      {
        recipient: { id: recipientId },
        message: { text: text }
      },
      { params: { access_token: PAGE_ACCESS_TOKEN } }
    );
  } catch (err) {
    console.error("Send error:", err.response ? err.response.data : err.message);
  }
}

// ── Webhook verify ────────────────────────────────────────────────────────────
app.get('/webhook', (req, res) => {
  const mode  = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('Webhook verified!');
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// ── Receive messages ──────────────────────────────────────────────────────────
app.post('/webhook', async (req, res) => {
  const body = req.body;
  if (body.object !== 'page') return res.sendStatus(404);

  for (const entry of body.entry) {
    for (const event of entry.messaging) {
      if (!event.message || !event.message.text) continue;

      const senderId = event.sender.id;
      const text = event.message.text.trim();

      console.log("Message from " + senderId + ": " + text);

      if (!text.startsWith(PREFIX)) continue;

      const args = text.slice(PREFIX.length).trim().split(/\s+/);
      const cmdName = args.shift().toLowerCase();

      if (commands[cmdName]) {
        await commands[cmdName](senderId, args);
      } else {
        await sendMessage(senderId, "❓ Unknown command. Type !help for the list.");
      }
    }
  }

  res.status(200).send("EVENT_RECEIVED");
});

app.get('/', (req, res) => res.send('AIKORA Bot is running!'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('AIKORA running on port ' + PORT));
