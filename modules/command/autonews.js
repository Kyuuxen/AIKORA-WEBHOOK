const axios = require("axios");

module.exports.config = {
  name: "autonews",
  description: "Auto post news to Facebook Page every 15 minutes",
  usage: "!autonews on | off",
  category: "Automation",
};

let interval = null;
let postedUrls = new Set();

// 📰 Fetch top news from NewsAPI
async function getNews() {
  try {
    const res = await axios.get("https://newsapi.org/v2/top-headlines", {
      params: {
        country: "ph",
        apiKey: process.env.NEWS_API_KEY,
        pageSize: 5,
      },
    });
    return res.data.articles || [];
  } catch (err) {
    console.error("Error fetching news:", err.response?.data || err.message);
    return [];
  }
}

// 🚀 Rewrite content using Copilot AI
async function rewriteWithCopilot(text) {
  try {
    const res = await axios.get("https://api-library-kohi.onrender.com/api/copilot", {
      params: {
        prompt: `Rewrite this as engaging Facebook news post:\n\n${text}`,
      },
      timeout: 60000,
    });
    return res.data?.data?.text || text;
  } catch (err) {
    console.error("Error rewriting with Copilot:", err.message);
    return text;
  }
}

// 📤 Post to Facebook Page feed using PAGE_FEED_TOKEN
async function postToFacebook(message) {
  try {
    await axios.post(
      `https://graph.facebook.com/${process.env.PAGE_ID}/feed`,
      {
        message,
        access_token: process.env.PAGE_FEED_TOKEN,
      }
    );
  } catch (err) {
    console.error("Error posting to Facebook:", err.response?.data || err.message);
  }
}

// 🔄 Auto-post news logic
async function autoPost(api) {
  const articles = await getNews();
  if (!articles.length) return;

  for (const article of articles) {
    if (!postedUrls.has(article.url)) {
      postedUrls.add(article.url);

      const content = `${article.title}\n\n${article.description || ""}\n\nRead more: ${article.url}`;
      const finalPost = await rewriteWithCopilot(content);

      await postToFacebook(finalPost);
      api.send(`✅ Posted: ${article.title}`);
      break; // post only one article per interval
    }
  }
}

// 🟢 Command handler
module.exports.run = async function ({ api, args }) {
  const action = args[0]?.toLowerCase();

  if (action === "on") {
    if (interval) return api.send("⚠️ Auto news already running.");

    interval = setInterval(() => autoPost(api), 15 * 60 * 1000); // every 15 minutes
    autoPost(api); // immediate first post
    return api.send("🚀 Auto news posting started (every 15 minutes).");
  }

  if (action === "off") {
    if (!interval) return api.send("⚠️ Auto news is not running.");

    clearInterval(interval);
    interval = null;
    return api.send("🛑 Auto news posting stopped.");
  }

  api.send("Usage: !autonews on | off");
};
