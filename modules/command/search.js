const axios = require("axios");

module.exports.config = {
  name: "search",
  description: "Search the web with Brave",
  usage: "!search [query]",
  category: "utility",
};

module.exports.run = async function ({ api, args }) {
  const query = args.join(" ");
  if (!query) return api.send("🔍 Usage: !search [query]");

  try {
    const res = await axios.get("https://betadash-api-swordslush-production.up.railway.app/brave", {
      params: { prompt: query }
    });
    const results = res.data.results || res.data;
    api.send(`🔍 ${query}\n━━━━━━━━━━━━━━\n${JSON.stringify(results).substring(0, 1500)}`);
  } catch (e) {
    api.send("❌ Search failed.");
  }
};
