const axios = require("axios");
const fs    = require("fs");
const path  = require("path");
const crypto = require("crypto");

module.exports.config = {
  name:        "autonews",
  description: "Auto post news with images to Facebook Page every 15 minutes",
  usage:       "!autonews on | off | status | test | reset",
  category:    "Automation",
};

// ── Persistent storage ────────────────────────────────────────────────────────
// Stores URL hashes instead of full URLs
// A hash is only 8 characters vs 100+ for a full URL
// This means 1MB of storage = ~125,000 articles remembered (practically unlimited)
const DB_FILE = path.join(__dirname, ".autonews_db.json");

function hashUrl(url) {
  return crypto.createHash("md5").update(url).digest("hex").substring(0, 8);
}

function loadDB() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw  = fs.readFileSync(DB_FILE, "utf8");
      const data = JSON.parse(raw);
      return {
        hashes:      new Set(data.hashes || []),
        totalPosted: data.totalPosted  || 0,
        lastPosted:  data.lastPosted   || null,
        startedAt:   data.startedAt    || new Date().toISOString(),
      };
    }
  } catch (e) {
    console.log("[AutoNews] DB load error:", e.message);
  }
  return {
    hashes:      new Set(),
    totalPosted: 0,
    lastPosted:  null,
    startedAt:   new Date().toISOString(),
  };
}

function saveDB(db) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify({
      hashes:      Array.from(db.hashes), // unlimited — no slice
      totalPosted: db.totalPosted,
      lastPosted:  db.lastPosted,
      startedAt:   db.startedAt,
    }, null, 2), "utf8");
  } catch (e) {
    console.log("[AutoNews] DB save error:", e.message);
  }
}

function isPosted(url) {
  return db.hashes.has(hashUrl(url));
}

function markPosted(url) {
  db.hashes.add(hashUrl(url));
  db.totalPosted++;
  db.lastPosted = new Date().toISOString();
  saveDB(db);
}

const db = loadDB();
console.log("[AutoNews] DB loaded — " + db.hashes.size + " articles remembered (" + db.totalPosted + " total posted)");

// ── State ─────────────────────────────────────────────────────────────────────
let interval  = null;
let isPosting = false;

// ── Fetch news ────────────────────────────────────────────────────────────────
async function getNews() {
  // Try GNews
  try {
    const res = await axios.get("https://gnews.io/api/v4/top-headlines", {
      params: {
        lang:    "en",
        country: "ph",
        max:     20,
        apikey:  process.env.GNEWS_API_KEY || "demo",
      },
      timeout: 15000,
    });
    const articles = res.data && res.data.articles ? res.data.articles : [];
    if (articles.length > 0) {
      console.log("[AutoNews] GNews returned " + articles.length + " articles");
      return articles;
    }
  } catch (err) {
    console.log("[AutoNews] GNews failed:", err.message);
  }

  // Fallback BBC RSS
  try {
    const rss = await axios.get(
      "https://api.rss2json.com/v1/api.json?rss_url=https://feeds.bbci.co.uk/news/rss.xml",
      { timeout: 15000 }
    );
    const items = rss.data && rss.data.items ? rss.data.items : [];
    console.log("[AutoNews] BBC RSS returned " + items.length + " articles");
    return items.map(function(item) {
      return {
        title:       item.title,
        description: item.description ? item.description.replace(/<[^>]*>/g, "").substring(0, 200) : "",
        url:         item.link,
        image:       (item.enclosure && item.enclosure.link) ? item.enclosure.link : (item.thumbnail || null),
        source:      { name: "BBC News" },
      };
    });
  } catch (e) {
    console.log("[AutoNews] BBC RSS failed:", e.message);
    return [];
  }
}

// ── Rewrite with AI ───────────────────────────────────────────────────────────
async function rewriteWithAI(text) {
  try {
    const res = await axios.get("https://api-library-kohi.onrender.com/api/copilot", {
      params: {
        prompt: "Rewrite this as a short engaging Facebook news post (max 3 sentences, no hashtags, no markdown, no asterisks):\n\n" + text,
      },
      timeout: 30000,
    });
    const result = res.data && res.data.data && res.data.data.text ? res.data.data.text : null;
    if (result) return result;
  } catch (e) {
    console.log("[AutoNews] AI rewrite failed:", e.message);
  }
  return text;
}

// ── Headline image ────────────────────────────────────────────────────────────
function makeHeadlineImage(title, source) {
  const t = encodeURIComponent(title.substring(0, 80));
  const s = encodeURIComponent(source || "AIKORA NEWS");
  return "https://og.tailgraph.com/og?fontFamily=Roboto&title=" + t + "&titleTailwind=text-white+text-4xl+font-bold&text=" + s + "&textTailwind=text-white+text-xl+mt-2&bgTailwind=bg-gray-900&footer=AIKORA+NEWS&footerTailwind=text-gray-400";
}

// ── Post to Facebook ──────────────────────────────────────────────────────────
async function postToFacebook(caption, imageUrl, articleUrl) {
  const pageId    = process.env.PAGE_ID;
  const feedToken = process.env.PAGE_FEED_TOKEN;
  if (!pageId || !feedToken) throw new Error("PAGE_ID or PAGE_FEED_TOKEN not set.");

  const fullCaption = caption + (articleUrl ? "\n\n🔗 Read more: " + articleUrl : "");

  if (imageUrl) {
    try {
      await axios.post(
        "https://graph.facebook.com/v19.0/" + pageId + "/photos",
        { url: imageUrl, caption: fullCaption, access_token: feedToken },
        { timeout: 20000 }
      );
      return "photo";
    } catch (e) {
      console.log("[AutoNews] Photo post failed, trying link:", e.response && e.response.data && e.response.data.error ? e.response.data.error.message : e.message);
    }
  }

  await axios.post(
    "https://graph.facebook.com/v19.0/" + pageId + "/feed",
    { message: caption, link: articleUrl || undefined, access_token: feedToken },
    { timeout: 15000 }
  );
  return "link";
}

// ── Pick unposted article ─────────────────────────────────────────────────────
function pickArticle(articles) {
  for (let i = 0; i < articles.length; i++) {
    const a = articles[i];
    if (!a.url) continue;
    if (!isPosted(a.url)) return a;
  }
  return null;
}

// ── Main post logic ───────────────────────────────────────────────────────────
async function autoPost(notifyFn) {
  if (isPosting) {
    notifyFn("⏳ Still posting previous article, skipping...");
    return;
  }

  isPosting = true;
  try {
    const articles = await getNews();
    if (!articles.length) {
      notifyFn("⚠️ No news articles found from any source.");
      return;
    }

    let article = pickArticle(articles);

    // All current batch already posted — this is normal, just wait for new articles
    if (!article) {
      notifyFn("ℹ️ All " + articles.length + " current articles already posted. Waiting for new news...");
      return;
    }

    // Mark posted BEFORE posting to prevent duplicates
    markPosted(article.url);

    const source     = article.source && article.source.name ? article.source.name : "News";
    const rawContent = article.title + "\n\n" + (article.description || "");
    const finalPost  = await rewriteWithAI(rawContent);
    const imageUrl   = article.image || article.urlToImage || makeHeadlineImage(article.title, source);

    const method = await postToFacebook(finalPost, imageUrl, article.url);
    notifyFn("✅ Posted (" + method + "): " + article.title);

  } catch (err) {
    notifyFn("❌ Auto-post failed: " + err.message);
    console.error("[AutoNews] Error:", err.message);
  } finally {
    isPosting = false;
  }
}

// ── Start ─────────────────────────────────────────────────────────────────────
function startAutoNews() {
  if (interval) return;
  if (!process.env.PAGE_ID || !process.env.PAGE_FEED_TOKEN) {
    console.log("[AutoNews] Not started: Missing PAGE_ID or PAGE_FEED_TOKEN.");
    return;
  }

  console.log("[AutoNews] Starting... " + db.hashes.size + " URLs remembered.");

  // First post after 30 seconds
  setTimeout(function() {
    autoPost(function(msg) { console.log("[AutoNews]", msg); });
  }, 30000);

  // Every 15 minutes
  interval = setInterval(function() {
    autoPost(function(msg) { console.log("[AutoNews]", msg); });
  }, 15 * 60 * 1000);
}

startAutoNews();

// ── Command handler ───────────────────────────────────────────────────────────
module.exports.run = async function ({ api, args }) {
  const action = args[0] ? args[0].toLowerCase() : "status";

  if (action === "status") {
    const dbSizeBytes = fs.existsSync(DB_FILE) ? fs.statSync(DB_FILE).size : 0;
    const dbSizeKB    = (dbSizeBytes / 1024).toFixed(1);
    return api.send(
      "📰 AutoNews Status\n" +
      "━━━━━━━━━━━━━━\n" +
      "Status: "        + (interval ? "🟢 Running" : "🔴 Stopped") + "\n" +
      "Articles remembered: " + db.hashes.size + " (unlimited)\n" +
      "Total ever posted: "   + db.totalPosted  + "\n" +
      "DB file size: "        + dbSizeKB + " KB\n" +
      "Last posted: "         + (db.lastPosted ? new Date(db.lastPosted).toLocaleString() : "Never") + "\n" +
      "Running since: "       + (db.startedAt ? new Date(db.startedAt).toLocaleString() : "Unknown")
    );
  }

  if (action === "test") {
    api.send("🧪 Posting a test article now...");
    await autoPost(function(msg) { api.send(msg); });
    return;
  }

  if (action === "reset") {
    const count = db.hashes.size;
    db.hashes.clear();
    saveDB(db);
    return api.send("🔄 Cleared " + count + " remembered URLs. Fresh start next post!");
  }

  if (action === "on") {
    if (interval) return api.send("✅ AutoNews is already running!");
    startAutoNews();
    return api.send("✅ AutoNews started!");
  }

  if (action === "off") {
    if (!interval) return api.send("🔴 AutoNews is already stopped!");
    clearInterval(interval);
    interval = null;
    return api.send("🔴 AutoNews stopped.");
  }

  api.send(
    "📰 AutoNews Commands\n" +
    "━━━━━━━━━━━━━━\n" +
    "!autonews status — Check status + DB size\n" +
    "!autonews test   — Post now\n" +
    "!autonews reset  — Clear history\n" +
    "!autonews on     — Start\n" +
    "!autonews off    — Stop"
  );
};
