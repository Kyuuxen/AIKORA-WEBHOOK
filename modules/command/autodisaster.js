const axios = require("axios");
const { syncPlaywright } = require("playwright-core");

module.exports.config = {
  name:        "autodisaster",
  description: "Auto post typhoon & earthquake updates to Facebook Page",
  usage:       "!autodisaster status | test | on | off | reset",
  category:    "Automation",
};

// ── Config ────────────────────────────────────────────────────────────────────
const PAGE_TOKEN  = process.env.PAGE_FEED_TOKEN || process.env.PAGE_ACCESS_TOKEN;
const PAGE_ID     = process.env.PAGE_ID;
const JSONBIN_KEY = process.env.JSONBIN_KEY;
const JSONBIN_BIN = process.env.JSONBIN_BIN;
const INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

// ── DISASTER DATA SOURCES ────────────────────────────────────────────────────
const DISASTER_FEEDS = [
  // GDACS - Global Disaster Alerts (Typhoons, Earthquakes, Floods)
  "https://www.gdacs.org/rss.aspx",
  // PAGASA - Philippines weather (typhoon updates)
  "https://www.pagasa.dost.gov.ph/rss/weather.xml",
  // USGS Earthquakes - Philippines region
  "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson",
  // JTWC - Tropical Cyclone Warnings
  "https://www.metoc.navy.mil/jtwc/jtwc_rss.html",
];

// ── Fetch disaster data ──────────────────────────────────────────────────────
async function fetchDisasters() {
  const all = [];

  // 1. GDACS RSS (Typhoons, Earthquakes, Floods)
  try {
    const gdacs = await fetchRSS("https://www.gdacs.org/rss.aspx");
    gdacs.forEach(a => all.push({ ...a, source: "GDACS" }));
  } catch(e) {}

  // 2. USGS Earthquakes (JSON)
  try {
    const quakeRes = await axios.get(
      "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson",
      { timeout: 10000 }
    );
    const features = quakeRes.data?.features || [];
    features.forEach(f => {
      const props = f.properties;
      const mag = props.mag || 0;
      const place = props.place || "Philippines region";
      if (mag > 4.5) {
        all.push({
          title: `⚠️ Earthquake: M${mag.toFixed(1)} - ${place}`,
          url: props.url || "https://earthquake.usgs.gov",
          source: "USGS",
          magnitude: mag,
          place: place,
          time: new Date(props.time).toLocaleString(),
        });
      }
    });
  } catch(e) {}

  // 3. PAGASA Weather (RSS)
  try {
    const pagasa = await fetchRSS("https://www.pagasa.dost.gov.ph/rss/weather.xml");
    pagasa.forEach(a => all.push({ ...a, source: "PAGASA" }));
  } catch(e) {}

  // 4. JTWC (RSS)
  try {
    const jtwc = await fetchRSS("https://www.metoc.navy.mil/jtwc/jtwc_rss.html");
    jtwc.forEach(a => all.push({ ...a, source: "JTWC" }));
  } catch(e) {}

  // Filter only Philippines-related
  const filtered = all.filter(a => {
    const text = (a.title + " " + (a.description || "")).toLowerCase();
    return text.includes("philippine") ||
           text.includes("phil") ||
           text.includes("pinoy") ||
           text.includes("typhoon") ||
           text.includes("bagyo") ||
           text.includes("earthquake") ||
           text.includes("lindol") ||
           text.includes("pagasa") ||
           text.includes("par") ||
           text.includes("west philippine sea");
  });

  return filtered;
}

// ── RSS CONVERTERS (from original) ──────────────────────────────────────────
async function fetchRSS(rssUrl) {
  const converters = [
    async function(url) {
      const res = await axios.get("https://api.rss2json.com/v1/api.json", {
        params: { rss_url: url }, timeout: 15000,
      });
      return (res.data?.items || []).map(i => ({ title: i.title, url: i.link, description: i.description }));
    },
    async function(url) {
      const res = await axios.get("https://api.allorigins.win/get?url=" + encodeURIComponent(url), {
        timeout: 15000,
      });
      const xml = res.data?.contents || "";
      const titles = xml.match(/<title><!\[CDATA\[([^\]]+)\]\]><\/title>/g) || xml.match(/<title>([^<]+)<\/title>/g) || [];
      const links = xml.match(/<link>([^<]+)<\/link>/g) || [];
      const items = [];
      for (let i = 1; i < Math.min(titles.length, links.length + 1); i++) {
        const title = (titles[i] || "").replace(/<[^>]+>/g, "").replace(/<!\[CDATA\[|\]\]>/g, "").trim();
        const url   = (links[i - 1] || "").replace(/<[^>]+>/g, "").trim();
        if (title && url) items.push({ title, url });
      }
      return items;
    },
  ];

  for (const conv of converters) {
    try {
      const items = await conv(rssUrl);
      if (items && items.length > 0) return items;
    } catch(e) {}
  }
  return [];
}

// ── SCREENSHOT WINDY ─────────────────────────────────────────────────────────
async function screenshotWindy() {
  try {
    const { chromium } = require("playwright");
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });

    // Center on Philippines with typhoon overlay
    await page.goto("https://www.windy.com/?13.561,122.523,6", { waitUntil: "networkidle" });
    await page.waitForTimeout(5000);

    // Add typhoon overlay (if available)
    await page.evaluate(() => {
      // Toggle satellite view for better typhoon visibility
      const satBtn = document.querySelector('[data-layer="satellite"]');
      if (satBtn) satBtn.click();
    });

    await page.waitForTimeout(2000);
    const screenshot = await page.screenshot({ path: "typhoon_map.png" });
    await browser.close();
    return "typhoon_map.png";
  } catch(e) {
    console.log("[AutoDisaster] Windy screenshot failed:", e.message);
    return null;
  }
}

// ── AI CAPTION GENERATOR ─────────────────────────────────────────────────────
async function generateCaption(article) {
  try {
    const prompt = `
      Write a Facebook post about this disaster update:
      Title: ${article.title}
      ${article.description ? "Details: " + article.description : ""}
      ${article.magnitude ? "Magnitude: " + article.magnitude : ""}
      Source: ${article.source || "Disaster Alert"}

      Make it:
      - Informative but not fearmongering
      - Include safety tips
      - End with a call to action (stay safe, prepare, etc.)
      - Add 2-3 relevant emojis
      - Under 300 characters
      - Return ONLY the post text, no HTML or code.
    `;

    const res = await axios.post(
      "https://text.pollinations.ai/",
      {
        messages: [
          { role: "system", content: "You are a disaster response page manager. Write calm, informative Facebook posts. Never return HTML or code." },
          { role: "user", content: prompt },
        ],
        model: "openai",
        seed: Math.floor(Math.random() * 9999),
      },
      { headers: { "Content-Type": "application/json" }, timeout: 20000 }
    );

    let text = typeof res.data === "string" ? res.data.trim() : article.title;
    if (text.includes("<") || text.includes("```") || text.length > 500) {
      return article.title + "\n\nStay safe, Philippines! 🌧️🌊";
    }
    return text;
  } catch(e) {
    return article.title + "\n\nStay safe, Philippines! 🌧️🌊";
  }
}

// ── POST TO FACEBOOK WITH IMAGE ─────────────────────────────────────────────
async function postToPage(caption, imagePath) {
  if (!PAGE_TOKEN || !PAGE_ID) throw new Error("PAGE_TOKEN or PAGE_ID not set");

  if (imagePath) {
    // Post with image
    const FormData = require("form-data");
    const fs = require("fs");
    const form = new FormData();
    form.append("source", fs.createReadStream(imagePath));
    form.append("caption", caption);
    form.append("access_token", PAGE_TOKEN);

    await axios.post(`https://graph.facebook.com/v19.0/${PAGE_ID}/photos`, form, {
      headers: form.getHeaders(),
      timeout: 30000,
    });
  } else {
    // Text-only post
    await axios.post(
      `https://graph.facebook.com/v19.0/${PAGE_ID}/feed`,
      { message: caption, access_token: PAGE_TOKEN },
      { timeout: 15000 }
    );
  }
}

// ── JSONBin DB ───────────────────────────────────────────────────────────────
async function dbLoad() {
  if (!JSONBIN_KEY || !JSONBIN_BIN) return new Set();
  try {
    const res = await axios.get(`https://api.jsonbin.io/v3/b/${JSONBIN_BIN}/latest`, {
      headers: { "X-Master-Key": JSONBIN_KEY }, timeout: 10000
    });
    return new Set((res.data?.record?.posted) || []);
  } catch(e) { return new Set(); }
}

async function dbSave(postedSet) {
  if (!JSONBIN_KEY || !JSONBIN_BIN) return;
  try {
    await axios.put(
      `https://api.jsonbin.io/v3/b/${JSONBIN_BIN}`,
      { posted: Array.from(postedSet).slice(-500) },
      { headers: { "X-Master-Key": JSONBIN_KEY, "Content-Type": "application/json" }, timeout: 10000 }
    );
  } catch(e) {}
}

function normalize(title) {
  return title.toLowerCase().replace(/[^a-z0-9]/g, "").substring(0, 60);
}

// ── GLOBAL STATE ─────────────────────────────────────────────────────────────
if (!global.disasterState) {
  global.disasterState = { enabled: false, interval: null, posted: new Set(), isPosting: false };
}
const state = global.disasterState;

// ── AUTO POST ────────────────────────────────────────────────────────────────
async function autoPost(notifyFn) {
  if (state.isPosting) { console.log("[AutoDisaster] Already posting..."); return; }
  state.isPosting = true;

  try {
    const dbPosted = await dbLoad();
    dbPosted.forEach(t => state.posted.add(t));

    const articles = await fetchDisasters();
    let article = null;

    for (const a of articles) {
      if (a.title && !state.posted.has(normalize(a.title))) {
        article = a;
        break;
      }
    }

    if (!article) {
      console.log("[AutoDisaster] No new disasters.");
      notifyFn("⏳ No new disasters yet.");
      return;
    }

    // Generate AI caption
    const caption = await generateCaption(article);

    // Take Windy screenshot
    const imagePath = await screenshotWindy();

    // Post to Facebook
    await postToPage(caption, imagePath);

    state.posted.add(normalize(article.title));
    await dbSave(state.posted);

    console.log("[AutoDisaster] ✅ Posted:", article.title);
    notifyFn("✅ Posted: " + article.title);

  } catch(e) {
    console.log("[AutoDisaster] Error:", e.message);
    notifyFn("❌ Error: " + e.message);
  } finally {
    state.isPosting = false;
  }
}

// ── START / STOP ─────────────────────────────────────────────────────────────
async function startAuto(notifyFn) {
  if (state.interval) clearInterval(state.interval);
  const dbPosted = await dbLoad();
  dbPosted.forEach(t => state.posted.add(t));
  state.enabled = true;
  state.interval = setInterval(() => {
    if (!state.isPosting) autoPost(notifyFn);
  }, INTERVAL_MS);
  console.log("[AutoDisaster] Started.");
  notifyFn("✅ AutoDisaster started! Posting every 15 minutes.");
}

// Auto-start on boot
if (!state.interval) {
  setTimeout(() => {
    startAuto(console.log);
  }, 5000);
}

// ── COMMAND ──────────────────────────────────────────────────────────────────
module.exports.run = async function ({ api, args }) {
  const action = (args[0] || "status").toLowerCase();

  if (action === "status") {
    return api.send(
      "🌪️ AutoDisaster Status\n━━━━━━━━━━━━━━\n" +
      "Status: " + (state.enabled ? "🟢 Running" : "🔴 Stopped") + "\n" +
      "Posted: " + state.posted.size + " updates\n" +
      "Interval: 15 minutes\n" +
      "Sources: GDACS, USGS, PAGASA, JTWC"
    );
  }

  if (action === "test") {
    api.send("🧪 Testing AutoDisaster...");
    await autoPost(api.send);
    return;
  }

  if (action === "on") {
    await startAuto(api.send);
    return;
  }

  if (action === "off") {
    if (state.interval) clearInterval(state.interval);
    state.enabled = false;
    return api.send("🔴 AutoDisaster stopped.");
  }

  if (action === "reset") {
    state.posted.clear();
    await dbSave(state.posted);
    return api.send("🔄 History cleared!");
  }

  api.send(
    "🌪️ AutoDisaster Commands\n━━━━━━━━━━━━━━\n" +
    "!autodisaster status — Check status\n" +
    "!autodisaster test   — Post now\n" +
    "!autodisaster on     — Start\n" +
    "!autodisaster off    — Stop\n" +
    "!autodisaster reset  — Clear history"
  );
};
