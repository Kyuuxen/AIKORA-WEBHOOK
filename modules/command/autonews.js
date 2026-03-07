const axios = require("axios");

module.exports.config = {
  name:        "autonews",
  description: "Auto post Philippines news to Facebook Page every 15 minutes",
  usage:       "!autonews status | test | on | off | reset",
  category:    "Automation",
};

// ── Config ────────────────────────────────────────────────────────────────────
const GNEWS_KEY   = process.env.GNEWS_API_KEY;
const PAGE_TOKEN  = process.env.PAGE_FEED_TOKEN || process.env.PAGE_ACCESS_TOKEN;
const PAGE_ID     = process.env.PAGE_ID;
const JSONBIN_KEY = process.env.JSONBIN_KEY;
const JSONBIN_BIN = process.env.JSONBIN_BIN;
const INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

// ── RSS feeds (Philippines) ───────────────────────────────────────────────────
const RSS_FEEDS = [
  "https://www.rappler.com/feed",
  "https://newsinfo.inquirer.net/feed",
  "https://www.philstar.com/rss/headlines",
  "https://mb.com.ph/feed",
  "https://www.gmanetwork.com/news/rss/news",
];

// ── RSS converters (fallback chain) ──────────────────────────────────────────
const RSS_CONVERTERS = [
  function(rssUrl) {
    return axios.get("https://api.rss2json.com/v1/api.json", {
      params: { rss_url: rssUrl }, timeout: 15000,
    }).then(function(r) {
      const items = r.data && r.data.items ? r.data.items : [];
      return items.map(function(i) { return { title: i.title, url: i.link }; });
    });
  },
  function(rssUrl) {
    return axios.get("https://rss-to-json-serverless-api.vercel.app/api?feedURL=" + encodeURIComponent(rssUrl), {
      timeout: 15000,
    }).then(function(r) {
      const items = r.data && r.data.items ? r.data.items : [];
      return items.map(function(i) { return { title: i.title, url: i.link || i.url }; });
    });
  },
  function(rssUrl) {
    return axios.get("https://api.allorigins.win/get?url=" + encodeURIComponent(rssUrl), {
      timeout: 15000,
    }).then(function(r) {
      const xml    = r.data && r.data.contents ? r.data.contents : "";
      const titles = xml.match(/<title><!\[CDATA\[([^\]]+)\]\]><\/title>/g) || xml.match(/<title>([^<]+)<\/title>/g) || [];
      const links  = xml.match(/<link>([^<]+)<\/link>/g) || [];
      const items  = [];
      for (let i = 1; i < Math.min(titles.length, links.length + 1); i++) {
        const title = (titles[i] || "").replace(/<[^>]+>/g, "").replace(/<!\[CDATA\[|\]\]>/g, "").trim();
        const url   = (links[i - 1] || "").replace(/<[^>]+>/g, "").trim();
        if (title && url) items.push({ title: title, url: url });
      }
      return items;
    });
  },
];

// ── Fetch from RSS feed ───────────────────────────────────────────────────────
async function fetchRSS(rssUrl) {
  for (let i = 0; i < RSS_CONVERTERS.length; i++) {
    try {
      const items = await RSS_CONVERTERS[i](rssUrl);
      if (items && items.length > 0) {
        console.log("[AutoNews] RSS converter " + i + " OK: " + items.length + " articles from " + rssUrl);
        return items;
      }
    } catch(e) {
      console.log("[AutoNews] RSS converter " + i + " failed: " + e.message);
    }
  }
  return [];
}

// ── Fetch from GNews ──────────────────────────────────────────────────────────
async function fetchGNews() {
  if (!GNEWS_KEY) return [];
  try {
    const res = await axios.get("https://gnews.io/api/v4/top-headlines", {
      params: { lang: "en", country: "ph", max: 10, apikey: GNEWS_KEY },
      timeout: 15000,
    });
    const articles = res.data && res.data.articles ? res.data.articles : [];
    return articles.map(function(a) { return { title: a.title, url: a.url }; });
  } catch(e) {
    console.log("[AutoNews] GNews failed:", e.message);
    return [];
  }
}

// ── Fetch all news ────────────────────────────────────────────────────────────
async function fetchNews() {
  const all = [];

  // Try GNews first
  const gnews = await fetchGNews();
  gnews.forEach(function(a) { all.push(a); });

  // Try each RSS feed
  for (let i = 0; i < RSS_FEEDS.length; i++) {
    try {
      const items = await fetchRSS(RSS_FEEDS[i]);
      items.forEach(function(a) { all.push(a); });
    } catch(e) {}
  }

  return all;
}

// ── JSONBin DB ────────────────────────────────────────────────────────────────
async function dbLoad() {
  if (!JSONBIN_KEY || !JSONBIN_BIN) return new Set();
  try {
    const res = await axios.get(
      "https://api.jsonbin.io/v3/b/" + JSONBIN_BIN + "/latest",
      { headers: { "X-Master-Key": JSONBIN_KEY }, timeout: 10000 }
    );
    const posted = (res.data && res.data.record && res.data.record.posted) || [];
    console.log("[AutoNews] DB loaded: " + posted.length + " posted titles");
    return new Set(posted);
  } catch(e) {
    console.log("[AutoNews] DB load failed:", e.message);
    return new Set();
  }
}

async function dbSave(postedSet) {
  if (!JSONBIN_KEY || !JSONBIN_BIN) return;
  try {
    await axios.put(
      "https://api.jsonbin.io/v3/b/" + JSONBIN_BIN,
      { posted: Array.from(postedSet).slice(-500) },
      { headers: { "X-Master-Key": JSONBIN_KEY, "Content-Type": "application/json" }, timeout: 10000 }
    );
  } catch(e) {
    console.log("[AutoNews] DB save failed:", e.message);
  }
}

// ── Normalize title for comparison ───────────────────────────────────────────
function normalize(title) {
  return title.toLowerCase().replace(/[^a-z0-9]/g, "").substring(0, 60);
}

// ── Post to Facebook Page ─────────────────────────────────────────────────────
async function postToPage(article) {
  if (!PAGE_TOKEN || !PAGE_ID) throw new Error("PAGE_TOKEN or PAGE_ID not set");
  await axios.post(
    "https://graph.facebook.com/v19.0/" + PAGE_ID + "/feed",
    { message: article.title, link: article.url, access_token: PAGE_TOKEN },
    { timeout: 15000 }
  );
}

// ── Global state ──────────────────────────────────────────────────────────────
if (!global.autoNewsState) {
  global.autoNewsState = { enabled: false, interval: null, posted: new Set() };
}
const state = global.autoNewsState;

// ── Auto post function ────────────────────────────────────────────────────────
async function autoPost(notifyFn) {
  try {
    // Reload posted from DB every cycle to stay in sync
    const dbPosted = await dbLoad();
    dbPosted.forEach(function(t) { state.posted.add(t); });

    const articles = await fetchNews();
    let article    = null;

    for (let i = 0; i < articles.length; i++) {
      const t = articles[i];
      if (t.title && !state.posted.has(normalize(t.title))) {
        article = t;
        break;
      }
    }

    if (!article) {
      // All posted — clear half and retry
      console.log("[AutoNews] All articles posted, clearing half of history...");
      const arr = Array.from(state.posted);
      state.posted = new Set(arr.slice(Math.floor(arr.length / 2)));
      await dbSave(state.posted);

      // Retry once after clearing
      for (let i = 0; i < articles.length; i++) {
        const t = articles[i];
        if (t.title && !state.posted.has(normalize(t.title))) {
          article = t;
          break;
        }
      }
    }

    if (!article) {
      console.log("[AutoNews] No new articles found.");
      notifyFn("⏳ No new articles yet. Will try again next cycle.");
      return;
    }

    await postToPage(article);
    state.posted.add(normalize(article.title));
    await dbSave(state.posted);

    console.log("[AutoNews] ✅ Posted: " + article.title.substring(0, 60));
    notifyFn("✅ Posted: " + article.title.substring(0, 60));

  } catch(e) {
    console.log("[AutoNews] Error:", e.message);
    notifyFn("❌ AutoNews error: " + e.message);
  }
}

// ── Start auto posting ────────────────────────────────────────────────────────
async function startAutoNews(notifyFn) {
  if (state.interval) clearInterval(state.interval);

  // Load posted history from DB on start
  const dbPosted = await dbLoad();
  dbPosted.forEach(function(t) { state.posted.add(t); });

  state.enabled  = true;
  state.interval = setInterval(function() {
    autoPost(function(msg) { console.log("[AutoNews]", msg); });
  }, INTERVAL_MS);

  console.log("[AutoNews] Started. Loaded " + state.posted.size + " posted titles.");
  notifyFn("✅ AutoNews started! Posting every 15 minutes.");
}

// ── Auto-start on boot ────────────────────────────────────────────────────────
setTimeout(function() {
  startAutoNews(function(msg) { console.log("[AutoNews]", msg); });
  console.log("[AutoNews] Auto-started on boot.");
}, 5000);

// ── Command ───────────────────────────────────────────────────────────────────
module.exports.run = async function ({ api, args }) {
  const action = (args[0] || "status").toLowerCase();

  if (action === "status") {
    return api.send(
      "📰 AutoNews Status\n━━━━━━━━━━━━━━\n" +
      "Status: "   + (state.enabled ? "🟢 Running" : "🔴 Stopped") + "\n" +
      "Posted: "   + state.posted.size + " articles\n" +
      "Interval: 15 minutes\n" +
      "Source: Philippines (GNews + RSS)"
    );
  }

  if (action === "test") {
    api.send("🧪 Testing AutoNews...");
    await autoPost(function(msg) { api.send(msg); });
    return;
  }

  if (action === "on") {
    await startAutoNews(function(msg) { api.send(msg); });
    return;
  }

  if (action === "off") {
    if (state.interval) clearInterval(state.interval);
    state.enabled = false;
    return api.send("🔴 AutoNews stopped.");
  }

  if (action === "reset") {
    state.posted.clear();
    await dbSave(state.posted);
    return api.send("🔄 History cleared! Will repost fresh articles next cycle.");
  }

  api.send(
    "📰 AutoNews Commands\n━━━━━━━━━━━━━━\n" +
    "!autonews status — Check status\n" +
    "!autonews test   — Post now\n" +
    "!autonews on     — Start\n" +
    "!autonews off    — Stop\n" +
    "!autonews reset  — Clear history"
  );
};
