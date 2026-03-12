const axios = require("axios");

module.exports.config = {
  name: "gverse",
  description: "Search for gnostic verses or scriptures based on your query",
  usage: "!gverse [your query]",
  category: "general",
};

module.exports.run = async function ({ api, args, event }) {
  const input = args.join(" ").trim();
  if (!input) {
    return api.send("Usage: !gverse [your query]");
  }

  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(
    input
  )}`;

  try {
    const { data } = await axios.get(url, { timeout: 8000 });

    const title = data?.title;
    const description = data?.description || data?.extract;
    const extract = data?.extract || "No summary available.";
    const pageUrl = data?.content_urls?.desktop?.page || "";

    if (!title || !description) {
      return api.send(
        `❌ I couldn't find any gnostic verses for "${input}". Try a different query.`
      );
    }

    const message = `🕊️ *${title}*\n\n*${description}*\n\n${extract}\n\n📖 ${pageUrl}`;

    return api.send(message);
  } catch (err) {
    if (err.response && err.response.status === 404) {
      return api.send(
        `❌ No gnostic verses found for "${input}". Try another query.`
      );
    } else {
      return api.send("❌ Something went wrong. Please try again.");
    }
  }
};