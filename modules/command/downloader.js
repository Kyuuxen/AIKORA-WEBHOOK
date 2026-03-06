const axios = require("axios");
const fs    = require("fs");
const path  = require("path");

module.exports.config = {
  name:        "downloader",
  description: "Auto-download Facebook, YouTube, TikTok videos when link is sent",
  usage:       "Just send a FB/YT/TikTok link!",
  category:    "Utility",
};

const API_BASE = "https://cc-project-apis-jonell-magallanes.onrender.com";
const TMP_DIR  = "/tmp/downloader";
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

// ── Detect link type ──────────────────────────────────────────────────────────
function detectLink(text) {
  if (!text) return null;
  text = text.trim();

  if (/facebook\.com|fb\.watch|fb\.com/i.test(text)) return { type: "facebook", url: text };
  if (/youtu\.be|youtube\.com/i.test(text))           return { type: "youtube",  url: text };
  if (/tiktok\.com|vm\.tiktok\.com/i.test(text))      return { type: "tiktok",   url: text };

  return null;
}

// ── Get download info from API ────────────────────────────────────────────────
async function getDownloadInfo(type, url) {
  const endpoints = {
    facebook: "/api/facebook",
    youtube:  "/api/youtube",
    tiktok:   "/api/tiktok",
  };

  const endpoint = endpoints[type];
  if (!endpoint) throw new Error("Unknown type: " + type);

  const res = await axios.get(API_BASE + endpoint, {
    params:  { url: url },
    timeout: 30000,
  });

  console.log("[DL] API response for " + type + ":", JSON.stringify(res.data).substring(0, 200));
  return res.data;
}

// ── Extract download URL from API response ────────────────────────────────────
function extractDownloadUrl(type, data) {
  if (!data) throw new Error("Empty API response");

  // Try common response formats
  const dl =
    data.download_url ||
    data.downloadUrl  ||
    data.url          ||
    data.video_url    ||
    data.videoUrl     ||
    data.hd           ||
    data.sd           ||
    data.low          ||
    (data.links && (data.links.hd || data.links.sd || data.links[0])) ||
    (data.data && (data.data.download_url || data.data.url || data.data.hd || data.data.sd)) ||
    (Array.isArray(data) && data[0] && (data[0].url || data[0].download_url));

  if (!dl) {
    console.log("[DL] Full response:", JSON.stringify(data));
    throw new Error("No download URL in response");
  }
  return typeof dl === "string" ? dl : dl.url || dl;
}

// ── Extract title from API response ──────────────────────────────────────────
function extractTitle(data) {
  return (
    (data && data.title) ||
    (data && data.data && data.data.title) ||
    (data && data.caption) ||
    "Video"
  );
}

// ── Download file ─────────────────────────────────────────────────────────────
async function downloadFile(url, filename) {
  const filePath = path.join(TMP_DIR, filename);
  const res = await axios.get(url, {
    responseType:     "arraybuffer",
    timeout:          120000,
    maxContentLength: 50 * 1024 * 1024,
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  fs.writeFileSync(filePath, Buffer.from(res.data));
  const mb = (fs.statSync(filePath).size / 1024 / 1024).toFixed(1);
  console.log("[DL] Downloaded: " + mb + "MB → " + filename);
  if (fs.statSync(filePath).size < 5000) throw new Error("File too small, download failed");
  return filePath;
}

// ── Send video to Messenger ───────────────────────────────────────────────────
async function sendVideo(api, event, filePath, caption) {
  if (caption) await api.send(caption);

  const pageToken = process.env.PAGE_ACCESS_TOKEN;
  if (!pageToken) throw new Error("PAGE_ACCESS_TOKEN not set");

  const FormData = require("form-data");
  const form     = new FormData();
  form.append("recipient",    JSON.stringify({ id: event.senderId }));
  form.append("message",      JSON.stringify({ attachment: { type: "video", payload: {} } }));
  form.append("filedata",     fs.createReadStream(filePath), { filename: "video.mp4", contentType: "video/mp4" });
  form.append("access_token", pageToken);

  await axios.post(
    "https://graph.facebook.com/v19.0/me/messages",
    form,
    {
      headers:          form.getHeaders(),
      timeout:          120000,
      maxBodyLength:    Infinity,
      maxContentLength: Infinity,
    }
  );
}

// ── Cleanup ───────────────────────────────────────────────────────────────────
function cleanup(filePath) {
  try { if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch(e) {}
}

// ── Emoji per type ────────────────────────────────────────────────────────────
const EMOJI = { facebook: "📘", youtube: "📺", tiktok: "🎵" };

// ── Main download handler ─────────────────────────────────────────────────────
async function handleDownload(api, event, url, type) {
  let filePath = null;
  try {
    await api.send(EMOJI[type] + " Downloading " + type + " video...\n⏳ Please wait...");

    const data    = await getDownloadInfo(type, url);
    const dlUrl   = extractDownloadUrl(type, data);
    const title   = extractTitle(data);
    const ext     = ".mp4";
    const fname   = type + "_" + Date.now() + ext;

    filePath = await downloadFile(dlUrl, fname);
    await sendVideo(api, event, filePath, EMOJI[type] + " " + title);
    console.log("[DL] Sent " + type + " video successfully");

  } catch(err) {
    console.error("[DL] Error:", err.message);
    await api.send(
      "❌ Download failed!\n\n" +
      "Reason: " + err.message + "\n\n" +
      "💡 Make sure the link is public and try again."
    );
  } finally {
    cleanup(filePath);
  }
}

// ── Command (manual use) ──────────────────────────────────────────────────────
module.exports.run = async function ({ api, args, event }) {
  const input = args.join(" ").trim();
  if (!input) {
    return api.send(
      "📥 Downloader\n━━━━━━━━━━━━━━\n" +
      "Just send any of these links and I will auto-download:\n\n" +
      "📘 Facebook video link\n" +
      "📺 YouTube video link\n" +
      "🎵 TikTok video link\n\n" +
      "Or use:\n" +
      "!fbdl [link]\n" +
      "!ytdl [link]\n" +
      "!tiktokdl [link]"
    );
  }

  const detected = detectLink(input);
  if (!detected) return api.send("❌ Invalid link! Send a Facebook, YouTube, or TikTok link.");
  await handleDownload(api, event, detected.url, detected.type);
};

// ── Auto-detect links in any message ─────────────────────────────────────────
module.exports.handleMessage = async function ({ api, event }) {
  if (!event.body) return;
  const text     = event.body.trim();
  const detected = detectLink(text);
  if (!detected) return;

  // Only trigger if message is JUST a link (no other text)
  const isJustLink = /^https?:\/\/\S+$/.test(text);
  if (!isJustLink) return;

  console.log("[DL] Auto-detected " + detected.type + " link");
  await handleDownload(api, event, detected.url, detected.type);
};

// ── Also export as separate named commands ────────────────────────────────────
module.exports.fbdl = async function ({ api, args, event }) {
  const url = args.join(" ").trim();
  if (!url) return api.send("Usage: !fbdl [Facebook video link]");
  await handleDownload(api, event, url, "facebook");
};

module.exports.ytdl = async function ({ api, args, event }) {
  const url = args.join(" ").trim();
  if (!url) return api.send("Usage: !ytdl [YouTube link]");
  await handleDownload(api, event, url, "youtube");
};

module.exports.tiktokdl = async function ({ api, args, event }) {
  const url = args.join(" ").trim();
  if (!url) return api.send("Usage: !tiktokdl [TikTok link]");
  await handleDownload(api, event, url, "tiktok");
};
