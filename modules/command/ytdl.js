const axios   = require("axios");
const fs      = require("fs");
const path    = require("path");

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
      duration: item.contentDetails.duration,
    };
  } catch(e) { return null; }
}

// ── Parse ISO 8601 duration ───────────────────────────────────────────────────
function parseDuration(iso) {
  if (!iso) return 0;
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  return ((parseInt(match[1])||0)*3600) + ((parseInt(match[2])||0)*60) + (parseInt(match[3])||0);
}

// ── Get download URL via y2mate ───────────────────────────────────────────────
async function getDownloadUrl(videoId) {
  const videoUrl = "https://www.youtube.com/watch?v=" + videoId;

  // Step 1: Analyze video
  const analyzeRes = await axios.post(
    "https://www.y2mate.com/mates/analyzeV2/ajax",
    "k_query=" + encodeURIComponent(videoUrl) + "&k_page=home&hl=en&q_auto=0",
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent":   "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer":      "https://www.y2mate.com/",
      },
      timeout: 20000,
    }
  );

  const data = analyzeRes.data;
  if (!data || data.status !== "ok") throw new Error("y2mate analyze failed");

  // Get best video quality key (prefer 360p or 480p for speed)
  const links = data.links && data.links.mp4 ? data.links.mp4 : {};
  let bestKey  = null;
  let bestSize = 0;

  const preferred = ["360p", "480p", "720p", "240p", "144p"];
  for (let i = 0; i < preferred.length; i++) {
    const quality = preferred[i];
    if (links[quality] && links[quality].k) {
      bestKey = links[quality].k;
      break;
    }
  }

  // Fallback: pick any available quality
  if (!bestKey) {
    const keys = Object.keys(links);
    if (keys.length > 0 && links[keys[0]].k) bestKey = links[keys[0]].k;
  }

  if (!bestKey) throw new Error("No downloadable format found");

  // Step 2: Convert to get download link
  const convertRes = await axios.post(
    "https://www.y2mate.com/mates/convertV2/index",
    "vid=" + videoId + "&k=" + encodeURIComponent(bestKey),
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent":   "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer":      "https://www.y2mate.com/",
      },
      timeout: 30000,
    }
  );

  const convertData = convertRes.data;
  if (!convertData || convertData.status !== "ok") throw new Error("y2mate convert failed");

  // Extract download URL from response
  const dlUrl = convertData.dlink;
  if (!dlUrl) throw new Error("No download link in response");

  console.log("[YTDL] Got download URL from y2mate");
  return dlUrl;
}

// ── Download video file ───────────────────────────────────────────────────────
async function downloadFile(url, videoId) {
  const outPath = path.join(TMP_DIR, videoId + ".mp4");
  if (fs.existsSync(outPath)) fs.unlinkSync(outPath);

  const res = await axios.get(url, {
    responseType: "arraybuffer",
    timeout:      120000,
    maxContentLength: 50 * 1024 * 1024, // 50MB max
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Referer":    "https://www.y2mate.com/",
    },
  });

  fs.writeFileSync(outPath, Buffer.from(res.data));
  const mb = (fs.statSync(outPath).size / 1024 / 1024).toFixed(1);
  console.log("[YTDL] Downloaded: " + mb + "MB");
  if (fs.statSync(outPath).size < 10000) throw new Error("File too small - download failed");
  return outPath;
}

// ── Send video to Messenger ───────────────────────────────────────────────────
async function sendVideo(api, recipientId, filePath, caption) {
  if (caption) await api.send(caption);

  const pageToken = process.env.PAGE_ACCESS_TOKEN;
  if (!pageToken) throw new Error("PAGE_ACCESS_TOKEN not set");

  const FormData = require("form-data");
  const form     = new FormData();
  form.append("recipient",    JSON.stringify({ id: recipientId }));
  form.append("message",      JSON.stringify({ attachment: { type: "video", payload: {} } }));
  form.append("filedata",     fs.createReadStream(filePath), { filename: "video.mp4", contentType: "video/mp4" });
  form.append("access_token", pageToken);

  await axios.post(
    "https://graph.facebook.com/v19.0/me/messages",
    form,
    {
      headers: form.getHeaders(),
      timeout: 120000,
      maxBodyLength:    Infinity,
      maxContentLength: Infinity,
    }
  );
}

// ── Cleanup ───────────────────────────────────────────────────────────────────
function cleanup(filePath) {
  try { if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch(e) {}
}

// ── Main handler ──────────────────────────────────────────────────────────────
async function handleDownload(api, event, input) {
  const videoId = extractVideoId(input);
  if (!videoId) return false;

  let filePath = null;
  try {
    const info = await getVideoInfo(videoId);

    if (info) {
      const secs = parseDuration(info.duration);
      if (secs > 600) {
        await api.send(
          "⚠️ Video too long!\n\n" +
          "📹 " + info.title + "\n" +
          "⏱️ " + Math.floor(secs/60) + " mins " + (secs%60) + " secs\n\n" +
          "Maximum: 10 minutes"
        );
        return true;
      }
      await api.send(
        "📥 Downloading...\n\n" +
        "📹 " + info.title + "\n" +
        "📺 " + info.channel + "\n" +
        "⏱️ " + Math.floor(secs/60) + ":" + String(secs%60).padStart(2,"0") + "\n\n" +
        "⏳ Please wait ~30 seconds..."
      );
    } else {
      await api.send("📥 Downloading video...\n⏳ Please wait...");
    }

    // Get download URL from y2mate
    const dlUrl  = await getDownloadUrl(videoId);
    filePath      = await downloadFile(dlUrl, videoId);

    const caption = info
      ? "📹 " + info.title + "\n📺 " + info.channel
      : "📹 Here's your video!";

    await sendVideo(api, event.senderId, filePath, caption);
    console.log("[YTDL] Successfully sent video:", videoId);

  } catch(err) {
    console.error("[YTDL] Error:", err.message);
    await api.send(
      "❌ Download failed!\n\n" +
      "Reason: " + err.message + "\n\n" +
      "💡 Tips:\n" +
      "• Try a shorter video (under 5 mins)\n" +
      "• Some videos are restricted\n" +
      "• Try again in a few minutes"
    );
  } finally {
    cleanup(filePath);
  }
  return true;
}

// ── Command ───────────────────────────────────────────────────────────────────
module.exports.run = async function ({ api, args, event }) {
  const input = args.join(" ").trim();

  if (!input) {
    return api.send(
      "📹 YouTube Downloader\n━━━━━━━━━━━━━━\n" +
      "Usage: !ytdl [YouTube URL]\n\n" +
      "Examples:\n" +
      "!ytdl https://youtu.be/xxxxx\n" +
      "!ytdl https://youtube.com/watch?v=xxxxx\n" +
      "!ytdl https://youtube.com/shorts/xxxxx\n\n" +
      "⏱️ Max: 10 minutes\n" +
      "📦 Quality: 360p-480p"
    );
  }

  await handleDownload(api, event, input);
};

// ── Auto-detect YouTube links ─────────────────────────────────────────────────
module.exports.handleMessage = async function ({ api, event }) {
  if (!event.body) return;
  const isJustLink = event.body.trim().match(/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\S+$/);
  if (!isJustLink) return;
  console.log("[YTDL] Auto-detected YouTube link");
  await handleDownload(api, event, event.body.trim());
};
