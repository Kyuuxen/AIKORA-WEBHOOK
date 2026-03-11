const axios = require("axios");

module.exports.config = {
  name: "gverse",
  description: "Search for gnostic verses or scriptures based on your query",
  usage: "!gverse [your query]",
  category: "general",
};

module.exports.run = async function ({ api, args, event }) {
  const senderId = event.senderId;
  const input = args.join(" ").trim();

  if (!input) return api.send("Usage: !gverse [your query]");

  const sanitized = encodeURIComponent(input.replace(/\s+/g, "_"));
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${sanitized}`;

  try {
    const res = await axios.get(url, { timeout: 8000 });
    const data = res.data;

    if (!data.title || !data.description) {
      return api.send(`❌ I couldn't find any gnostic verses for "${input}". Try a different query.`);
    }

    const title = data.title;
    const description = data.description;
    const extract = data.extract || "No summary available.";
    const pageUrl = data.content_urls.desktop.page || data.content_urls.desktop.page || "";

    const message = `🕊️ *${title}*\n\n*${description}*\n\n${extract}\n\n📖 ${pageUrl}`;

    api.send(message);
  } catch (err) {
    if (err.response && err.response.status === 404) {
      api.send(`❌ No gnostic verses found for "${input}". Try another query.`);
    } else {
      api.send("❌ Something went wrong. Please try again.");
    }
  }
};