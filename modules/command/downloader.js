const axios = require("axios");
const fs    = require("fs");
const path  = require("path");

module.exports.config = {
  name:        "downloader",
  description: "Auto-download Facebook, YouTube, TikTok videos when link is sent",
  usage:       "!fbdl | !ytdl | !tiktokdl [link] or just send the link",
  category:    "Utility",
};

const TMP_DIR = "/tmp/downloader";
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

// ── Detect link type ──────────────────────────────────────────────────────────
function detectLink(text) {
  if (!text) return null;
  text = text.trim();
  if (!/^https?:\/\//i.test(text)) return null;
  if (/facebook\.com|fb\.watch|fb\.com/i.test(text))   return { type: "facebook", url: text };
  if (/youtu\.be|youtube\.com/i.test(text))             return { type: "youtube",  url: text };
  if (/tiktok\.com|vm\.tiktok\.com/i.test(text))        return { type: "tiktok",   url: text };
  return null;
}

// ── TikTok via tikwm.com (free, reliable) ────────────────────────────────────
async function getTikTok(url) {
  const res = await axios.post(
    "https://www.tikwm.com/api/",
    "url=" + encodeURIComponent(url) + "&hd=1",
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent":   "Mozilla/5.0",
      },
      timeout: 20000,
    }
  );
  const d = res.data && res.data.data ? res.data.data : null;
  if (!d) throw new Error("TikTok API failed");
  return {
    url:   d.hdplay || d.play || d.wmplay,
    title: d.title || "TikTok Video",
  };
}

// ── YouTube via @distube/ytdl-core (npm package) ─────────────────────────────
async function getYouTube(url) {
  const ytdl = require("@distube/ytdl-core");
  const info  = await ytdl.getInfo(url, {
    requestOptions: { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" } }
  });
  const title   = info.videoDetails.title || "YouTube Video";
  // Pick best format under 50MB — prefer 360p or 480p
  const formats = ytdl.filterFormats(info.formats, "videoandaudio");
  const format  = formats.find(function(f) { return f.qualityLabel === "360p"; })
                  || formats.find(function(f) { return f.qualityLabel === "480p"; })
                  || formats.find(function(f) { return f.qualityLabel === "240p"; })
                  || formats[0];
  if (!format) throw new Error("No downloadable format found");
  return { stream: ytdl.downloadFromInfo(info, { format: format }), title: title };
}

// ── Facebook via facebook-dl (npm package) ────────────────────────────────────
async function getFacebook(url) {
  const fbdl = require("facebook-dl");
  const info  = await fbdl(url);
  const dlUrl = (info && info.hd) || (info && info.sd) || (info && info.url) || null;
  if (!dlUrl) throw new Error("Could not get Facebook download link");
  return { url: dlUrl, title: (info && info.title) || "Facebook Video" };
}

// ── Download file to disk (URL or stream) ────────────────────────────────────
async function downloadFile(urlOrStream, type) {
  const fname    = type + "_" + Date.now() + ".mp4";
  const filePath = path.join(TMP_DIR, fname);

  if (urlOrStream && typeof urlOrStream === "object" && urlOrStream.pipe) {
    // It's a readable stream (YouTube)
    await new Promise(function(resolve, reject) {
      const ws = fs.createWriteStream(filePath);
      urlOrStream.pipe(ws);
      ws.on("finish", resolve);
      ws.on("error", reject);
      urlOrStream.on("error", reject);
    });
  } else {
    // It's a URL string
    const res = await axios.get(urlOrStream, {
      responseType:     "arraybuffer",
      timeout:          120000,
      maxContentLength: 50 * 1024 * 1024,
      headers:          { "User-Agent": "Mozilla/5.0", "Referer": "https://www.tiktok.com/" },
    });
    fs.writeFileSync(filePath, Buffer.from(res.data));
  }

  const size = fs.statSync(filePath).size;
  if (size < 10000) throw new Error("Downloaded file too small (" + size + " bytes)");
  return { filePath, mb: (size / 1024 / 1024).toFixed(1) };
}

// ── Send video via Messenger ──────────────────────────────────────────────────
async function sendVideo(event, filePath) {
  const FormData = require("form-data");
  const form     = new FormData();
  form.append("recipient",    JSON.stringify({ id: event.senderId }));
  form.append("message",      JSON.stringify({ attachment: { type: "video", payload: {} } }));
  form.append("filedata",     fs.createReadStream(filePath), { filename: "video.mp4", contentType: "video/mp4" });
  form.append("access_token", process.env.PAGE_ACCESS_TOKEN);

  await axios.post("https://graph.facebook.com/v19.0/me/messages", form, {
    headers: form.getHeaders(), timeout: 120000,
    maxBodyLength: Infinity, maxContentLength: Infinity,
  });
}

// ── Cleanup ───────────────────────────────────────────────────────────────────
function cleanup(fp) {
  try { if (fp && fs.existsSync(fp)) fs.unlinkSync(fp); } catch(e) {}
}

const EMOJI = { facebook: "📘", youtube: "📺", tiktok: "🎵" };

// ── Main handler ──────────────────────────────────────────────────────────────
async function handleDownload(api, event, url, type) {
  let filePath = null;
  try {
    await api.send(EMOJI[type] + " Downloading " + type + " video...\n⏳ Please wait...");

    let info;
    if (type === "tiktok")        info = await getTikTok(url);
    else if (type === "youtube")  info = await getYouTube(url);
    else if (type === "facebook") info = await getFacebook(url);
    else throw new Error("Unknown type");

    const downloadSrc = info.stream || info.url;
    const { filePath: fp, mb } = await downloadFile(downloadSrc, type);
    filePath = fp;

    await api.send(EMOJI[type] + " " + info.title + "\n📦 " + mb + "MB");
    await sendVideo(event, filePath);
    console.log("[DL] Sent " + type + " video: " + mb + "MB");

  } catch(err) {
    console.error("[DL] " + type + " error:", err.message);
    await api.send(
      "❌ Download failed!\n\n" +
      "Reason: " + err.message + "\n\n" +
      "💡 Make sure the link is public."
    );
  } finally {
    cleanup(filePath);
  }
}

// ── Main !downloader command ──────────────────────────────────────────────────
module.exports.run = async function ({ api, args, event }) {
  const input    = args.join(" ").trim();
  const detected = detectLink(input);
  if (!detected) {
    return api.send(
      "📥 Video Downloader\n━━━━━━━━━━━━━━\n" +
      "Send a link or use:\n\n" +
      "!fbdl [Facebook link]\n" +
      "!ytdl [YouTube link]\n" +
      "!tiktokdl [TikTok link]"
    );
  }
  await handleDownload(api, event, detected.url, detected.type);
};

// ── Auto-detect links ─────────────────────────────────────────────────────────
module.exports.handleMessage = async function ({ api, event }) {
  if (!event.body) return;
  const text = event.body.trim();
  if (!/^https?:\/\/\S+$/.test(text)) return;
  const detected = detectLink(text);
  if (!detected) return;
  console.log("[DL] Auto-detected " + detected.type + " link");
  await handleDownload(api, event, detected.url, detected.type);
};

// ── Sub-commands ──────────────────────────────────────────────────────────────
module.exports.fbdl = {
  config: { name: "fbdl", description: "Download Facebook video", usage: "!fbdl [link]", category: "Downloader" },
  run: async function ({ api, args, event }) {
    const url = args.join(" ").trim();
    if (!url) return api.send("Usage: !fbdl [Facebook video link]");
    await handleDownload(api, event, url, "facebook");
  },
};

module.exports.ytdl = {
  config: { name: "ytdl", description: "Download YouTube video", usage: "!ytdl [link]", category: "Downloader" },
  run: async function ({ api, args, event }) {
    const url = args.join(" ").trim();
    if (!url) return api.send("Usage: !ytdl [YouTube link]");
    await handleDownload(api, event, url, "youtube");
  },
};

module.exports.tiktokdl = {
  config: { name: "tiktokdl", description: "Download TikTok video without watermark", usage: "!tiktokdl [link]", category: "Downloader" },
  run: async function ({ api, args, event }) {
    const url = args.join(" ").trim();
    if (!url) return api.send("Usage: !tiktokdl [TikTok link]");
    await handleDownload(api, event, url, "tiktok");
  },
};
