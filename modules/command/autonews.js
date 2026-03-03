const axios = require("axios");

module.exports.config = {
  name: "autonews",
  description: "Auto post news to Facebook Page every 15 minutes",
  usage: "!autonews on | off | status",
  category: "Automation",
};

// ── State ─────────────────────────────────────────────────────────────────────
let interval    = null;
let postedUrls  = new Set();
let adminSender = null; // stores who turned it on, so we can send status updates

// ── Fetch news using FREE API (no server restrictions) ────────────────────────
async function getNews() {
  try {
    // GNews API - free, works on cloud servers, no key needed for basic use
    const res = await axios.get("https://gnews.io/api/v4/top-headlines", {
      params: {
        lang: "en",
        country: "ph",        // Philippines news — change to "us" for US news
        max: 5,
        apikey: process.env.GNEWS_API_KEY || "demo", // free key at gnews.io
      },
      timeout: 15000,
    });
    return res.data?.articles || [];
  } catch (err) {
    // Fallback: use RSS-to-JSON (completely free, no key needed)
    try {
      const rss = await axios.get(
        "https://api.rss2json.com/v1/api.json?rss_url=https://feeds.bbci.co.uk/news/rss.xml",
        { timeout: 15000 }
      );
      return (rss.data?.items || []).map(item => ({
        title:       item.title,
        description: item.description?.replace(/<[^>]*>/g, "").substring(0, 200),
        url:         item.link,
        publishedAt: item.pubDate,
      }));
    } catch (e) {
      console.error("Both news sources failed:", e.message);
      return [];
    }
  }
}

// ── Rewrite using Copilot AI ──────────────────────────────────────────────────
async function rewriteWithCopilot(text) {
  try {
    const res = await axios.get("https://api-library-kohi.onrender.com/api/copilot", {
      params: {
        prompt: `Rewrite this as a short engaging Facebook news post (max 3 sentences, no hashtags):\n\n${text}`,
      },
      timeout: 30000,
    });
    return res.data?.data?.text || text;
  } catch (err) {
    return text; // fallback to original if AI fails
  }
}

// ── Post to Facebook Page feed ────────────────────────────────────────────────
async function postToFacebook(message) {
  const pageId    = process.env.PAGE_ID;
  const feedToken = process.env.PAGE_FEED_TOKEN;

  if (!pageId || !feedToken) {
    throw new Error("PAGE_ID or PAGE_FEED_TOKEN not set in Render environment variables.");
  }

  await axios.post(
    `https://graph.facebook.com/v19.0/${pageId}/feed`,
    {
      message,
      access_token: feedToken,
    },
    { timeout: 15000 }
  );
}

// ── Main auto-post logic ──────────────────────────────────────────────────────
async function autoPost(notifyFn) {
  try {
    const articles = await getNews();
    if (!articles.length) {
      notifyFn("⚠️ No news articles found.");
      return;
    }

    // Find first unposted article
    const article = articles.find(a => !postedUrls.has(a.url));
    if (!article) {
      postedUrls.clear(); // reset if all seen
      notifyFn("🔄 All recent news already posted. Resetting...");
      return;
    }

    postedUrls.add(article.url);

    const rawContent = `${article.title}\n\n${article.description || ""}\n\nRead more: ${article.url}`;
    const finalPost  = await rewriteWithCopilot(rawContent);

    await postToFacebook(finalPost);
    notifyFn(`✅ Posted: ${article.title}`);

  } catch (err) {
    notifyFn(`❌ Auto-post failed: ${err.message}`);
    console.error("autoPost error:", err.message);
  }
}

// ── Command handler ───────────────────────────────────────────────────────────
module.exports.run = async function ({ api, args, event }) {
  const action = args[0]?.toLowerCase();

  // notifyFn sends updates to whoever turned on autonews
  // FIX: we capture the senderId so setInterval can still send messages
  const senderId = event.senderId;
  const notify   = (msg) => api.send(msg, senderId);

  if (action === "on") {
    if (interval) return api.send("⚠️ Auto news is already running. Use !autonews off to stop.");

    const pageId    = process.env.PAGE_ID;
    const feedToken = process.env.PAGE_FEED_TOKEN;

    if (!pageId || !feedToken) {
      return api.send(
        "❌ Missing environment variables!\n\n" +
        "Add these in Render → Environment tab:\n" +
        "• PAGE_ID = your Facebook Page ID\n" +
        "• PAGE_FEED_TOKEN = your Page Access Token\n" +
        "• GNEWS_API_KEY = free key from gnews.io (optional)"
      );
    }

    adminSender = senderId;

    // Run immediately then every 15 minutes
    await autoPost(notify);
    interval = setInterval(() => autoPost(notify), 15 * 60 * 1000);

    return api.send("🚀 Auto news started!\n⏱ Posts every 15 minutes.\nType !autonews off to stop.");
  }

  if (action === "off") {
    if (!interval) return api.send("⚠️ Auto news is not running.");
    clearInterval(interval);
    interval    = null;
    adminSender = null;
    return api.send("🛑 Auto news stopped.");
  }

  if (action === "status") {
    return api.send(
      `📊 Auto News Status\n` +
      `━━━━━━━━━━━━━━\n` +
      `Status: ${interval ? "🟢 Running" : "🔴 Stopped"}\n` +
      `Articles posted this session: ${postedUrls.size}\n` +
      `PAGE_ID set: ${process.env.PAGE_ID ? "✅" : "❌"}\n` +
      `PAGE_FEED_TOKEN set: ${process.env.PAGE_FEED_TOKEN ? "✅" : "❌"}\n` +
      `GNEWS_API_KEY set: ${process.env.GNEWS_API_KEY ? "✅" : "⚠️ using demo"}`
    );
  }

  api.send(
    "📰 Auto News Commands:\n" +
    "!autonews on     → Start auto posting\n" +
    "!autonews off    → Stop auto posting\n" +
    "!autonews status → Check status"
  );
};
