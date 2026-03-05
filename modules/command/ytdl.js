const axios   = require("axios");
const fs      = require("fs");
const path    = require("path");
const { promisify } = require("util");
const { exec }      = require("child_process");
const execAsync     = promisify(exec);

module.exports.config = {
  name:        "ytdl",
  description: "Download YouTube video and send to Messenger",
  usage:       "!ytdl [YouTube URL]",
  category:    "Utility",
};

const TMP_DIR = "/tmp/ytdl";
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

// ── Extract YouTube video ID ──────────────────────────────────────────────────
function extractVideoId(text) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
  ];
  for (let i = 0; i < patterns.length; i++) {
    const match = text.match(patterns[i]);
    if (match) return match[1];
  }
  return null;
}

// ── Get video info from YouTube API ──────────────────────────────────────────
async function getVideoInfo(videoId) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await axios.get("https://www.googleapis.com/youtube/v3/videos", {
      params: { key: apiKey, id: videoId, part: "snippet,contentDetails" },
      timeout: 10000,
    });
    const item = res.data && res.data.items && res.data.items[0];
    if (!item) return null;
    return {
      title:    item.snippet.title,
      channel:  item.snippet.channelTitle,
      duration: item.contentDetails.duration, // ISO 8601 e.g. PT4M13S
    };
  } catch(e) {
    console.log("[YTDL] YouTube API failed:", e.message);
    return null;
  }
}

// ── Parse ISO 8601 duration ───────────────────────────────────────────────────
function parseDuration(iso) {
  if (!iso) return 0;
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  return ((parseInt(match[1]) || 0) * 3600) +
         ((parseInt(match[2]) || 0) * 60)  +
          (parseInt(match[3]) || 0);
}

// ── Ensure yt-dlp is available ────────────────────────────────────────────────
async function ensureYtDlp() {
  // Try youtube-dl-exec npm package first
  try {
    require("youtube-dl-exec");
    return "ytdlexec";
  } catch(e) {}

  // Try yt-dlp binary
  try { await execAsync("yt-dlp --version"); return "binary"; } catch(e) {}
  try { await execAsync("/tmp/yt-dlp --version"); return "binary_tmp"; } catch(e) {}

  // Download binary
  try {
    await execAsync(
      "curl -sL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /tmp/yt-dlp && chmod +x /tmp/yt-dlp",
      { timeout: 60000 }
    );
    await execAsync("/tmp/yt-dlp --version");
    return "binary_tmp";
  } catch(e) {}

  return null;
}

// ── Download video ────────────────────────────────────────────────────────────
async function downloadVideo(videoUrl, videoId, method) {
  const outPath = path.join(TMP_DIR, videoId + ".mp4");
  if (fs.existsSync(outPath)) fs.unlinkSync(outPath);

  if (method === "ytdlexec") {
    const ytdl = require("youtube-dl-exec");
    await ytdl(videoUrl, {
      noPlaylist:        true,
      format:            "bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/best[height<=480][ext=mp4]/best[ext=mp4]/best",
      mergeOutputFormat: "mp4",
      output:            outPath,
      noWarnings:        true,
    });
  } else {
    const bin = method === "binary_tmp" ? "/tmp/yt-dlp" : "yt-dlp";
    await execAsync(
      bin + ' --no-playlist --max-filesize 25M' +
      ' -f "bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/best[height<=480][ext=mp4]/best[ext=mp4]/best"' +
      ' --merge-output-format mp4' +
      ' -o "' + outPath + '" ' + videoUrl,
      { timeout: 120000 }
    );
  }

  if (!fs.existsSync(outPath)) throw new Error("Download failed");
  const mb = (fs.statSync(outPath).size / 1024 / 1024).toFixed(1);
  if (fs.statSync(outPath).size < 10000) throw new Error("File too small");
  console.log("[YTDL] Downloaded: " + mb + "MB");
  return outPath;
}

// ── Send video to Messenger ───────────────────────────────────────────────────
async function sendVideo(api, recipientId, filePath, caption) {
  // First send caption
  if (caption) await api.send(caption);

  // Send video file via Messenger Send API
  const pageToken = process.env.PAGE_ACCESS_TOKEN;
  if (!pageToken) throw new Error("PAGE_ACCESS_TOKEN not set");

  const FormData = require("form-data");
  const form     = new FormData();

  form.append("recipient",  JSON.stringify({ id: recipientId }));
  form.append("message",    JSON.stringify({
    attachment: {
      type:    "video",
      payload: {},
    },
  }));
  form.append("filedata", fs.createReadStream(filePath), {
    filename:    "video.mp4",
    contentType: "video/mp4",
  });
  form.append("access_token", pageToken);

  const res = await axios.post(
    "https://graph.facebook.com/v19.0/me/messages",
    form,
    {
      headers: form.getHeaders(),
      timeout: 120000,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    }
  );
  return res.data;
}

// ── Cleanup ───────────────────────────────────────────────────────────────────
function cleanup(filePath) {
  try { if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch(e) {}
}

// ── Command ───────────────────────────────────────────────────────────────────
module.exports.run = async function ({ api, args, event }) {
  const input   = args.join(" ").trim();
  const videoId = extractVideoId(input);

  if (!videoId) {
    return api.send(
      "📹 YouTube Downloader\n━━━━━━━━━━━━━━\n" +
      "Usage: !ytdl [YouTube URL]\n\n" +
      "Example:\n!ytdl https://youtube.com/watch?v=xxxxx\n!ytdl https://youtu.be/xxxxx\n\n" +
      "⚠️ Max video length: 10 minutes\n" +
      "📦 Max file size: 25MB"
    );
  }

  let filePath = null;
  try {
    // Get video info
    const info = await getVideoInfo(videoId);
    const url  = "https://www.youtube.com/watch?v=" + videoId;

    if (info) {
      const secs = parseDuration(info.duration);
      if (secs > 600) { // 10 minutes max
        return api.send(
          "⚠️ Video too long!\n\n" +
          "📹 " + info.title + "\n" +
          "⏱️ Duration: " + Math.floor(secs/60) + " mins " + (secs%60) + " secs\n\n" +
          "Maximum allowed: 10 minutes"
        );
      }
      await api.send(
        "📥 Downloading...\n\n" +
        "📹 " + info.title + "\n" +
        "📺 " + info.channel + "\n" +
        "⏱️ " + Math.floor(secs/60) + ":" + String(secs%60).padStart(2,"0") + "\n\n" +
        "⏳ Please wait..."
      );
    } else {
      await api.send("📥 Downloading video...\n⏳ Please wait...");
    }

    // Check downloader
    const method = await ensureYtDlp();
    if (!method) {
      return api.send("❌ Downloader not available. Please add youtube-dl-exec to package.json!");
    }

    // Download
    filePath = await downloadVideo(url, videoId, method);

    // Send to Messenger
    const caption = info ? "📹 " + info.title + "\n📺 " + info.channel : "📹 Here's your video!";
    await sendVideo(api, event.senderId, filePath, caption);

  } catch(err) {
    console.error("[YTDL] Error:", err.message);

    if (err.message.includes("Sign in") || err.message.includes("bot")) {
      return api.send("❌ YouTube is blocking the download.\n\nTry a different video or try again later.");
    }
    if (err.message.includes("too large") || err.message.includes("25M")) {
      return api.send("❌ Video file too large!\n\nTry a shorter video (under 5 minutes).");
    }
    api.send("❌ Failed: " + err.message);
  } finally {
    cleanup(filePath);
  }
};

// ── Auto-detect YouTube links in chat (no command needed) ─────────────────────
module.exports.handleMessage = async function ({ api, event }) {
  if (!event.body) return;
  const videoId = extractVideoId(event.body);
  if (!videoId) return;

  // Only auto-download if message is JUST a YouTube link
  const isJustLink = event.body.trim().match(/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\S+$/);
  if (!isJustLink) return;

  console.log("[YTDL] Auto-detected YouTube link:", videoId);

  let filePath = null;
  try {
    const info   = await getVideoInfo(videoId);
    const url    = "https://www.youtube.com/watch?v=" + videoId;
    const secs   = info ? parseDuration(info.duration) : 0;

    if (secs > 600) {
      await api.send("⚠️ Video too long to download (max 10 mins).\n📹 " + (info ? info.title : videoId));
      return;
    }

    await api.send("📥 YouTube link detected! Downloading...\n⏳ Please wait...");

    const method = await ensureYtDlp();
    if (!method) return;

    filePath = await downloadVideo(url, videoId, method);
    const caption = info ? "📹 " + info.title + "\n📺 " + info.channel : "📹 Here's your video!";
    await sendVideo(api, event.senderId, filePath, caption);

  } catch(e) {
    console.log("[YTDL] Auto-download failed:", e.message);
    // Silently fail on auto-detect to not spam users
  } finally {
    cleanup(filePath);
  }
};
