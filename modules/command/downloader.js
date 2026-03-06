const axios = require("axios");
const fs    = require("fs");
const path  = require("path");

module.exports.config = {
  name:        "downloader",
  description: "Auto-download Facebook, YouTube, TikTok videos when link is sent",
  usage:       "!fbdl | !ytdl | !tiktokdl [link] or just send the link",
  category:    "Utility",
};

const API_BASE = "https://cc-project-apis-jonell-magallanes.onrender.com";
const TMP_DIR  = "/tmp/downloader";
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

// ── API endpoints ─────────────────────────────────────────────────────────────
const APIS = {
  facebook: "/api/fbdl",
  youtube:  "/api/yt",
  tiktok:   "/api/tikdl",
};

// ── Detect link type ──────────────────────────────────────────────────────────
function detectLink(text) {
  if (!text) return null;
  text = text.trim();
  if (!/^https?:\/\//i.test(text)) return null;
  if (/facebook\.com|fb\.watch|fb\.com/i.test(text))    return { type: "facebook", url: text };
  if (/youtu\.be|youtube\.com/i.test(text))              return { type: "youtube",  url: text };
  if (/tiktok\.com|vm\.tiktok\.com/i.test(text))         return { type: "tiktok",   url: text };
  return null;
}

// ── Extract download URL from API response ────────────────────────────────────
function extractUrl(d) {
  return (
    (d && d.url)                              ||
    (d && d.hd)                               ||
    (d && d.sd)                               ||
    (d && d.nowm)                             ||
    (d && d.download_url)                     ||
    (d && d.downloadUrl)                      ||
    (d && d.video_url)                        ||
    (d && d.data && d.data.url)               ||
    (d && d.data && d.data.hd)                ||
    (d && d.data && d.data.sd)                ||
    (d && d.data && d.data.nowm)              ||
    (d && d.data && d.data.play)              ||
    (d && d.data && d.data.download_url)      ||
    (d && d.result && d.result.url)           ||
    (d && d.result && d.result.hd)            ||
    (d && d.result && d.result.nowm)          ||
    (Array.isArray(d) && d[0] && d[0].url)   ||
    null
  );
}

function extractTitle(d) {
  return (
    (d && d.title)                            ||
    (d && d.desc)                             ||
    (d && d.caption)                          ||
    (d && d.data && d.data.title)             ||
    (d && d.data && d.data.desc)              ||
    (d && d.result && d.result.title)         ||
    null
  );
}

// ── Emoji per type ────────────────────────────────────────────────────────────
const EMOJI = { facebook: "📘", youtube: "📺", tiktok: "🎵" };

// ── Main download handler ─────────────────────────────────────────────────────
async function handleDownload(api, event, url, type) {
  let filePath = null;
  try {
    await api.send(EMOJI[type] + " Downloading " + type + " video...\n⏳ Please wait...");

    // Call API
    const res = await axios.get(API_BASE + APIS[type] + "?url=" + encodeURIComponent(url), {
      timeout: 30000,
    });
    const d = res.data;
    console.log("[DL] " + type + " response:", JSON.stringify(d).substring(0, 300));

    const dlUrl = extractUrl(d);
    if (!dlUrl) throw new Error("No download link in API response");

    const title = extractTitle(d) || (type + " video");

    // Download the file
    const fname   = type + "_" + Date.now() + ".mp4";
    filePath       = path.join(TMP_DIR, fname);
    const fileRes  = await axios.get(dlUrl, {
      responseType:     "arraybuffer",
      timeout:          120000,
      maxContentLength: 50 * 1024 * 1024,
      headers:          { "User-Agent": "Mozilla/5.0" },
    });
    fs.writeFileSync(filePath, Buffer.from(fileRes.data));

    const mb = (fs.statSync(filePath).size / 1024 / 1024).toFixed(1);
    if (fs.statSync(filePath).size < 5000) throw new Error("Downloaded file too small");

    // Send to Messenger
    const FormData = require("form-data");
    const form     = new FormData();
    form.append("recipient",    JSON.stringify({ id: event.senderId }));
    form.append("message",      JSON.stringify({ attachment: { type: "video", payload: {} } }));
    form.append("filedata",     fs.createReadStream(filePath), { filename: "video.mp4", contentType: "video/mp4" });
    form.append("access_token", process.env.PAGE_ACCESS_TOKEN);

    await api.send(EMOJI[type] + " " + title + "\n📦 " + mb + "MB");
    await axios.post("https://graph.facebook.com/v19.0/me/messages", form, {
      headers: form.getHeaders(), timeout: 120000,
      maxBodyLength: Infinity, maxContentLength: Infinity,
    });

    console.log("[DL] Sent " + type + " video: " + mb + "MB");

  } catch(err) {
    console.error("[DL] Error:", err.message);
    await api.send(
      "❌ Download failed!\n\n" +
      "Reason: " + err.message + "\n\n" +
      "💡 Make sure the link is public and try again."
    );
  } finally {
    try { if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch(e) {}
  }
}

// ── Main command (!downloader) ────────────────────────────────────────────────
module.exports.run = async function ({ api, args, event }) {
  const input    = args.join(" ").trim();
  const detected = detectLink(input);
  if (!detected) {
    return api.send(
      "📥 Video Downloader\n━━━━━━━━━━━━━━\n" +
      "Just send any link:\n\n" +
      "📘 Facebook video\n" +
      "📺 YouTube video\n" +
      "🎵 TikTok video\n\n" +
      "Or use commands:\n" +
      "!fbdl [link]\n" +
      "!ytdl [link]\n" +
      "!tiktokdl [link]"
    );
  }
  await handleDownload(api, event, detected.url, detected.type);
};

// ── Auto-detect links in any message ─────────────────────────────────────────
module.exports.handleMessage = async function ({ api, event }) {
  if (!event.body) return;
  const text     = event.body.trim();
  // Only trigger if message is JUST a link
  if (!/^https?:\/\/\S+$/.test(text)) return;
  const detected = detectLink(text);
  if (!detected) return;
  console.log("[DL] Auto-detected " + detected.type + " link");
  await handleDownload(api, event, detected.url, detected.type);
};

// ── !fbdl command ─────────────────────────────────────────────────────────────
module.exports.fbdl = {
  config: { name: "fbdl", description: "Download Facebook video", usage: "!fbdl [link]", category: "Downloader" },
  run: async function ({ api, args, event }) {
    const url = args.join(" ").trim();
    if (!url) return api.send("Usage: !fbdl [Facebook video link]");
    await handleDownload(api, event, url, "facebook");
  },
};

// ── !ytdl command ─────────────────────────────────────────────────────────────
module.exports.ytdl = {
  config: { name: "ytdl", description: "Download YouTube video", usage: "!ytdl [link]", category: "Downloader" },
  run: async function ({ api, args, event }) {
    const url = args.join(" ").trim();
    if (!url) return api.send("Usage: !ytdl [YouTube link]");
    await handleDownload(api, event, url, "youtube");
  },
};

// ── !tiktokdl command ─────────────────────────────────────────────────────────
module.exports.tiktokdl = {
  config: { name: "tiktokdl", description: "Download TikTok video", usage: "!tiktokdl [link]", category: "Downloader" },
  run: async function ({ api, args, event }) {
    const url = args.join(" ").trim();
    if (!url) return api.send("Usage: !tiktokdl [TikTok link]");
    await handleDownload(api, event, url, "tiktok");
  },
};
