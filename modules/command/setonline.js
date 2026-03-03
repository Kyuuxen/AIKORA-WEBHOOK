const axios = require("axios");

module.exports.config = {
  name: "setonline",
  description: "Set Facebook page to always online and configure messenger profile",
  usage: "!setonline",
  category: "Admin",
};

module.exports.run = async function ({ api }) {
  const token = process.env.PAGE_ACCESS_TOKEN;
  if (!token) return api.send("❌ PAGE_ACCESS_TOKEN not set.");

  api.send("⏳ Setting page online status...");

  let results = [];

  // Step 1: Set messenger profile (greeting + get started button)
  try {
    await axios.post(
      "https://graph.facebook.com/v19.0/me/messenger_profile",
      {
        greeting: [
          { locale: "default", text: "Hi! I'm AIKORA 🤖\nType !help to see all commands!" }
        ],
        get_started: { payload: "GET_STARTED" },
        ice_breakers: [
          { question: "What can you do?", payload: "HELP" },
          { question: "Get started", payload: "GET_STARTED" }
        ]
      },
      { params: { access_token: token } }
    );
    results.push("✅ Messenger profile set");
  } catch (e) {
    results.push("❌ Messenger profile: " + (e.response?.data?.error?.message || e.message));
  }

  // Step 2: Subscribe to webhook fields
  try {
    await axios.post(
      "https://graph.facebook.com/v19.0/me/subscribed_apps",
      {
        subscribed_fields: [
          "messages",
          "messaging_postbacks",
          "messaging_optins",
          "message_reads",
          "message_deliveries"
        ]
      },
      { params: { access_token: token } }
    );
    results.push("✅ Webhook subscriptions updated");
  } catch (e) {
    results.push("❌ Subscriptions: " + (e.response?.data?.error?.message || e.message));
  }

  // Step 3: Mark page as always open
  try {
    const pageId    = process.env.PAGE_ID;
    const feedToken = process.env.PAGE_FEED_TOKEN;
    if (pageId && feedToken) {
      await axios.post(
        `https://graph.facebook.com/v19.0/${pageId}`,
        { is_always_open: true },
        { params: { access_token: feedToken } }
      );
      results.push("✅ Page set to always open");
    } else {
      results.push("⚠️ PAGE_ID or PAGE_FEED_TOKEN not set — skipped");
    }
  } catch (e) {
    results.push("❌ Always open: " + (e.response?.data?.error?.message || e.message));
  }

  // Step 4: Send mark_seen to confirm bot is active
  try {
    await axios.post(
      "https://graph.facebook.com/v19.0/me/messages",
      {
        recipient:     { id: process.env.ADMIN_ID || "me" },
        sender_action: "mark_seen"
      },
      { params: { access_token: token } }
    );
    results.push("✅ Bot marked as active");
  } catch (e) {
    results.push("⚠️ Mark seen: skipped");
  }

  api.send(
    "📊 Set Online Results\n" +
    "━━━━━━━━━━━━━━\n" +
    results.join("\n") +
    "\n\n⏱ Badge update may take up to 24 hours."
  );
};
