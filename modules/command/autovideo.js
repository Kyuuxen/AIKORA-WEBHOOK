const axios   = require("axios");
const fs      = require("fs");
const path    = require("path");
const { promisify } = require("util");
const { exec }      = require("child_process");
const execAsync     = promisify(exec);

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
    dlReady:     false,
    dlMethod:    null, // "ytdlexec" | "ytdlp" | null
  };
}
const state = global.autoVideoState;

const TMP_DIR = "/tmp/autovideo";
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

// ── Setup downloader ──────────────────────────────────────────────────────────
async function setupDownloader() {
  if (state.dlReady) return true;

  // Method 1: youtube-dl-exec npm package (installed via package.json)
  try {
    const ytdl = require("youtube-dl-exec");
    state._ytdl   = ytdl;
    state.dlReady = true;
    state.dlMethod = "ytdlexec";
    console.log("[AutoVideo] Using youtube-dl-exec");
    return true;
  } catch (e) {
    console.log("[AutoVideo] youtube-dl-exec not found:", e.message);
  }

  // Method 2: yt-dlp binary via curl download
  try {
    await execAsync("which yt-dlp");
    state.dlReady  = true;
    state.dlMethod = "ytdlp";
    console.log("[AutoVideo] yt-dlp binary found");
    return true;
  } catch (e) {}

  try {
    console.log("[AutoVideo] Downloading yt-dlp binary...");
    await execAsync(
      "curl -sL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /tmp/yt-dlp && chmod +x /tmp/yt-dlp",
      { timeout: 60000 }
    );
    await execAsync("/tmp/yt-dlp --version");
    state.dlReady  = true;
    state.dlMethod = "ytdlp_tmp";
    console.log("[AutoVideo] yt-dlp downloaded to /tmp");
    return true;
  } catch (e) {
    console.log("[AutoVideo] yt-dlp binary download failed:", e.message);
  }

  // Method 3: pip install yt-dlp
  try {
    console.log("[AutoVideo] Trying pip install yt-dlp...");
    await execAsync("pip3 install yt-dlp -q", { timeout: 90000 });
    await execAsync("yt-dlp --version");
    state.dlReady  = true;
    state.dlMethod = "ytdlp";
    console.log("[AutoVideo] yt-dlp installed via pip");
    return true;
  } catch (e) {
    console.log("[AutoVideo] pip install failed:", e.message);
  }

  return false;
}

// ── Download video ────────────────────────────────────────────────────────────
async function downloadVideo(videoUrl, videoId) {
  const outPath = path.join(TMP_DIR, videoId + ".mp4");
  if (fs.existsSync(outPath)) fs.unlinkSync(outPath);

  // Clean old temp files
  try {
    fs.readdirSync(TMP_DIR).forEach(function(f) {
      try { fs.unlinkSync(path.join(TMP_DIR, f)); } catch(e) {}
    });
  } catch(e) {}

  console.log("[AutoVideo] Downloading:", videoUrl);

  // Method 1: youtube-dl-exec
  if (state.dlMethod === "ytdlexec" && state._ytdl) {
    await state._ytdl(videoUrl, {
      noPlaylist:          true,
      format:              "bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/best[height<=480][ext=mp4]/best[ext=mp4]/best",
      mergeOutputFormat:   "mp4",
      output:              outPath,
      noWarnings:          true,
      socketTimeout:       "30",
    });
  } else {
    // Method 2/3: yt-dlp binary
    const bin = state.dlMethod === "ytdlp_tmp" ? "/tmp/yt-dlp" : "yt-dlp";
    const cmd = [
      bin,
      "--no-playlist",
      "--max-filesize", "80M",
      "-f", "\"bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/best[height<=480][ext=mp4]/best[ext=mp4]/best\"",
      "--merge-output-format", "mp4",
      "-o", outPath,
      "--no-warnings",
      "--socket-timeout", "30",
      videoUrl
    ].join(" ");
    await execAsync(cmd, { timeout: 120000 });
  }

  if (!fs.existsSync(outPath)) throw new Error("Download failed — file not created");
  const stats = fs.statSync(outPath);
  if (stats.size < 10000) throw new Error("File too small — download failed");
  console.log("[AutoVideo] Downloaded: " + (stats.size/1024/1024).toFixed(1) + "MB");
  return outPath;
}

// ── Upload to Facebook (chunked) ──────────────────────────────────────────────
async function uploadToFacebook(filePath, title, caption) {
  const pageId    = process.env.PAGE_ID;
  const feedToken = process.env.PAGE_FEED_TOKEN;
  if (!pageId || !feedToken) throw new Error("PAGE_ID or PAGE_FEED_TOKEN not set.");

  const fileSize = fs.statSync(filePath).size;
  console.log("[AutoVideo] Uploading " + (fileSize/1024/1024).toFixed(1) + "MB to Facebook...");

  // Init upload session
  const initRes = await axios.post(
    "https://graph-video.facebook.com/v19.0/" + pageId + "/videos",
    null,
    {
      params: { upload_phase: "start", file_size: fileSize, access_token: feedToken },
      timeout: 30000,
    }
  );

  const sessionId = initRes.data.upload_session_id;
  console.log("[AutoVideo] Upload session:", sessionId);

  // Upload in 5MB chunks
  const CHUNK  = 5 * 1024 * 1024;
  const buffer = fs.readFileSync(filePath);
  let offset   = 0;

  while (offset < fileSize) {
    const chunk   = buffer.slice(offset, Math.min(offset + CHUNK, fileSize));
    const chunkRes = await axios.post(
      "https://graph-video.facebook.com/v19.0/" + pageId + "/videos",
      chunk,
      {
        params: {
          upload_phase:      "transfer",
          upload_session_id: sessionId,
          start_offset:      offset,
          access_token:      feedToken,
        },
        headers: { "Content-Type": "application/octet-stream" },
        timeout: 120000,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      }
    );
    offset = parseInt(chunkRes.data.start_offset) || (offset + chunk.length);
    console.log("[AutoVideo] Upload: " + Math.round((offset/fileSize)*100) + "%");
  }

  // Finish upload
  await axios.post(
    "https://graph-video.facebook.com/v19.0/" + pageId + "/videos",
    null,
    {
      params: {
        upload_phase:      "finish",
        upload_session_id: sessionId,
        title:             title.substring(0, 100),
        description:       caption.substring(0, 500),
        access_token:      feedToken,
      },
      timeout: 60000,
    }
  );

  console.log("[AutoVideo] Upload complete!");
}

// ── Topics ────────────────────────────────────────────────────────────────────
const TOPICS = [
  "Philippines news today", "world news breaking", "Philippines latest news",
  "Asia news today", "technology news today", "sports news highlights",
  "business news today", "science news today", "health news today", "viral news today",
];

// ── Search YouTube ────────────────────────────────────────────────────────────
async function searchYouTube(query) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (apiKey) {
    try {
      const res = await axios.get("https://www.googleapis.com/youtube/v3/search", {
        params: {
          key: apiKey, q: query, part: "snippet", type: "video",
          order: "date", maxResults: 10, videoDuration: "short",
          publishedAfter: new Date(Date.now() - 48*60*60*1000).toISOString(),
        },
        timeout: 15000,
      });
      return ((res.data && res.data.items) ? res.data.items : []).map(function(item) {
        return { id: item.id.videoId, title: item.snippet.title, channel: item.snippet.channelTitle, url: "https://www.youtube.com/watch?v=" + item.id.videoId };
      });
    } catch (e) { console.log("[AutoVideo] YouTube API failed:", e.message); }
  }
  // Invidious fallback
  const instances = ["https://invidious.snopyta.org", "https://vid.puffyan.us", "https://invidious.kavin.rocks"];
  for (let i = 0; i < instances.length; i++) {
    try {
      const res = await axios.get(instances[i] + "/api/v1/search", { params: { q: query, type: "video", sort_by: "upload_date" }, timeout: 10000 });
      if (Array.isArray(res.data) && res.data.length > 0) {
        return res.data.slice(0, 10).map(function(item) {
          return { id: item.videoId, title: item.title, channel: item.author, url: "https://www.youtube.com/watch?v=" + item.videoId };
        });
      }
    } catch (e) {}
  }
  return [];
}

// ── Generate caption ──────────────────────────────────────────────────────────
async function generateCaption(video) {
  try {
    const res = await axios.get("https://api-library-kohi.onrender.com/api/copilot", {
      params: { prompt: "Write a short engaging Facebook caption for this news video (2-3 sentences, no hashtags, no asterisks):\n\nTitle: " + video.title + "\nChannel: " + video.channel },
      timeout: 25000,
    });
    const r = (res.data && res.data.data && res.data.data.text) ? res.data.data.text : null;
    if (r && r.length > 20) return r.replace(/\*\*/g, "").replace(/\*/g, "").trim();
  } catch (e) {}
  return video.title;
}

// ── Cleanup ───────────────────────────────────────────────────────────────────
function cleanup(filePath) {
  try { if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch(e) {}
}

// ── Main auto post ────────────────────────────────────────────────────────────
async function autoPost(notifyFn) {
  if (state.isPosting) { notifyFn("⏳ Still posting, skipping..."); return; }
  state.isPosting = true;
  let filePath = null;

  try {
    // Setup downloader
    const ready = await setupDownloader();
    if (!ready) { notifyFn("❌ No download method available. Add youtube-dl-exec to package.json!"); return; }

    // Search
    const topic = TOPICS[state.topicIndex % TOPICS.length];
    state.topicIndex++;
    const videos = await searchYouTube(topic);
    if (!videos.length) { notifyFn("⚠️ No videos found for: " + topic); return; }

    // Pick fresh
    let video = null;
    for (let i = 0; i < videos.length; i++) {
      if (!state.postedIds.has(videos[i].id)) { video = videos[i]; break; }
    }
    if (!video) { notifyFn("⚠️ All videos already posted. Next cycle will try different topic."); return; }

    state.postedIds.add(video.id);
    notifyFn("📥 Downloading: " + video.title + "\n⏳ Please wait 1-3 minutes...");

    filePath = await downloadVideo(video.url, video.id);
    const caption = await generateCaption(video);

    notifyFn("📤 Uploading to Facebook...");
    await uploadToFacebook(filePath, video.title, caption);

    state.totalPosted++;
    state.lastPosted = new Date().toISOString();
    notifyFn("✅ Video posted directly: " + video.title);

  } catch (err) {
    // Remove from posted so it can retry
    notifyFn("❌ Failed: " + err.message);
    console.error("[AutoVideo] Error:", err.message);
  } finally {
    cleanup(filePath);
    state.isPosting = false;
  }
}

// ── Start ─────────────────────────────────────────────────────────────────────
function startAutoVideo() {
  if (state.interval) return;
  if (!process.env.PAGE_ID || !process.env.PAGE_FEED_TOKEN) {
    console.log("[AutoVideo] Not started: Missing env vars.");
    return;
  }
  console.log("[AutoVideo] Starting...");
  setTimeout(function() { autoPost(function(msg) { console.log("[AutoVideo]", msg); }); }, 3 * 60 * 1000);
  state.interval = setInterval(function() { autoPost(function(msg) { console.log("[AutoVideo]", msg); }); }, 45 * 60 * 1000);
}

startAutoVideo();

// ── Command (admin only) ──────────────────────────────────────────────────────
module.exports.run = async function ({ api, args, event }) {
  const uid     = event.senderId;
  const ADMINS  = (process.env.ADMIN_IDS || process.env.ADMIN_ID || "").split(",").map(function(id) { return id.trim(); }).filter(Boolean);
  const isAdmin = ADMINS.length === 0 || ADMINS.includes(uid);

  if (!isAdmin) return api.send("⛔ This command is for admins only!");

  const action = (args[0] || "status").toLowerCase();

  if (action === "status") {
    return api.send(
      "📺 AutoVideo Status\n━━━━━━━━━━━━━━\n" +
      "Status: "      + (state.interval ? "🟢 Running" : "🔴 Stopped") + "\n" +
      "Downloader: "  + (state.dlReady ? "✅ " + state.dlMethod : "⏳ Not ready") + "\n" +
      "YouTube API: " + (process.env.YOUTUBE_API_KEY ? "✅ Connected" : "⚠️ Using fallback") + "\n" +
      "Total posted: " + state.totalPosted + "\n" +
      "Last posted: " + (state.lastPosted ? new Date(state.lastPosted).toLocaleString() : "Never") + "\n" +
      "Next topic: "  + TOPICS[state.topicIndex % TOPICS.length]
    );
  }
  if (action === "test") {
    api.send("🧪 Starting download + upload...\n⏳ Takes 1-3 minutes...");
    await autoPost(function(msg) { api.send(msg); });
    return;
  }
  if (action === "on") {
    if (state.interval) return api.send("Already running!");
    startAutoVideo();
    return api.send("✅ AutoVideo started!");
  }
  if (action === "off") {
    if (!state.interval) return api.send("Already stopped!");
    clearInterval(state.interval);
    state.interval = null;
    return api.send("🔴 AutoVideo stopped.");
  }
  if (action === "reset") {
    state.postedIds.clear();
    return api.send("🔄 History cleared!");
  }
  api.send("!autovideo status | test | on | off | reset");
};
