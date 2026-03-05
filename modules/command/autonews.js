const axios = require("axios");

module.exports.config = {
  name:        "autonews",
  description: "Auto post news to Facebook Page every 15 minutes",
  usage:       "!autonews status | test | on | off | reset | mode [mode]",
  category:    "Automation",
};

// ── News modes ────────────────────────────────────────────────────────────────
const NEWS_MODES = {
  "philippines": {
    label:   "🇵🇭 Philippines Only",
    country: "ph",
    lang:    "en",
    topics:  ["general", "nation", "business", "technology", "sports", "health"],
    rss:     "https://api.rss2json.com/v1/api.json?rss_url=https://www.rappler.com/feed",
  },
  "world": {
    label:   "🌍 World News",
    country: "us",
    lang:    "en",
    topics:  ["world", "general", "business", "technology", "science", "health"],
    rss:     "https://api.rss2json.com/v1/api.json?rss_url=https://feeds.bbci.co.uk/news/world/rss.xml",
  },
  "technology": {
    label:   "💻 Technology",
    country: "us",
    lang:    "en",
    topics:  ["technology"],
    rss:     "https://api.rss2json.com/v1/api.json?rss_url=https://feeds.feedburner.com/TechCrunch",
  },
  "sports": {
    label:   "⚽ Sports",
    country: "ph",
    lang:    "en",
    topics:  ["sports"],
    rss:     "https://api.rss2json.com/v1/api.json?rss_url=https://www.espn.com/espn/rss/news",
  },
  "entertainment": {
    label:   "🎬 Entertainment",
    country: "ph",
    lang:    "en",
    topics:  ["entertainment"],
    rss:     "https://api.rss2json.com/v1/api.json?rss_url=https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml",
  },
  "business": {
    label:   "💼 Business",
    country: "ph",
    lang:    "en",
    topics:  ["business"],
    rss:     "https://api.rss2json.com/v1/api.json?rss_url=https://feeds.bbci.co.uk/news/business/rss.xml",
  },
  "mixed": {
    label:   "🔀 Mixed (All Topics)",
    country: "ph",
    lang:    "en",
    topics:  ["general", "world", "nation", "business", "technology", "entertainment", "sports", "science", "health"],
    rss:     "https://api.rss2json.com/v1/api.json?rss_url=https://feeds.bbci.co.uk/news/rss.xml",
  },
};

// ── JSONBin DB ────────────────────────────────────────────────────────────────
const JSONBIN_KEY = process.env.JSONBIN_KEY || "";
const JSONBIN_BIN = process.env.JSONBIN_BIN || "";

async function dbLoad() {
  if (!JSONBIN_KEY || !JSONBIN_BIN) return { posted: new Set(), mode: "philippines" };
  try {
    const res = await axios.get("https://api.jsonbin.io/v3/b/" + JSONBIN_BIN + "/latest", {
      headers: { "X-Master-Key": JSONBIN_KEY },
      timeout: 10000,
    });
    const rec = res.data && res.data.record ? res.data.record : {};
    console.log("[AutoNews] DB loaded: " + (rec.posted ? rec.posted.length : 0) + " titles, mode: " + (rec.mode || "philippines"));
    return {
      posted: new Set(rec.posted || []),
      mode:   rec.mode || "philippines",
    };
  } catch(e) {
    console.log("[AutoNews] DB load failed:", e.message);
    return { posted: new Set(), mode: "philippines" };
  }
}

async function dbSave(postedSet, mode) {
  if (!JSONBIN_KEY || !JSONBIN_BIN) return;
  try {
    await axios.put(
      "https://api.jsonbin.io/v3/b/" + JSONBIN_BIN,
      { posted: Array.from(postedSet).slice(-1000), mode: mode },
      { headers: { "X-Master-Key": JSONBIN_KEY, "Content-Type": "application/json" }, timeout: 10000 }
    );
  } catch(e) { console.log("[AutoNews] DB save failed:", e.message); }
}

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
    mode:          "philippines", // default mode
  };
}
const state = global.autoNewsState;

async function initDB() {
  if (state.dbReady) return;
  const data = await dbLoad();
  data.posted.forEach(function(t) { state.posted.add(t); });
  state.mode    = data.mode || "philippines";
  state.dbReady = true;
  console.log("[AutoNews] DB ready. Mode: " + state.mode + " | " + state.posted.size + " titles loaded.");
}

// ── Fetch news based on current mode ─────────────────────────────────────────
async function fetchNews() {
  const modeConfig = NEWS_MODES[state.mode] || NEWS_MODES["philippines"];
  const topic      = modeConfig.topics[state.categoryIndex % modeConfig.topics.length];
  state.categoryIndex++;

  // Try GNews API
  try {
    const res = await axios.get("https://gnews.io/api/v4/top-headlines", {
      params: {
        lang:    modeConfig.lang,
        country: modeConfig.country,
        topic:   topic,
        max:     20,
        apikey:  process.env.GNEWS_API_KEY || "demo",
      },
      timeout: 15000,
    });
    const articles = (res.data && res.data.articles) ? res.data.articles : [];
    if (articles.length > 0) {
      console.log("[AutoNews] GNews (" + state.mode + "/" + topic + "): " + articles.length + " articles");
      return articles;
    }
  } catch(e) { console.log("[AutoNews] GNews failed:", e.message); }

  // Fallback RSS
  try {
    const rss  = await axios.get(modeConfig.rss, { timeout: 15000 });
    const items = (rss.data && rss.data.items) ? rss.data.items : [];
    console.log("[AutoNews] RSS fallback: " + items.length + " articles");
    return items.map(function(item) {
      return {
        title:       item.title,
        description: item.description ? item.description.replace(/<[^>]*>/g, "").substring(0, 200) : "",
        url:         item.link,
        image:       (item.enclosure && item.enclosure.link) ? item.enclosure.link : (item.thumbnail || null),
        source:      { name: rss.data.feed ? rss.data.feed.title : "News" },
      };
    });
  } catch(e) { console.log("[AutoNews] RSS failed:", e.message); }

  // Last resort BBC
  try {
    const rss  = await axios.get("https://api.rss2json.com/v1/api.json?rss_url=https://feeds.bbci.co.uk/news/rss.xml", { timeout: 15000 });
    const items = (rss.data && rss.data.items) ? rss.data.items : [];
    return items.map(function(item) {
      return {
        title:  item.title,
        url:    item.link,
        image:  (item.enclosure && item.enclosure.link) ? item.enclosure.link : (item.thumbnail || null),
        source: { name: "BBC News" },
      };
    });
  } catch(e) { return []; }
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
  } catch(e) {}
  return text;
}

// ── Headline image ────────────────────────────────────────────────────────────
function makeHeadlineImage(title, source) {
  const t = encodeURIComponent(title.substring(0, 80));
  const s = encodeURIComponent(source || "AIKORA NEWS");
  return "https://og.tailgraph.com/og?fontFamily=Roboto&title=" + t + "&titleTailwind=text-white+text-4xl+font-bold&text=" + s + "&textTailwind=text-white+text-xl+mt-2&bgTailwind=bg-gray-900&footer=AIKORA+NEWS&footerTailwind=text-gray-400";
}

// ── Post to Facebook Page ─────────────────────────────────────────────────────
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
    } catch(e) { console.log("[AutoNews] Photo failed, trying link:", e.message); }
  }
  await axios.post("https://graph.facebook.com/v19.0/" + pageId + "/feed",
    { message: fullCaption, link: articleUrl || undefined, access_token: feedToken }, { timeout: 15000 });
  return "link";
}

// ── Main post ─────────────────────────────────────────────────────────────────
async function autoPost(notifyFn) {
  if (state.isPosting) { notifyFn("⏳ Still posting, skipping..."); return; }
  state.isPosting = true;
  try {
    await initDB();
    let article = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const articles = await fetchNews();
      for (let i = 0; i < articles.length; i++) {
        if (articles[i].title && !state.posted.has(normalizeTitle(articles[i].title))) {
          article = articles[i]; break;
        }
      }
      if (article) break;
      console.log("[AutoNews] All articles posted, trying next category...");
    }
    if (!article) {
      const arr = Array.from(state.posted);
      state.posted = new Set(arr.slice(Math.floor(arr.length / 2)));
      await dbSave(state.posted, state.mode);
      const articles = await fetchNews();
      for (let i = 0; i < articles.length; i++) {
        if (articles[i].title && !state.posted.has(normalizeTitle(articles[i].title))) {
          article = articles[i]; break;
        }
      }
    }
    if (!article) { notifyFn("⚠️ No new articles right now."); return; }

    state.posted.add(normalizeTitle(article.title));
    state.totalPosted++;
    state.lastPosted = new Date().toISOString();
    dbSave(state.posted, state.mode);

    const source    = (article.source && article.source.name) ? article.source.name : "News";
    const rawText   = article.title + "\n\n" + (article.description || "");
    const finalPost = await rewriteWithAI(rawText);
    const imageUrl  = article.image || article.urlToImage || makeHeadlineImage(article.title, source);
    const method    = await postToFacebook(finalPost, imageUrl, article.url);
    notifyFn("✅ [" + (NEWS_MODES[state.mode] ? NEWS_MODES[state.mode].label : state.mode) + "] Posted (" + method + "): " + article.title);

  } catch(err) {
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
  console.log("[AutoNews] Starting in mode: " + state.mode);
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
    const m = NEWS_MODES[state.mode] || NEWS_MODES["philippines"];
    return api.send(
      "📰 AutoNews Status\n━━━━━━━━━━━━━━\n" +
      "Status: "      + (state.interval ? "🟢 Running" : "🔴 Stopped") + "\n" +
      "Mode: "        + m.label + "\n" +
      "Total posted: "+ state.totalPosted + "\n" +
      "Last posted: " + (state.lastPosted ? new Date(state.lastPosted).toLocaleString() : "Never") + "\n" +
      "DB: "          + (JSONBIN_BIN ? "✅ JSONBin" : "⚠️ No DB")
    );
  }

  if (action === "mode") {
    const newMode = args[1] ? args[1].toLowerCase() : null;

    // Show available modes if no argument
    if (!newMode || !NEWS_MODES[newMode]) {
      const modeList = Object.keys(NEWS_MODES).map(function(k) {
        return (k === state.mode ? "✅ " : "   ") + "!" + "autonews mode " + k + " — " + NEWS_MODES[k].label;
      }).join("\n");
      return api.send("📰 Available News Modes:\n━━━━━━━━━━━━━━\n" + modeList + "\n\nCurrent: " + (NEWS_MODES[state.mode] ? NEWS_MODES[state.mode].label : state.mode));
    }

    state.mode          = newMode;
    state.categoryIndex = 0;
    state.posted.clear(); // clear history when switching mode
    await dbSave(state.posted, state.mode);
    return api.send("✅ News mode changed to: " + NEWS_MODES[newMode].label + "\n\nHistory cleared. Next post will use new mode!");
  }

  if (action === "test") {
    api.send("🧪 Posting now in mode: " + (NEWS_MODES[state.mode] ? NEWS_MODES[state.mode].label : state.mode) + "...");
    await autoPost(function(msg) { api.send(msg); });
    return;
  }

  if (action === "reset") {
    const c = state.posted.size;
    state.posted.clear();
    await dbSave(state.posted, state.mode);
    return api.send("🔄 Cleared " + c + " titles. Fresh start!");
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

  api.send(
    "📰 AutoNews Commands\n━━━━━━━━━━━━━━\n" +
    "!autonews status       — Check status\n" +
    "!autonews mode         — Show all modes\n" +
    "!autonews mode philippines — 🇵🇭 PH news\n" +
    "!autonews mode world   — 🌍 World news\n" +
    "!autonews mode technology — 💻 Tech news\n" +
    "!autonews mode sports  — ⚽ Sports news\n" +
    "!autonews mode entertainment — 🎬 Showbiz\n" +
    "!autonews mode business — 💼 Business\n" +
    "!autonews mode mixed   — 🔀 All topics\n" +
    "!autonews test         — Post now\n" +
    "!autonews reset        — Clear history\n" +
    "!autonews on/off       — Start/Stop"
  );
};
