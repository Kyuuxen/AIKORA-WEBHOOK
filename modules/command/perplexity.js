const axios = require("axios");

module.exports.config = {
  name: "perplexity",
  description: "Deep reasoning AI by Perplexity",
  usage: "!perplexity [question]",
  category: "AI",
};

module.exports.run = async function ({ api, args, event }) {
  const prompt = args.join(" ");
  if (!prompt) return api.send("🧠 Usage: !perplexity [question]\nExample: !perplexity Why is the sky blue?");

  api.send("⏳ Perplexity is reasoning...");

  try {
    const res = await axios.get("https://api-library-kohi.onrender.com/api/pollination-ai", {
      params: { prompt, model: "perplexity-reasoning", user: event.senderId },
      timeout: 60000,
    });

    const answer = res.data?.data;
    api.send(`🧠 PERPLEXITY\n━━━━━━━━━━━━━━\n${answer || "No response."}`);
  } catch (e) {
    api.send("❌ Perplexity is offline or busy. Try again later.");
  }
};
