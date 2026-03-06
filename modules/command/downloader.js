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

// ── YouTube via y2mate ────────────────────────────────────────────────────────
function extractYouTubeId(url) {
  const m = url.match(/(?:v=|youtu\.be\/|shorts\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

async function getYouTube(url) {
  const videoId = extractYouTubeId(url);
  if (!videoId) throw new Error("Invalid YouTube URL");

  // Step 1: Analyze
  const analyze = await axios.post(
    "https://www.y2mate.com/mates/analyzeV2/ajax",
    "k_query=" + encodeURIComponent("https://www.youtube.com/watch?v=" + videoId) + "&k_page=home&hl=en&q_auto=0",
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent":   "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer":      "https://www.y2mate.com/",
      },
      timeout: 20000,
    }
  );

  if (!analyze.data || analyze.data.status !== "ok") throw new Error("y2mate analyze failed");

  const links = analyze.data.links && analyze.data.links.mp4 ? analyze.data.links.mp4 : {};
  const title  = analyze.data.title || "YouTube Video";

  // Pick best quality key
  let bestKey = null;
  const preferred = ["360p", "480p", "720p", "240p", "144p"];
  for (let i = 0; i < preferred.length; i++) {
    if (links[preferred[i]] && links[preferred[i]].k) {
      bestKey = links[preferred[i]].k;
      break;
    }
  }
  if (!bestKey) {
    const keys = Object.keys(links);
    if (keys.length > 0 && links[keys[0]].k) bestKey = links[keys[0]].k;
  }
  if (!bestKey) throw new Error("No downloadable quality found");

  // Step 2: Convert
  const convert = await axios.post(
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

  if (!convert.data || convert.data.status !== "ok" || !convert.data.dlink) {
    throw new Error("y2mate convert failed");
  }

  return { url: convert.data.dlink, title: title };
}

// ── Facebook via getfvid.com ──────────────────────────────────────────────────
async function getFacebook(url) {
  // Use snap.tiktokv.com which also handles FB or try getfvid API
  const res = await axios.post(
    "https://getfvid.com/downloader",
    "url=" + encodeURIComponent(url),
    {
      headers: {
        "Content-Type":  "application/x-www-form-urlencoded",
        "User-Agent":    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer":       "https://getfvid.com/",
        "Origin":        "https://getfvid.com",
      },
      timeout: 20000,
    }
  );

  const html = res.data;
  // Extract HD or SD download link from HTML
  const hdMatch = html.match(/href="(https:\/\/[^"]+\.mp4[^"]*)"[^>]*>.*?HD/i);
  const sdMatch = html.match(/href="(https:\/\/[^"]+\.mp4[^"]*)"/i);
  const dlUrl   = (hdMatch && hdMatch[1]) || (sdMatch && sdMatch[1]) || null;

  if (!dlUrl) {
    // Try snapsave.app as fallback
    const snap = await axios.post(
      "https://snapsave.app/action.php",
      "url=" + encodeURIComponent(url),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent":   "Mozilla/5.0",
          "Referer":      "https://snapsave.app/",
        },
        timeout: 20000,
      }
    );
    const snapHtml = typeof snap.data === "string" ? snap.data : JSON.stringify(snap.data);
    const snapMatch = snapHtml.match(/href="(https:\/\/[^"]+\.mp4[^"]*)"/i);
    if (snapMatch && snapMatch[1]) return { url: snapMatch[1], title: "Facebook Video" };
    throw new Error("Could not extract Facebook download link");
  }

  return { url: dlUrl, title: "Facebook Video" };
}

// ── Download file to disk ─────────────────────────────────────────────────────
async function downloadFile(url, type) {
  const fname    = type + "_" + Date.now() + ".mp4";
  const filePath = path.join(TMP_DIR, fname);
  const res      = await axios.get(url, {
    responseType:     "arraybuffer",
    timeout:          120000,
    maxContentLength: 50 * 1024 * 1024,
    headers:          { "User-Agent": "Mozilla/5.0", "Referer": "https://www.tiktok.com/" },
  });
  fs.writeFileSync(filePath, Buffer.from(res.data));
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
    if (type === "tiktok")   info = await getTikTok(url);
    else if (type === "youtube") info = await getYouTube(url);
    else if (type === "facebook") info = await getFacebook(url);
    else throw new Error("Unknown type");

    const { filePath: fp, mb } = await downloadFile(info.url, type);
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
