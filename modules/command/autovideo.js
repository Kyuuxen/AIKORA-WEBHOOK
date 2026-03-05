const axios = require("axios");

module.exports.config = {
  name:        "autovideo",
  description: "Auto post YouTube news videos to Facebook Page",
  usage:       "!autovideo status | test | on | off",
  category:    "Automation",
};

// ── Global state ──────────────────────────────────────────────────────────────
if (!global.autoVideoState) {
  global.autoVideoState = {
    postedIds:     new Set(),
    totalPosted:   0,
    lastPosted:    null,
    interval:      null,
    isPosting:     false,
    topicIndex:    0,
  };
}
const state = global.autoVideoState;

// ── News topics to search on YouTube ─────────────────────────────────────────
const TOPICS = [
  "Philippines news today",
  "world news today",
  "breaking news today",
  "Philippines latest news",
  "Asia news today",
  "technology news today",
  "sports news today",
  "science news today",
  "business news today",
  "health news today",
];

// ── Search YouTube for news videos ────────────────────────────────────────────
async function searchYouTube(query) {
  const apiKey = process.env.YOUTUBE_API_KEY;

  // Method 1: YouTube Data API v3 (best, needs API key)
  if (apiKey) {
    try {
      const res = await axios.get("https://www.googleapis.com/youtube/v3/search", {
        params: {
          key:        apiKey,
          q:          query,
          part:       "snippet",
          type:       "video",
          order:      "date",        // newest first
          maxResults: 10,
          videoDuration: "short",   // short = under 4 minutes (good for news clips)
          publishedAfter: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), // last 24 hours
        },
        timeout: 15000,
      });

      const items = (res.data && res.data.items) ? res.data.items : [];
      return items.map(function(item) {
        return {
          id:          item.id.videoId,
          title:       item.snippet.title,
          description: item.snippet.description,
          channel:     item.snippet.channelTitle,
          thumbnail:   item.snippet.thumbnails && item.snippet.thumbnails.high ? item.snippet.thumbnails.high.url : null,
          url:         "https://www.youtube.com/watch?v=" + item.id.videoId,
          publishedAt: item.snippet.publishedAt,
        };
      });
    } catch (e) {
      console.log("[AutoVideo] YouTube API failed:", e.message);
    }
  }

  // Method 2: Invidious API (no key needed, open source YouTube frontend)
  try {
    const res = await axios.get("https://invidious.snopyta.org/api/v1/search", {
      params: { q: query, type: "video", sort_by: "upload_date", page: 1 },
      timeout: 15000,
    });
    const items = Array.isArray(res.data) ? res.data : [];
    return items.slice(0, 10).map(function(item) {
      return {
        id:          item.videoId,
        title:       item.title,
        description: item.description || "",
        channel:     item.author,
        thumbnail:   "https://img.youtube.com/vi/" + item.videoId + "/hqdefault.jpg",
        url:         "https://www.youtube.com/watch?v=" + item.videoId,
        publishedAt: new Date(item.published * 1000).toISOString(),
      };
    });
  } catch (e) {
    console.log("[AutoVideo] Invidious failed:", e.message);
  }

  // Method 3: Alternative Invidious instances
  const instances = [
    "https://vid.puffyan.us",
    "https://invidious.kavin.rocks",
    "https://y.com.sb",
  ];
  for (let i = 0; i < instances.length; i++) {
    try {
      const res = await axios.get(instances[i] + "/api/v1/search", {
        params: { q: query, type: "video", sort_by: "upload_date" },
        timeout: 10000,
      });
      const items = Array.isArray(res.data) ? res.data : [];
      if (items.length > 0) {
        return items.slice(0, 10).map(function(item) {
          return {
            id:          item.videoId,
            title:       item.title,
            description: item.description || "",
            channel:     item.author,
            thumbnail:   "https://img.youtube.com/vi/" + item.videoId + "/hqdefault.jpg",
            url:         "https://www.youtube.com/watch?v=" + item.videoId,
            publishedAt: new Date((item.published || 0) * 1000).toISOString(),
          };
        });
      }
    } catch (e) {
      console.log("[AutoVideo] Instance " + instances[i] + " failed:", e.message);
    }
  }

  return [];
}

// ── Pick fresh unposted video ─────────────────────────────────────────────────
function pickFresh(videos) {
  for (let i = 0; i < videos.length; i++) {
    if (!state.postedIds.has(videos[i].id)) return videos[i];
  }
  return null;
}

// ── Generate caption with AI ──────────────────────────────────────────────────
async function generateCaption(video) {
  try {
    const res = await axios.get("https://api-library-kohi.onrender.com/api/copilot", {
      params: {
        prompt: "Write a short engaging Facebook post caption for this YouTube news video (2-3 sentences, no hashtags, no asterisks, no markdown). Make people want to watch it:\n\nTitle: " + video.title + "\nChannel: " + video.channel + "\nDescription: " + video.description.substring(0, 200),
      },
      timeout: 25000,
    });
    const r = (res.data && res.data.data && res.data.data.text) ? res.data.data.text : null;
    if (r && r.length > 20) return r.replace(/\*\*/g, "").replace(/\*/g, "").trim();
  } catch (e) {
    console.log("[AutoVideo] Caption AI failed:", e.message);
  }
  return video.title + "\n\nWatch this important news update!";
}

// ── Post to Facebook ──────────────────────────────────────────────────────────
async function postToFacebook(caption, video) {
  const pageId    = process.env.PAGE_ID;
  const feedToken = process.env.PAGE_FEED_TOKEN;
  if (!pageId || !feedToken) throw new Error("PAGE_ID or PAGE_FEED_TOKEN not set.");

  const fullCaption = caption + "\n\n▶️ Watch: " + video.url + "\n📺 " + video.channel;

  // Post as link — Facebook auto-generates YouTube video preview card
  try {
    await axios.post(
      "https://graph.facebook.com/v19.0/" + pageId + "/feed",
      {
        message:      fullCaption,
        link:         video.url,
        access_token: feedToken,
      },
      { timeout: 15000 }
    );
    return "link";
  } catch (e) {
    // Fallback: post with thumbnail image + caption
    const fbError = e.response && e.response.data && e.response.data.error ? e.response.data.error.message : e.message;
    console.log("[AutoVideo] Link post failed:", fbError);

    if (video.thumbnail) {
      await axios.post(
        "https://graph.facebook.com/v19.0/" + pageId + "/photos",
        {
          url:          video.thumbnail,
          caption:      fullCaption,
          access_token: feedToken,
        },
        { timeout: 20000 }
      );
      return "photo";
    }
    throw new Error(fbError);
  }
}

// ── Main auto post ────────────────────────────────────────────────────────────
async function autoPost(notifyFn) {
  if (state.isPosting) { notifyFn("⏳ Still posting, skipping..."); return; }
  state.isPosting = true;

  try {
    const topic = TOPICS[state.topicIndex % TOPICS.length];
    state.topicIndex++;
    console.log("[AutoVideo] Searching: " + topic);

    const videos = await searchYouTube(topic);
    if (!videos.length) {
      notifyFn("⚠️ No videos found for: " + topic);
      return;
    }

    let video = pickFresh(videos);

    // If all from this topic already posted, try next topic
    if (!video) {
      const nextTopic = TOPICS[state.topicIndex % TOPICS.length];
      state.topicIndex++;
      const moreVideos = await searchYouTube(nextTopic);
      video = pickFresh(moreVideos);
    }

    // If still nothing, clear oldest half
    if (!video) {
      const arr = Array.from(state.postedIds);
      state.postedIds = new Set(arr.slice(Math.floor(arr.length / 2)));
      video = pickFresh(videos);
    }

    if (!video) {
      notifyFn("⚠️ No fresh videos found. Try again later.");
      return;
    }

    // Mark posted before posting
    state.postedIds.add(video.id);
    state.totalPosted++;
    state.lastPosted = new Date().toISOString();

    const caption = await generateCaption(video);
    const method  = await postToFacebook(caption, video);

    notifyFn("✅ Posted (" + method + "): " + video.title);

  } catch (err) {
    notifyFn("❌ Failed: " + err.message);
    console.error("[AutoVideo] Error:", err.message);
  } finally {
    state.isPosting = false;
  }
}

// ── Auto start ────────────────────────────────────────────────────────────────
function startAutoVideo() {
  if (state.interval) return;
  if (!process.env.PAGE_ID || !process.env.PAGE_FEED_TOKEN) {
    console.log("[AutoVideo] Not started: Missing PAGE_ID or PAGE_FEED_TOKEN.");
    return;
  }

  console.log("[AutoVideo] Starting...");

  // First post after 2 minutes (after autonews posts first)
  setTimeout(function() {
    autoPost(function(msg) { console.log("[AutoVideo]", msg); });
  }, 2 * 60 * 1000);

  // Every 30 minutes (less frequent than news)
  state.interval = setInterval(function() {
    autoPost(function(msg) { console.log("[AutoVideo]", msg); });
  }, 30 * 60 * 1000);
}

startAutoVideo();

// ── Command ───────────────────────────────────────────────────────────────────
module.exports.run = async function ({ api, args, event }) {
  const uid     = event.senderId;
  const ADMINS  = (process.env.ADMIN_IDS || process.env.ADMIN_ID || "").split(",").map(function(id) { return id.trim(); }).filter(Boolean);
  const isAdmin = ADMINS.length === 0 || ADMINS.includes(uid);
  const action  = (args[0] || "status").toLowerCase();

  if (action !== "status" && !isAdmin) return api.send("⛔ Admins only!");

  if (action === "status") {
    return api.send(
      "📺 AutoVideo Status\n" +
      "━━━━━━━━━━━━━━\n" +
      "Status: "        + (state.interval ? "🟢 Running" : "🔴 Stopped") + "\n" +
      "YouTube API: "   + (process.env.YOUTUBE_API_KEY ? "✅ Connected" : "⚠️ Using free fallback") + "\n" +
      "Videos posted: " + state.postedIds.size + " remembered\n" +
      "Total posted: "  + state.totalPosted + "\n" +
      "Last posted: "   + (state.lastPosted ? new Date(state.lastPosted).toLocaleString() : "Never") + "\n" +
      "Next topic: "    + TOPICS[state.topicIndex % TOPICS.length]
    );
  }

  if (action === "test") {
    api.send("🧪 Searching and posting a video now...");
    await autoPost(function(msg) { api.send(msg); });
    return;
  }

  if (action === "on") {
    if (state.interval) return api.send("✅ Already running!");
    startAutoVideo();
    return api.send("✅ AutoVideo started! Posts every 30 minutes.");
  }

  if (action === "off") {
    if (!state.interval) return api.send("Already stopped!");
    clearInterval(state.interval);
    state.interval = null;
    return api.send("🔴 AutoVideo stopped.");
  }

  if (action === "reset") {
    if (!isAdmin) return api.send("⛔ Admins only!");
    const c = state.postedIds.size;
    state.postedIds.clear();
    return api.send("🔄 Cleared " + c + " video IDs.");
  }

  if (action === "topics") {
    return api.send("📋 Topics:\n" + TOPICS.map(function(t, i) { return (i+1) + ". " + t; }).join("\n"));
  }

  api.send(
    "📺 AutoVideo Commands\n" +
    "━━━━━━━━━━━━━━\n" +
    "!autovideo status — Check status\n" +
    "!autovideo test   — Post now\n" +
    "!autovideo topics — List topics\n" +
    "!autovideo on     — Start\n" +
    "!autovideo off    — Stop\n" +
    "!autovideo reset  — Clear history"
  );
};
