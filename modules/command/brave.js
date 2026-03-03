const axios = require("axios");

module.exports.config = {
  name: "brave",
  description: "Search the web with Brave Search",
  usage: "!brave [search query]",
  category: "utility",
};

module.exports.run = async function ({ api, args }) {
  const query = args.join(" ");
  if (!query) return api.send("🔍 Usage: !brave [query]\nExample: !brave Best programming languages 2025");

  api.send("⏳ Searching...");

  try {
    const res = await axios.get(
      "https://betadash-api-swordslush-production.up.railway.app/brave",
      {
        params: { prompt: query },
        timeout: 60000,
      }
    );

    const data = res.data;

    // Handle different response formats
    if (typeof data === "string") return api.send(`🔍 BRAVE SEARCH\n━━━━━━━━━━━━━━\n${data}`);

    const results = data?.results || data?.web?.results || data?.data;
    if (!results || results.length === 0) return api.send(`❌ No results found for "${query}".`);

    let msg = `🔍 Brave: "${query}"\n━━━━━━━━━━━━━━\n`;
    results.slice(0, 4).forEach((r, i) => {
      msg += `${i + 1}. ${r.title}\n${r.url}\n\n`;
    });

    api.send(msg.trim());
  } catch (e) {
    api.send("❌ Brave search failed. Try again later.");
  }
};
