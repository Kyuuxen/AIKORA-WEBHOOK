const axios = require("axios");

module.exports.config = {
  name:        "autoreact",
  description: "Auto post news reaction posts to drive comments and engagement",
  usage:       "!autoreact status | test | on | off | reset",
  category:    "Automation",
};

// ── Global state ──────────────────────────────────────────────────────────────
if (!global.autoReactState) {
  global.autoReactState = {
    postedUrls:  new Set(),
    totalPosted: 0,
    lastPosted:  null,
    interval:    null,
    isPosting:   false,
  };
}
const state = global.autoReactState;

// ── Reaction post templates ───────────────────────────────────────────────────
const TEMPLATES = [
  function(headline, emoji) {
    return emoji + " " + headline + "\n\nAnong tingin niyo dito? 👇\nComment down below! 💬";
  },
  function(headline, emoji) {
    return "🚨 BREAKING NEWS 🚨\n\n" + headline + "\n\nReact kayo! Ano masasabi niyo? 👇👇👇";
  },
  function(headline, emoji) {
    return emoji + " " + headline + "\n\nAgree ka ba? 👍 o Hindi? 👎\nSabihin mo sa comments! 💬";
  },
  function(headline, emoji) {
    return "📢 LATEST NEWS\n\n" + headline + "\n\nAno ang reaksyon mo? Share your thoughts! 👇";
  },
  function(headline, emoji) {
    return emoji + " " + headline + "\n\nTag mo ang kaibigan mo na kailangang makita ito! 👇\n💬 Comment niyo mga opinyon niyo!";
  },
];

// ── Topic emojis ──────────────────────────────────────────────────────────────
function getEmoji(title) {
  const t = title.toLowerCase();
  if (t.includes("police") || t.includes("crime") || t.includes("kill") || t.includes("murder")) return "🚔";
  if (t.includes("typhoon") || t.includes("flood") || t.includes("earthquake") || t.includes("weather")) return "🌪️";
  if (t.includes("president") || t.includes("duterte") || t.includes("marcos") || t.includes("politics")) return "🏛️";
  if (t.includes("price") || t.includes("peso") || t.includes("economy") || t.includes("inflation")) return "💸";
  if (t.includes("health") || t.includes("hospital") || t.includes("disease") || t.includes("covid")) return "🏥";
  if (t.includes("school") || t.includes("student") || t.includes("education") || t.includes("deped")) return "🎓";
  if (t.includes("sports") || t.includes("basketball") || t.includes("pba") || t.includes("fifa")) return "⚽";
  if (t.includes("technology") || t.includes("ai") || t.includes("internet") || t.includes("app")) return "💻";
  if (t.includes("celebrity") || t.includes("actor") || t.includes("singer") || t.includes("entertainment")) return "🎬";
  return "📰";
}

// ── Generate AI reaction caption ──────────────────────────────────────────────
async function generateReactCaption(article) {
  try {
    const res = await axios.get("https://api-library-kohi.onrender.com/api/copilot", {
      params: {
        prompt:
          "Create a short engaging Filipino Facebook post about this news that will make people want to comment their reaction. " +
          "Mix Tagalog and English (Taglish). End with a question to encourage comments. " +
          "Max 4 lines. No hashtags. No asterisks. No markdown.\n\n" +
          "News: " + article.title,
      },
      timeout: 25000,
    });
    const r = (res.data && res.data.data && res.data.data.text) ? res.data.data.text : null;
    if (r && r.length > 20) return r.replace(/\*\*/g, "").replace(/\*/g, "").trim();
  } catch(e) {
    console.log("[AutoReact] AI caption failed:", e.message);
  }
  const emoji    = getEmoji(article.title);
  const template = TEMPLATES[state.totalPosted % TEMPLATES.length];
  return template(article.title, emoji);
}

// ── Fetch news ────────────────────────────────────────────────────────────────
async function fetchNews() {
  try {
    const res = await axios.get("https://gnews.io/api/v4/top-headlines", {
      params: { lang: "en", country: "ph", max: 20, apikey: process.env.GNEWS_API_KEY || "demo" },
      timeout: 15000,
    });
    return (res.data && res.data.articles) ? res.data.articles : [];
  } catch(e) {}
  try {
    const rss = await axios.get(
      "https://api.rss2json.com/v1/api.json?rss_url=https://feeds.bbci.co.uk/news/rss.xml",
      { timeout: 15000 }
    );
    return ((rss.data && rss.data.items) ? rss.data.items : []).map(function(item) {
      return {
        title:  item.title,
        url:    item.link,
        image:  (item.enclosure && item.enclosure.link) ? item.enclosure.link : (item.thumbnail || null),
        source: { name: "BBC News" },
      };
    });
  } catch(e) { return []; }
}

// ── Post to Facebook Page ─────────────────────────────────────────────────────
async function postToFacebook(caption, imageUrl, articleUrl) {
  const pageId    = process.env.PAGE_ID;
  const feedToken = process.env.PAGE_FEED_TOKEN;
  if (!pageId || !feedToken) throw new Error("PAGE_ID or PAGE_FEED_TOKEN not set.");
  const fullCaption = caption + "\n\n🔗 " + (articleUrl || "");
  if (imageUrl) {
    try {
      await axios.post("https://graph.facebook.com/v19.0/" + pageId + "/photos",
        { url: imageUrl, caption: fullCaption, access_token: feedToken }, { timeout: 20000 });
      return "photo";
    } catch(e) { console.log("[AutoReact] Photo failed, trying link:", e.message); }
  }
  await axios.post("https://graph.facebook.com/v19.0/" + pageId + "/feed",
    { message: fullCaption, link: articleUrl || undefined, access_token: feedToken }, { timeout: 15000 });
  return "link";
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function autoPost(notifyFn) {
  if (state.isPosting) { notifyFn("⏳ Still posting, skipping..."); return; }
  state.isPosting = true;

  try {
    const articles = await fetchNews();
    if (!articles.length) { notifyFn("⚠️ No articles found."); return; }

    let article = null;
    for (let i = 0; i < articles.length; i++) {
      if (articles[i].url && !state.postedUrls.has(articles[i].url)) { article = articles[i]; break; }
    }
    if (!article) { state.postedUrls.clear(); article = articles[0]; }
    state.postedUrls.add(article.url);

    const caption  = await generateReactCaption(article);
    const imageUrl = article.image || article.urlToImage || null;
    const method   = await postToFacebook(caption, imageUrl, article.url);

    state.totalPosted++;
    state.lastPosted = new Date().toISOString();
    notifyFn("✅ React post (" + method + "): " + article.title);

  } catch(err) {
    notifyFn("❌ Failed: " + err.message);
    console.error("[AutoReact]", err.message);
  } finally {
    state.isPosting = false;
  }
}

// ── Auto start ────────────────────────────────────────────────────────────────
function startAutoReact() {
  if (state.interval) return;
  if (!process.env.PAGE_ID || !process.env.PAGE_FEED_TOKEN) {
    console.log("[AutoReact] Not started: Missing PAGE_ID or PAGE_FEED_TOKEN.");
    return;
  }
  console.log("[AutoReact] Starting...");
  setTimeout(function() {
    autoPost(function(msg) { console.log("[AutoReact]", msg); });
  }, 10 * 60 * 1000);
  state.interval = setInterval(function() {
    autoPost(function(msg) { console.log("[AutoReact]", msg); });
  }, 2 * 60 * 60 * 1000);
}

startAutoReact();

// ── Command ───────────────────────────────────────────────────────────────────
module.exports.run = async function ({ api, args, event }) {
  const uid     = event.senderId;
  const ADMINS  = (process.env.ADMIN_IDS || process.env.ADMIN_ID || "").split(",").map(function(id) { return id.trim(); }).filter(Boolean);
  const isAdmin = ADMINS.length === 0 || ADMINS.includes(uid);

  if (!isAdmin) return api.send("⛔ Admins only!");

  const action = (args[0] || "status").toLowerCase();

  if (action === "status") {
    return api.send(
      "💬 AutoReact Status\n━━━━━━━━━━━━━━\n" +
      "Status: "       + (state.interval ? "🟢 Running" : "🔴 Stopped") + "\n" +
      "Total posted: " + state.totalPosted + "\n" +
      "Last posted: "  + (state.lastPosted ? new Date(state.lastPosted).toLocaleString() : "Never") + "\n" +
      "Interval: Every 2 hours\n" +
      "Style: AI Taglish reaction post"
    );
  }
  if (action === "test") {
    api.send("🧪 Posting reaction post now...");
    await autoPost(function(msg) { api.send(msg); });
    return;
  }
  if (action === "on") {
    if (state.interval) return api.send("Already running!");
    startAutoReact();
    return api.send("✅ AutoReact started! Posts every 2 hours.");
  }
  if (action === "off") {
    if (!state.interval) return api.send("Already stopped!");
    clearInterval(state.interval);
    state.interval = null;
    return api.send("🔴 AutoReact stopped.");
  }
  if (action === "reset") {
    state.postedUrls.clear();
    return api.send("🔄 History cleared!");
  }
  api.send(
    "💬 AutoReact Commands\n━━━━━━━━━━━━━━\n" +
    "!autoreact status\n" +
    "!autoreact test\n" +
    "!autoreact on\n" +
    "!autoreact off\n" +
    "!autoreact reset"
  );
};
