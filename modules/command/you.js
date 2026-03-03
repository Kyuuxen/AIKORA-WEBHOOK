const axios = require("axios");

module.exports.config = {
  name: "you",
  description: "Search and ask You.com AI",
  usage: "!you [question]",
  category: "AI",
};

module.exports.run = async function ({ api, args }) {
  const prompt = args.join(" ");
  if (!prompt) return api.send("🔍 Usage: !you [question]\nExample: !you What happened in the news today?");

  api.send("⏳ Searching You.com...");

  try {
    const res = await axios.get(
      "https://betadash-api-swordslush-production.up.railway.app/you",
      {
        params: { chat: prompt },
        timeout: 60000,
      }
    );

    const result =
      res.data?.message ||
      res.data?.response ||
      res.data?.answer ||
      (typeof res.data === "string" ? res.data : null);

    api.send(`🔍 YOU.COM\n━━━━━━━━━━━━━━\n${result || "No response."}`);
  } catch (e) {
    api.send("❌ You.com is currently down. Try again later.");
  }
};
