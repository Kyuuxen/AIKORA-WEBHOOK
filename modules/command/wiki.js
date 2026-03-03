const axios = require("axios");

module.exports.config = {
  name: "wiki",
  description: "Search Wikipedia",
  usage: "!wiki [topic] or !wiki random",
  category: "utility",
};

module.exports.run = async function ({ api, args }) {
  const query = args.join(" ").trim();
  if (!query) return api.send("Usage: !wiki [topic]\nExample: !wiki Albert Einstein\nTip: !wiki random for a random article");

  try {
    if (query.toLowerCase() === "random") {
      const res = await axios.get("https://en.wikipedia.org/api/rest_v1/page/random/summary");
      const d = res.data;
      api.send(`📖 ${d.title}\n━━━━━━━━━━━━━━\n${d.extract}\n\n🔗 ${d.content_urls.desktop.page}`);
    } else if (query.toLowerCase() === "today") {
      const now = new Date();
      const mm = String(now.getMonth() + 1).padStart(2, "0");
      const dd = String(now.getDate()).padStart(2, "0");
      const res = await axios.get(`https://en.wikipedia.org/api/rest_v1/feed/onthisday/selected/${mm}/${dd}`);
      const events = res.data.selected;
      const e = events[Math.floor(Math.random() * events.length)];
      api.send(`📅 Today in History (${mm}/${dd})\n━━━━━━━━━━━━━━\n${e.year}: ${e.text}`);
    } else {
      const res = await axios.get(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`);
      const d = res.data;
      if (d.type === "disambiguation") return api.send(`"${d.title}" is too broad. Be more specific.`);
      api.send(`📖 ${d.title}\n━━━━━━━━━━━━━━\n${d.extract}\n\n🔗 ${d.content_urls.desktop.page}`);
    }
  } catch (e) {
    api.send(`❌ Nothing found for "${query}".`);
  }
};
