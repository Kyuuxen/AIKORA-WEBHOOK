const axios = require("axios");

module.exports.config = {
  name: "autonews",
  description: "Auto post news with images to Facebook Page every 15 minutes",
  usage: "!autonews on | off | status | test",
  category: "Automation",
};

// ── State ─────────────────────────────────────────────────────────────────────
let interval   = null;
let postedUrls = new Set();

// ── Fetch news ────────────────────────────────────────────────────────────────
async function getNews() {
  try {
    const res = await axios.get("https://gnews.io/api/v4/top-headlines", {
      params: {
        lang:   "en",
        country:"ph",
        max:    10,
        apikey: process.env.GNEWS_API_KEY || "demo",
      },
      timeout: 15000,
    });
    return res.data?.articles || [];
  } catch (err) {
    try {
      const rss = await axios.get(
        "https://api.rss2json.com/v1/api.json?rss_url=https://feeds.bbci.co.uk/news/rss.xml",
        { timeout: 15000 }
      );
      return (rss.data?.items || []).map(item => ({
        title:       item.title,
        description: item.description?.replace(/<[^>]*>/g, "").substring(0, 200),
        url:         item.link,
        image:       item.enclosure?.link || item.thumbnail || null,
        source:      { name: "BBC News" },
      }));
    } catch (e) {
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
  } catch {
    return text;
  }
}

// ── Generate headline card image ──────────────────────────────────────────────
// Uses a free OG image generation service to create a news card with title overlay
function makeHeadlineImage(title, source) {
  const t = encodeURIComponent(title.substring(0, 80));
  const s = encodeURIComponent(source || "AIKORA NEWS");
  // Free service that generates a dark news card image with title text
  return `https://og.tailgraph.com/og?fontFamily=Roboto&title=${t}&titleTailwind=text-white+text-4xl+font-bold&text=${s}&textTailwind=text-white+text-xl+mt-2&logoTailwind=h-8&bgTailwind=bg-gray-900&footer=AIKORA+NEWS&footerTailwind=text-gray-400`;
}

// ── Post photo to Facebook Page ───────────────────────────────────────────────
async function postToFacebook(caption, imageUrl, articleUrl) {
  const pageId    = process.env.PAGE_ID;
  const feedToken = process.env.PAGE_FEED_TOKEN;

  if (!pageId || !feedToken) throw new Error("PAGE_ID or PAGE_FEED_TOKEN not set.");

  const fullCaption = caption + (articleUrl ? `\n\n🔗 Read more: ${articleUrl}` : "");

  // Method 1: Post as photo (shows image with caption — like Rappler style)
  if (imageUrl) {
    try {
      await axios.post(
        `https://graph.facebook.com/v19.0/${pageId}/photos`,
        {
          url:          imageUrl,
          caption:      fullCaption,
          access_token: feedToken,
        },
        { timeout: 20000 }
      );
      return "photo";
    } catch (photoErr) {
      console.log("Photo post failed, falling back to link post:", photoErr.response?.data?.error?.message);
      // Fall through to link post
    }
  }

  // Method 2: Post as link (Facebook auto-generates a preview card with image)
  try {
    await axios.post(
      `https://graph.facebook.com/v19.0/${pageId}/feed`,
      {
        message:      caption,
        link:         articleUrl || undefined,
        access_token: feedToken,
      },
      { timeout: 15000 }
    );
    return "link";
  } catch (err) {
    const fbError = err.response?.data?.error;
    throw new Error(fbError ? `Facebook Error ${fbError.code}: ${fbError.message}` : err.message);
  }
}

// ── Main auto-post logic ──────────────────────────────────────────────────────
async function autoPost(notifyFn) {
  try {
    const articles = await getNews();
    if (!articles.length) return notifyFn("⚠️ No news articles found.");

    const article = articles.find(a => !postedUrls.has(a.url));
    if (!article) {
      postedUrls.clear();
      return notifyFn("🔄 All recent news posted. Resetting list...");
    }

    postedUrls.add(article.url);

    const source     = article.source?.name || "News";
    const rawContent = `${article.title}\n\n${article.description || ""}`;
    const finalPost  = await rewriteWithCopilot(rawContent);

    // Use article's own image, or generate a headline card
    const imageUrl = article.image || article.urlToImage || makeHeadlineImage(article.title, source);

    const method = await postToFacebook(finalPost, imageUrl, article.url);
    notifyFn(`✅ Posted (${method}): ${article.title}`);

  } catch (err) {
    notifyFn(`❌ Auto-post failed: ${err.message}`);
    console.error("autoPost error:", err.message);
  }
}

// ── Command handler ───────────────────────────────────────────────────────────
module.exports.run = async function ({ api, args, event }) {
  const action   = args[0]?.toLowerCase();
  const senderId = event.senderId;
  const notify   = (msg) => api.send(msg, senderId);

  if (action === "on") {
    if (interval) return api.send("⚠️ Already running. Use !autonews off to stop first.");

    if (!process.env.PAGE_ID || !process.env.PAGE_FEED_TOKEN) {
      return api.send("❌ Missing PAGE_ID or PAGE_FEED_TOKEN in Render environment.");
    }

    await autoPost(notify);
    interval = setInterval(() => autoPost(notify), 15 * 60 * 1000);
    return api.send("🚀 Auto news started!\n📸 Posts with images every 15 minutes.\nType !autonews off to stop.");
  }

  if (action === "off") {
    if (!interval) return api.send("⚠️ Auto news is not running.");
    clearInterval(interval);
    interval = null;
    return api.send("🛑 Auto news stopped.");
  }

  if (action === "test") {
    notify("⏳ Testing news post with image...");
    await autoPost(notify);
    return;
  }

  if (action === "status") {
    return api.send(
      `📊 Auto News Status\n` +
      `━━━━━━━━━━━━━━\n` +
      `Status: ${interval ? "🟢 Running" : "🔴 Stopped"}\n` +
      `Articles posted: ${postedUrls.size}\n` +
      `PAGE_ID: ${process.env.PAGE_ID ? "✅" : "❌"}\n` +
      `PAGE_FEED_TOKEN: ${process.env.PAGE_FEED_TOKEN ? "✅" : "❌"}\n` +
      `GNEWS_API_KEY: ${process.env.GNEWS_API_KEY ? "✅" : "⚠️ using demo"}`
    );
  }

  api.send(
    "📰 Auto News Commands:\n" +
    "!autonews on     → Start auto posting with images\n" +
    "!autonews off    → Stop auto posting\n" +
    "!autonews test   → Test one post now\n" +
    "!autonews status → Check status"
  );
};
