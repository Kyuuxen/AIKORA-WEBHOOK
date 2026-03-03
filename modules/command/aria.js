const axios = require("axios");

module.exports.config = {
  name: "aria",
  description: "Ask Aria AI a question",
  usage: "!aria [question]",
  category: "AI",
};

module.exports.run = async function ({ api, args }) {
  const prompt = args.join(" ");
  if (!prompt) return api.send("🤖 Usage: !aria [question]\nExample: !aria What is gravity?");

  api.send("⏳ Thinking...");

  try {
    const res = await axios.get("https://betadash-api-swordslush-production.up.railway.app/Aria", {
      params: { prompt }
    });
    api.send(`🤖 Aria\n━━━━━━━━━━━━━━\n${res.data.message || res.data.response || res.data}`);
  } catch (e) {
    api.send("❌ Aria AI is currently offline.");
  }
};
