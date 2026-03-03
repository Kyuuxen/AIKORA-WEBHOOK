const axios = require("axios");

module.exports.config = {
  name: "webpilot",
  description: "Search the web with AI",
  usage: "!webpilot [query]",
  category: "AI",
};

module.exports.run = async function ({ api, args }) {
  const input = args.join(" ");
  if (!input) return api.send("🌐 Usage: !webpilot [query]\nExample: !webpilot latest news about AI");

  api.send("⏳ Searching the web...");

  try {
    const res = await axios.get("https://shin-apis.onrender.com/ai/webcopilot", {
      params: { question: input },
      timeout: 60000,
    });

    const result =
      res.data?.message ||
      res.data?.response ||
      res.data?.answer ||
      res.data?.result ||
      (typeof res.data === "string" ? res.data : null);

    api.send(`🌐 WEBPILOT\n━━━━━━━━━━━━━━\n${result || "No results found."}`);
  } catch (e) {
    api.send("❌ Webpilot search failed. Try again later.");
  }
};
