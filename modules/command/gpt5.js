const axios = require("axios");

module.exports.config = {
  name: "gpt5",
  description: "Ask GPT-5 AI",
  usage: "!gpt5 [question]",
  category: "AI",
};

module.exports.run = async function ({ api, args, event }) {
  const prompt = args.join(" ");
  if (!prompt) return api.send("🧠 Usage: !gpt5 [question]\nExample: !gpt5 Explain black holes simply");

  api.send("⏳ GPT-5 is thinking...");

  try {
    const res = await axios.get("https://api-library-kohi.onrender.com/api/pollination-ai", {
      params: { prompt, model: "openai-large", user: event.senderId },
      timeout: 60000,
    });

    const answer = res.data?.data;
    api.send(`🧠 GPT-5\n━━━━━━━━━━━━━━\n${answer || "No response."}`);
  } catch (e) {
    api.send("❌ GPT-5 server is busy right now. Try again later.");
  }
};
