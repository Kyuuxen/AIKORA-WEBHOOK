const axios  = require("axios");
const fs     = require("fs");
const path   = require("path");
const { exec, execSync } = require("child_process");
const { promisify } = require("util");
const execAsync = promisify(exec);

module.exports.config = {
  name:        "autovideo",
  description: "Auto download YouTube news videos and post directly to Facebook",
  usage:       "!autovideo status | test | on | off | reset",
  category:    "Automation",
};

// ── Global state ──────────────────────────────────────────────────────────────
if (!global.autoVideoState) {
  global.autoVideoState = {
    postedIds:   new Set(),
    totalPosted: 0,
    lastPosted:  null,
    interval:    null,
    isPosting:   false,
    topicIndex:  0,
    ytdlpReady:  false,
  };
}
const state = global.autoVideoState;

// ── Temp directory for video downloads ───────────────────────────────────────
const TMP_DIR = "/tmp/autovideo";
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

// ── Install yt-dlp if not present ─────────────────────────────────────────────
async function ensureYtDlp() {
  if (state.ytdlpReady) return true;
  try {
    await execAsync("yt-dlp --version");
    state.ytdlpReady = true;
    console.log("[AutoVideo] yt-dlp already installed");
    return true;
  } catch (e) {}

  console.log("[AutoVideo] Installing yt-dlp...");
  try {
    // Install via pip (Python is available on Render)
    await execAsync("pip install yt-dlp --quiet --break-system-packages", { timeout: 60000 });
    await execAsync("yt-dlp --version");
    state.ytdlpReady = true;
    console.log("[AutoVideo] yt-dlp installed successfully");
    return true;
  } catch (e) {
    console.log("[AutoVideo] pip install failed:", e.message);
  }

  try {
    // Try downloading binary directly
    await execAsync(
      "curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && chmod +x /usr/local/bin/yt-dlp",
      { timeout: 60000 }
    );
    await execAsync("yt-dlp --version");
    state.ytdlpReady = true;
    console.log("[AutoVideo] yt-dlp binary installed");
    return true;
  } catch (e) {
    console.log("[AutoVideo] Binary install failed:", e.message);
    return false;
  }
}

// ── News topics ───────────────────────────────────────────────────────────────
const TOPICS = [
  "Philippines news today",
  "world news breaking",
  "Philippines latest news",
  "Asia news today",
  "technology news today",
  "sports news highlights",
  "business news today",
  "science discovery news",
  "health news today",
  "viral news today",
];

// ── Search YouTube for short news videos ─────────────────────────────────────
async function searchYouTube(query) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (apiKey) {
    try {
      const res = await axios.get("https://www.googleapis.com/youtube/v3/search", {
        params: {
          key:           apiKey,
          q:             query,
          part:          "snippet",
          type:          "video",
          order:         "date",
          maxResults:    10,
          videoDuration: "short", // under 4 minutes
          publishedAfter: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
        },
        timeout: 15000,
      });
      const items = (res.data && res.data.items) ? res.data.items : [];
      return items.map(function(item) {
        return {
          id:      item.id.videoId,
          title:   item.snippet.title,
          channel: item.snippet.channelTitle,
          url:     "https://www.youtube.com/watch?v=" + item.id.videoId,
        };
      });
    } catch (e) {
      console.log("[AutoVideo] YouTube API failed:", e.message);
    }
  }

  // Fallback: Invidious
  const instances = [
    "https://invidious.snopyta.org",
    "https://vid.puffyan.us",
    "https://invidious.kavin.rocks",
  ];
  for (let i = 0; i < instances.length; i++) {
    try {
      const res = await axios.get(instances[i] + "/api/v1/search", {
        params: { q: query, type: "video", sort_by: "upload_date" },
        timeout: 10000,
      });
      const items = Array.isArray(res.data) ? res.data.slice(0, 10) : [];
      if (items.length > 0) {
        return items.map(function(item) {
          return {
            id:      item.videoId,
            title:   item.title,
            channel: item.author,
            url:     "https://www.youtube.com/watch?v=" + item.videoId,
          };
        });
      }
    } catch (e) {}
  }
  return [];
}

// ── Download video with yt-dlp ────────────────────────────────────────────────
async function downloadVideo(videoUrl, videoId) {
  const outPath = path.join(TMP_DIR, videoId + ".mp4");

  // Remove old file if exists
  if (fs.existsSync(outPath)) fs.unlinkSync(outPath);

  // Clean up old temp files (keep tmp dir clean)
  const files = fs.readdirSync(TMP_DIR);
  files.forEach(function(f) {
    try { fs.unlinkSync(path.join(TMP_DIR, f)); } catch(e) {}
  });

  console.log("[AutoVideo] Downloading:", videoUrl);

  // Download with yt-dlp:
  // - max filesize 50MB (Facebook limit is 10GB but we keep it small for speed)
  // - format: best mp4 under 480p (faster download, good enough quality)
  // - no playlist, just single video
  const cmd = [
    "yt-dlp",
    "--no-playlist",
    "--max-filesize", "50M",
    "-f", "bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/best[height<=480][ext=mp4]/best[ext=mp4]/best",
    "--merge-output-format", "mp4",
    "-o", outPath,
    "--no-warnings",
    "--socket-timeout", "30",
    videoUrl
  ].join(" ");

  await execAsync(cmd, { timeout: 120000 }); // 2 min timeout

  if (!fs.existsSync(outPath)) throw new Error("Download failed - file not found");

  const stats   = fs.statSync(outPath);
  const sizeMB  = (stats.size / 1024 / 1024).toFixed(1);
  console.log("[AutoVideo] Downloaded: " + sizeMB + "MB");

  if (stats.size < 10000) throw new Error("Downloaded file too small, likely failed");

  return outPath;
}

// ── Upload video to Facebook using chunked upload API ─────────────────────────
async function uploadVideoToFacebook(filePath, title, description) {
  const pageId    = process.env.PAGE_ID;
  const feedToken = process.env.PAGE_FEED_TOKEN;
  if (!pageId || !feedToken) throw new Error("PAGE_ID or PAGE_FEED_TOKEN not set.");

  const fileSize = fs.statSync(filePath).size;
  console.log("[AutoVideo] Uploading to Facebook: " + (fileSize/1024/1024).toFixed(1) + "MB");

  // Step 1: Initialize upload session
  const initRes = await axios.post(
    "https://graph.facebook.com/v19.0/" + pageId + "/videos",
    null,
    {
      params: {
        upload_phase:  "start",
        file_size:     fileSize,
        access_token:  feedToken,
      },
      timeout: 30000,
    }
  );

  const uploadSessionId = initRes.data.upload_session_id;
  const videoId         = initRes.data.video_id;
  console.log("[AutoVideo] Upload session started:", uploadSessionId);

  // Step 2: Upload file in chunks (5MB chunks)
  const CHUNK_SIZE = 5 * 1024 * 1024;
  const fileBuffer = fs.readFileSync(filePath);
  let offset       = 0;

  while (offset < fileSize) {
    const chunk     = fileBuffer.slice(offset, offset + CHUNK_SIZE);
    const chunkForm = new FormData();

    // Use axios with buffer upload
    const chunkRes = await axios.post(
      "https://graph-video.facebook.com/v19.0/" + pageId + "/videos",
      chunk,
      {
        params: {
          upload_phase:      "transfer",
          upload_session_id: uploadSessionId,
          start_offset:      offset,
          access_token:      feedToken,
        },
        headers: {
          "Content-Type":   "application/octet-stream",
          "Content-Length": chunk.length,
        },
        timeout: 120000,
        maxBodyLength: Infinity,
      }
    );

    offset = parseInt(chunkRes.data.start_offset) || (offset + chunk.length);
    console.log("[AutoVideo] Upload progress: " + Math.round((offset/fileSize)*100) + "%");
  }

  // Step 3: Finish upload
  await axios.post(
    "https://graph-video.facebook.com/v19.0/" + pageId + "/videos",
    null,
    {
      params: {
        upload_phase:      "finish",
        upload_session_id: uploadSessionId,
        title:             title.substring(0, 100),
        description:       description.substring(0, 500),
        access_token:      feedToken,
      },
      timeout: 60000,
    }
  );

  console.log("[AutoVideo] Upload complete! Video ID:", videoId);
  return videoId;
}

// ── Generate caption ──────────────────────────────────────────────────────────
async function generateCaption(video) {
  try {
    const res = await axios.get("https://api-library-kohi.onrender.com/api/copilot", {
      params: {
        prompt: "Write a short engaging Facebook post caption for this news video (2-3 sentences, no hashtags, no asterisks, no markdown). Make people want to watch:\n\nTitle: " + video.title + "\nChannel: " + video.channel,
      },
      timeout: 25000,
    });
    const r = (res.data && res.data.data && res.data.data.text) ? res.data.data.text : null;
    if (r && r.length > 20) return r.replace(/\*\*/g, "").replace(/\*/g, "").trim();
  } catch (e) {}
  return video.title;
}

// ── Cleanup temp files ────────────────────────────────────────────────────────
function cleanup(filePath) {
  try { if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch(e) {}
}

// ── Main auto post ────────────────────────────────────────────────────────────
async function autoPost(notifyFn) {
  if (state.isPosting) { notifyFn("⏳ Still posting, skipping..."); return; }
  state.isPosting = true;
  let filePath = null;

  try {
    // Ensure yt-dlp is installed
    const ready = await ensureYtDlp();
    if (!ready) {
      notifyFn("❌ yt-dlp could not be installed. Cannot download videos.");
      return;
    }

    // Search for videos
    const topic = TOPICS[state.topicIndex % TOPICS.length];
    state.topicIndex++;
    console.log("[AutoVideo] Topic:", topic);

    const videos = await searchYouTube(topic);
    if (!videos.length) { notifyFn("⚠️ No videos found for: " + topic); return; }

    // Pick unposted video
    let video = null;
    for (let i = 0; i < videos.length; i++) {
      if (!state.postedIds.has(videos[i].id)) { video = videos[i]; break; }
    }
    if (!video) { notifyFn("⚠️ All videos already posted. Trying next topic next cycle."); return; }

    state.postedIds.add(video.id);
    notifyFn("📥 Downloading: " + video.title);

    // Download video
    filePath = await downloadVideo(video.url, video.id);

    // Generate caption
    const caption = await generateCaption(video);

    // Upload to Facebook
    notifyFn("📤 Uploading to Facebook...");
    await uploadVideoToFacebook(filePath, video.title, caption);

    state.totalPosted++;
    state.lastPosted = new Date().toISOString();
    notifyFn("✅ Video posted: " + video.title);

  } catch (err) {
    notifyFn("❌ Failed: " + err.message);
    console.error("[AutoVideo] Error:", err.message);
    // Remove from posted set if it failed so it can retry
  } finally {
    cleanup(filePath);
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
  console.log("[AutoVideo] Starting (download + reupload mode)...");

  // First video after 3 minutes (let bot fully start)
  setTimeout(function() {
    autoPost(function(msg) { console.log("[AutoVideo]", msg); });
  }, 3 * 60 * 1000);

  // Every 45 minutes (downloading takes time)
  state.interval = setInterval(function() {
    autoPost(function(msg) { console.log("[AutoVideo]", msg); });
  }, 45 * 60 * 1000);
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
      "yt-dlp: "        + (state.ytdlpReady ? "✅ Ready" : "⏳ Not installed yet") + "\n" +
      "YouTube API: "   + (process.env.YOUTUBE_API_KEY ? "✅ Connected" : "⚠️ Using fallback") + "\n" +
      "Videos posted: " + state.totalPosted + "\n" +
      "Last posted: "   + (state.lastPosted ? new Date(state.lastPosted).toLocaleString() : "Never") + "\n" +
      "Next topic: "    + TOPICS[state.topicIndex % TOPICS.length] + "\n" +
      "Mode: 📥 Download + Reupload"
    );
  }

  if (action === "test") {
    api.send("🧪 Downloading and posting a video now...\n⏳ This may take 1-3 minutes...");
    await autoPost(function(msg) { api.send(msg); });
    return;
  }

  if (action === "on") {
    if (state.interval) return api.send("✅ Already running!");
    startAutoVideo();
    return api.send("✅ AutoVideo started! Posts every 45 minutes.");
  }

  if (action === "off") {
    if (!state.interval) return api.send("Already stopped!");
    clearInterval(state.interval);
    state.interval = null;
    return api.send("🔴 AutoVideo stopped.");
  }

  if (action === "reset") {
    const c = state.postedIds.size;
    state.postedIds.clear();
    return api.send("🔄 Cleared " + c + " video IDs.");
  }

  api.send(
    "📺 AutoVideo Commands\n" +
    "━━━━━━━━━━━━━━\n" +
    "!autovideo status — Check status\n" +
    "!autovideo test   — Download & post now\n" +
    "!autovideo on     — Start\n" +
    "!autovideo off    — Stop\n" +
    "!autovideo reset  — Clear history"
  );
};
