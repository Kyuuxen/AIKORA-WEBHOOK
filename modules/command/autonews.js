const axios = require("axios");

module.exports.config = {
  name: "autonews",
  description: "Auto post news to Facebook Page every 15 minutes",
  usage: "!autonews on | off",
  category: "Automation",
};

let interval = null;
let postedUrls = new Set();

// 📰 Get News
async function getNews() {
  const res = await axios.get("https://newsapi.org/v2/top-headlines", {
    params: {
      country: "ph",
      apiKey: process.env.NEWS_API_KEY,
      pageSize: 5,
    },
  });

  return res.data.articles;
}

// 🚀 Rewrite using Copilot
async function rewriteWithCopilot(text) {
  try {
    const res = await axios.get("https://api-library-kohi.onrender.com/api/copilot", {
      params: {
        prompt: `Rewrite this as engaging Facebook news post:\n\n${text}`,
      },
      timeout: 60000,
    });

    return res.data?.data?.text || text;
  } catch {
    return text;
  }
}

// 📤 Post to FB Page
async function postToFacebook(message) {
  await axios.post(
    `https://graph.facebook.com/${process.env.PAGE_ID}/feed`,
    {
      message,
      access_token: process.env.PAGE_ACCESS_TOKEN,
    }
  );
}

// 🔄 Auto Post Logic
async function autoPost(api) {
  try {
    const articles = await getNews();

    for (const article of articles) {
      if (!postedUrls.has(article.url)) {
        postedUrls.add(article.url);

        const content = `${article.title}\n\n${article.description}\n\nRead more: ${article.url}`;
        const finalPost = await rewriteWithCopilot(content);

        await postToFacebook(finalPost);
        api.send(`✅ Posted: ${article.title}`);
        break;
      }
    }
  } catch (err) {
    api.send("❌ Error auto posting news.");
  }
}

module.exports.run = async function ({ api, args }) {
  const action = args[0]?.toLowerCase();

  if (action === "on") {
    if (interval) return api.send("⚠️ Auto news already running.");

    interval = setInterval(() => autoPost(api), 15 * 60 * 1000);
    autoPost(api);

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
