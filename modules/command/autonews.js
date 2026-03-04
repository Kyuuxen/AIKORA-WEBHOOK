const axios = require("axios");

module.exports.config = {
  name:        "autonews",
  description: "Auto post news to Facebook Page every 15 minutes",
  usage:       "!autonews status | test | on | off | reset",
  category:    "Automation",
};

// ── JSONBin.io as permanent external database ─────────────────────────────────
// Free forever, no signup needed if you have a bin ID
// Survives Render restarts because data is stored on JSONBin's servers
const JSONBIN_KEY = process.env.JSONBIN_KEY || "";
const JSONBIN_BIN = process.env.JSONBIN_BIN || "";

async function dbLoad() {
  if (!JSONBIN_KEY || !JSONBIN_BIN) return new Set();
  try {
    const res = await axios.get("https://api.jsonbin.io/v3/b/" + JSONBIN_BIN + "/latest", {
      headers: { "X-Master-Key": JSONBIN_KEY },
      timeout: 10000,
    });
    const arr = res.data && res.data.record && res.data.record.posted ? res.data.record.posted : [];
    console.log("[AutoNews] DB loaded: " + arr.length + " posted titles");
    return new Set(arr);
  } catch (e) {
    console.log("[AutoNews] DB load failed:", e.message);
    return new Set();
  }
}

async function dbSave(postedSet) {
  if (!JSONBIN_KEY || !JSONBIN_BIN) return;
  try {
    const arr = Array.from(postedSet).slice(-1000); // keep last 1000
    await axios.put(
      "https://api.jsonbin.io/v3/b/" + JSONBIN_BIN,
      { posted: arr },
      {
        headers: { "X-Master-Key": JSONBIN_KEY, "Content-Type": "application/json" },
        timeout: 10000,
      }
    );
  } catch (e) {
    console.log("[AutoNews] DB save failed:", e.message);
  }
}

// ── Normalize title for reliable comparison ───────────────────────────────────
function normalizeTitle(title) {
  return title.toLowerCase().replace(/[^a-z0-9]/g, "").substring(0, 50);
}

// ── Global state ──────────────────────────────────────────────────────────────
if (!global.autoNewsState) {
  global.autoNewsState = {
    posted:        new Set(),
    totalPosted:   0,
    lastPosted:    null,
    interval:      null,
    isPosting:     false,
    categoryIndex: 0,
    dbReady:       false,
  };
}
const state = global.autoNewsState;

// ── Load DB on startup ────────────────────────────────────────────────────────
async function initDB() {
  if (state.dbReady) return;
  const loaded = await dbLoad();
  loaded.forEach(function(t) { state.posted.add(t); });
  state.dbReady = true;
  console.log("[AutoNews] DB ready. " + state.posted.size + " titles loaded.");
}

// ── Categories to rotate through ─────────────────────────────────────────────
const CATEGORIES = ["general", "world", "nation", "business", "technology", "entertainment", "sports", "science", "health"];

// ── Fetch news ────────────────────────────────────────────────────────────────
async function fetchGNews(category) {
  try {
    const res = await axios.get("https://gnews.io/api/v4/top-headlines", {
      params: { lang: "en", country: "ph", topic: category, max: 10, apikey: process.env.GNEWS_API_KEY || "demo" },
      timeout: 15000,
    });
    return (res.data && res.data.articles) ? res.data.articles : [];
  } catch (e) {
    console.log("[AutoNews] GNews failed:", e.message);
    return [];
  }
}

async function fetchRSS() {
  try {
    const res = await axios.get(
      "https://api.rss2json.com/v1/api.json?rss_url=https://feeds.bbci.co.uk/news/rss.xml",
      { timeout: 15000 }
    );
    return ((res.data && res.data.items) ? res.data.items : []).map(function(item) {
      return {
        title:       item.title,
        description: item.description ? item.description.replace(/<[^>]*>/g, "").substring(0, 200) : "",
        url:         item.link,
        image:       (item.enclosure && item.enclosure.link) ? item.enclosure.link : (item.thumbnail || null),
        source:      { name: "BBC News" },
      };
    });
  } catch (e) {
    console.log("[AutoNews] RSS failed:", e.message);
    return [];
  }
}

async function getNews() {
  const category = CATEGORIES[state.categoryIndex % CATEGORIES.length];
  state.categoryIndex++;
  const gnews = await fetchGNews(category);
  if (gnews.length > 0) return gnews;
  return await fetchRSS();
}

// ── Duplicate check ───────────────────────────────────────────────────────────
function isDuplicate(article) {
  if (!article.title) return true;
  return state.posted.has(normalizeTitle(article.title));
}

function markPosted(article) {
  if (article.title) state.posted.add(normalizeTitle(article.title));
  state.totalPosted++;
  state.lastPosted = new Date().toISOString();
  dbSave(state.posted); // save to JSONBin async (dont await, non-blocking)
}

// ── Rewrite with AI ───────────────────────────────────────────────────────────
async function rewriteWithAI(text) {
  try {
    const res = await axios.get("https://api-library-kohi.onrender.com/api/copilot", {
      params: { prompt: "Rewrite this as a short engaging Facebook news post (max 3 sentences, no hashtags, no markdown, no asterisks):\n\n" + text },
      timeout: 25000,
    });
    const r = (res.data && res.data.data && res.data.data.text) ? res.data.data.text : null;
    if (r && r.length > 20) return r.replace(/\*\*/g, "").replace(/\*/g, "").trim();
  } catch (e) {}
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
      await axios.post("https://graph.facebook.com/v19.0/" + pageId + "/photos",
        { url: imageUrl, caption: fullCaption, access_token: feedToken }, { timeout: 20000 });
      return "photo";
    } catch (e) { console.log("[AutoNews] Photo failed, trying link:", e.message); }
  }
  await axios.post("https://graph.facebook.com/v19.0/" + pageId + "/feed",
    { message: caption, link: articleUrl || undefined, access_token: feedToken }, { timeout: 15000 });
  return "link";
}

// ── Main post ─────────────────────────────────────────────────────────────────
async function autoPost(notifyFn) {
  if (state.isPosting) { notifyFn("⏳ Still posting, skipping..."); return; }
  state.isPosting = true;
  try {
    await initDB(); // make sure DB is loaded

    let article = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const articles = await getNews();
      article = null;
      for (let i = 0; i < articles.length; i++) {
        if (!isDuplicate(articles[i])) { article = articles[i]; break; }
      }
      if (article) break;
      console.log("[AutoNews] All articles already posted, trying next category...");
    }

    if (!article) {
      // Clear oldest half and retry once more
      const arr = Array.from(state.posted);
      state.posted = new Set(arr.slice(Math.floor(arr.length / 2)));
      await dbSave(state.posted);
      const articles = await getNews();
      for (let i = 0; i < articles.length; i++) {
        if (!isDuplicate(articles[i])) { article = articles[i]; break; }
      }
    }

    if (!article) { notifyFn("⚠️ No new articles right now. Try again later."); return; }

    markPosted(article);

    const source    = (article.source && article.source.name) ? article.source.name : "News";
    const rawText   = article.title + "\n\n" + (article.description || "");
    const finalPost = await rewriteWithAI(rawText);
    const imageUrl  = article.image || article.urlToImage || makeHeadlineImage(article.title, source);
    const method    = await postToFacebook(finalPost, imageUrl, article.url);

    notifyFn("✅ Posted (" + method + "): " + article.title);
  } catch (err) {
    notifyFn("❌ Failed: " + err.message);
  } finally {
    state.isPosting = false;
  }
}

// ── Start ─────────────────────────────────────────────────────────────────────
function startAutoNews() {
  if (state.interval) return;
  if (!process.env.PAGE_ID || !process.env.PAGE_FEED_TOKEN) {
    console.log("[AutoNews] Not started: Missing PAGE_ID or PAGE_FEED_TOKEN.");
    return;
  }
  if (!JSONBIN_KEY || !JSONBIN_BIN) {
    console.log("[AutoNews] WARNING: JSONBIN_KEY or JSONBIN_BIN not set. Duplicates may occur after restarts!");
  }
  console.log("[AutoNews] Starting...");
  setTimeout(function() { autoPost(function(msg) { console.log("[AutoNews]", msg); }); }, 30000);
  state.interval = setInterval(function() { autoPost(function(msg) { console.log("[AutoNews]", msg); }); }, 15 * 60 * 1000);
}

startAutoNews();

// ── Command ───────────────────────────────────────────────────────────────────
module.exports.run = async function ({ api, args, event }) {
  const uid     = event.senderId;
  const ADMINS  = (process.env.ADMIN_IDS || process.env.ADMIN_ID || "").split(",").map(function(id) { return id.trim(); }).filter(Boolean);
  const isAdmin = ADMINS.length === 0 || ADMINS.includes(uid);
  const action  = (args[0] || "status").toLowerCase();

  if (action !== "status" && !isAdmin) return api.send("⛔ Admins only!");

  if (action === "status") {
    return api.send(
      "📰 AutoNews Status\n━━━━━━━━━━━━━━\n" +
      "Status: "          + (state.interval ? "🟢 Running" : "🔴 Stopped") + "\n" +
      "DB: "              + (JSONBIN_BIN ? "✅ JSONBin connected" : "⚠️ No DB (will repeat on restart)") + "\n" +
      "Titles remembered: " + state.posted.size + "\n" +
      "Total posted: "    + state.totalPosted + "\n" +
      "Last posted: "     + (state.lastPosted ? new Date(state.lastPosted).toLocaleString() : "Never")
    );
  }
  if (action === "test") { api.send("🧪 Posting now..."); await autoPost(function(m) { api.send(m); }); return; }
  if (action === "reset") {
    const c = state.posted.size;
    state.posted.clear();
    await dbSave(state.posted);
    return api.send("🔄 Cleared " + c + " titles from DB!");
  }
  if (action === "on") {
    if (state.interval) return api.send("Already running!");
    startAutoNews();
    return api.send("✅ AutoNews started!");
  }
  if (action === "off") {
    if (!state.interval) return api.send("Already stopped!");
    clearInterval(state.interval);
    state.interval = null;
    return api.send("🔴 AutoNews stopped.");
  }
  api.send("!autonews status | test | reset | on | off");
};
