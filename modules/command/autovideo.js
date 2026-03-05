const axios  = require("axios");
const fs     = require("fs");
const path   = require("path");
const { promisify } = require("util");
const { exec }      = require("child_process");
const execAsync     = promisify(exec);

module.exports.config = {
  name:        "autovideo",
  description: "Auto generate news videos and post to Facebook",
  usage:       "!autovideo status | test | on | off | reset",
  category:    "Automation",
};

if (!global.autoVideoState) {
  global.autoVideoState = {
    postedUrls:  new Set(),
    totalPosted: 0,
    lastPosted:  null,
    interval:    null,
    isPosting:   false,
  };
}
const state = global.autoVideoState;

const TMP_DIR  = "/tmp/autovideo";
const LOGO_URL = "https://i.ibb.co/nxXsv5M/file-000000000e907206aa347a1de1d8d10a.png";
const PAGE_NAME = "AIKORA NEWS";

if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

// ── Safe text ─────────────────────────────────────────────────────────────────
function safeText(str) {
  return String(str)
    .replace(/['"\\:[\]]/g, " ")
    .replace(/[^\x20-\x7E]/g, "")
    .substring(0, 50)
    .trim();
}

// ── Download file ─────────────────────────────────────────────────────────────
async function downloadFile(url, dest) {
  const res = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 20000,
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  fs.writeFileSync(dest, Buffer.from(res.data));
}

// ── Get one good image ────────────────────────────────────────────────────────
async function getImage(article) {
  // Try Pexels
  const pexelsKey = process.env.PEXELS_API_KEY;
  if (pexelsKey) {
    try {
      const query = article.title.split(" ").slice(0, 3).join(" ");
      const res   = await axios.get("https://api.pexels.com/v1/search", {
        params: { query: query, per_page: 3, orientation: "landscape" },
        headers: { Authorization: pexelsKey },
        timeout: 10000,
      });
      const photos = (res.data && res.data.photos) ? res.data.photos : [];
      if (photos.length > 0) return photos[0].src.large;
    } catch(e) {}
  }
  // Try article image
  if (article.image || article.urlToImage) return article.image || article.urlToImage;
  // Fallback: generate headline card image
  const t = encodeURIComponent(safeText(article.title));
  return "https://og.tailgraph.com/og?fontFamily=Roboto&title=" + t +
    "&titleTailwind=text-white+text-4xl+font-bold&bgTailwind=bg-gray-900&footer=AIKORA+NEWS&footerTailwind=text-gray-400";
}

// ── Generate video using SINGLE image + ffmpeg (ultra fast) ───────────────────
// Strategy: 1 image + text overlay + music = simple, fast, under 30 seconds
async function generateVideo(article, imageUrl, musicPath, logoPath) {
  const outPath  = path.join(TMP_DIR, "output.mp4");
  if (fs.existsSync(outPath)) fs.unlinkSync(outPath);

  const headline = safeText(article.title);
  const source   = safeText((article.source && article.source.name) ? article.source.name : "NEWS").toUpperCase();
  const dateStr  = safeText(new Date().toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" }));

  // Download and convert image
  const rawImg = path.join(TMP_DIR, "bg_raw.jpg");
  const bgImg  = path.join(TMP_DIR, "bg.jpg");
  try {
    await downloadFile(imageUrl, rawImg);
    await execAsync(
      'ffmpeg -y -i "' + rawImg + '" -vf "scale=640:360:force_original_aspect_ratio=increase,crop=640:360,format=yuv420p" -q:v 3 "' + bgImg + '"',
      { timeout: 20000 }
    );
  } catch(e) {
    // Create plain dark background if image fails
    await execAsync(
      'ffmpeg -y -f lavfi -i "color=c=0x1a1a2e:size=640x360:rate=1" -frames:v 1 "' + bgImg + '"',
      { timeout: 10000 }
    );
  }

  // Lower third positions for 360p
  const barY  = 265;
  const lineY = 263;
  const t1Y   = 273;
  const t2Y   = 295;

  const drawText = [
    "drawbox=x=0:y=" + barY  + ":w=640:h=95:color=black@0.85:t=fill",
    "drawbox=x=0:y=" + lineY + ":w=640:h=3:color=red:t=fill",
    "drawtext=text='" + PAGE_NAME + "':fontcolor=red:fontsize=13:x=10:y=" + t1Y,
    "drawtext=text='" + dateStr   + "':fontcolor=white@0.6:fontsize=11:x=w-tw-10:y=" + t1Y,
    "drawtext=text='" + headline  + "':fontcolor=white:fontsize=15:x=10:y=" + t2Y,
    "drawtext=text='" + source    + "':fontcolor=yellow:fontsize=12:x=w-tw-10:y=" + t2Y,
  ].join(",");

  // Build inputs and filter
  let inputs     = '-loop 1 -t 15 -i "' + bgImg + '"'; // 15 seconds only!
  let inputIdx   = 1;
  let baseStream = "0:v";
  let filters    = [];

  if (logoPath && fs.existsSync(logoPath)) {
    // Resize logo small
    const smallLogo = path.join(TMP_DIR, "slogo.png");
    try {
      await execAsync('ffmpeg -y -i "' + logoPath + '" -vf "scale=60:60:force_original_aspect_ratio=decrease" "' + smallLogo + '"', { timeout: 10000 });
      inputs += ' -i "' + smallLogo + '"';
      filters.push("[" + baseStream + "][" + inputIdx + ":v]overlay=10:10:format=auto[logoout]");
      baseStream = "logoout";
      inputIdx++;
    } catch(e) {}
  }

  filters.push("[" + baseStream + "]" + drawText + ",[0:v]fps=10,format=yuv420p[final]");

  // Simpler approach - just apply drawtext directly without complex filter
  let cmd;
  if (musicPath && fs.existsSync(musicPath)) {
    cmd = 'ffmpeg -y -loop 1 -t 15 -i "' + bgImg + '" -i "' + musicPath + '" ';
    if (logoPath && fs.existsSync(logoPath)) {
      const smallLogo = path.join(TMP_DIR, "slogo.png");
      if (fs.existsSync(smallLogo)) {
        cmd += '-i "' + smallLogo + '" ';
        cmd += '-filter_complex "[0:v][2:v]overlay=10:10:format=auto[bg];[bg]' + drawText + ',fps=10,format=yuv420p[final]" ';
        cmd += '-map "[final]" -map 1:a ';
      } else {
        cmd += '-vf "' + drawText + ',fps=10,format=yuv420p" ';
      }
    } else {
      cmd += '-vf "' + drawText + ',fps=10,format=yuv420p" ';
    }
    cmd += '-c:v libx264 -preset ultrafast -crf 32 ';
    cmd += '-c:a aac -b:a 64k -filter:a "volume=0.2" ';
    cmd += '-t 15 -shortest ';
  } else {
    cmd = 'ffmpeg -y -loop 1 -t 15 -i "' + bgImg + '" ';
    cmd += '-vf "' + drawText + ',fps=10,format=yuv420p" ';
    cmd += '-c:v libx264 -preset ultrafast -crf 32 ';
    cmd += '-t 15 -an ';
  }

  cmd += '"' + outPath + '"';

  console.log("[AutoVideo] Rendering 15s video...");
  await execAsync(cmd, { timeout: 60000, maxBuffer: 20 * 1024 * 1024 }); // 1 min max

  if (!fs.existsSync(outPath)) throw new Error("Output not created");
  const mb = (fs.statSync(outPath).size / 1024 / 1024).toFixed(1);
  console.log("[AutoVideo] Done: " + mb + "MB");
  return outPath;
}

// ── Upload to Facebook ────────────────────────────────────────────────────────
async function uploadToFacebook(filePath, title, caption) {
  const pageId    = process.env.PAGE_ID;
  const feedToken = process.env.PAGE_FEED_TOKEN;
  if (!pageId || !feedToken) throw new Error("PAGE_ID or PAGE_FEED_TOKEN not set.");

  const fileSize = fs.statSync(filePath).size;
  console.log("[AutoVideo] Uploading " + (fileSize/1024/1024).toFixed(1) + "MB...");

  const initRes = await axios.post(
    "https://graph-video.facebook.com/v19.0/" + pageId + "/videos", null,
    { params: { upload_phase: "start", file_size: fileSize, access_token: feedToken }, timeout: 30000 }
  );
  const sessionId = initRes.data.upload_session_id;

  const CHUNK  = 3 * 1024 * 1024;
  const buffer = fs.readFileSync(filePath);
  let offset   = 0;
  while (offset < fileSize) {
    const chunk    = buffer.slice(offset, Math.min(offset + CHUNK, fileSize));
    const chunkRes = await axios.post(
      "https://graph-video.facebook.com/v19.0/" + pageId + "/videos", chunk,
      {
        params: { upload_phase: "transfer", upload_session_id: sessionId, start_offset: offset, access_token: feedToken },
        headers: { "Content-Type": "application/octet-stream" },
        timeout: 60000, maxBodyLength: Infinity, maxContentLength: Infinity,
      }
    );
    offset = parseInt(chunkRes.data.start_offset) || (offset + chunk.length);
  }

  await axios.post(
    "https://graph-video.facebook.com/v19.0/" + pageId + "/videos", null,
    {
      params: {
        upload_phase: "finish", upload_session_id: sessionId,
        title: title.substring(0, 100), description: caption.substring(0, 500),
        access_token: feedToken,
      },
      timeout: 60000,
    }
  );
  console.log("[AutoVideo] Upload complete!");
}

// ── Fetch news ────────────────────────────────────────────────────────────────
async function fetchNews() {
  try {
    const res = await axios.get("https://gnews.io/api/v4/top-headlines", {
      params: { lang: "en", country: "ph", max: 10, apikey: process.env.GNEWS_API_KEY || "demo" },
      timeout: 15000,
    });
    return (res.data && res.data.articles) ? res.data.articles : [];
  } catch(e) {}
  try {
    const res = await axios.get(
      "https://api.rss2json.com/v1/api.json?rss_url=https://feeds.bbci.co.uk/news/rss.xml",
      { timeout: 15000 }
    );
    return ((res.data && res.data.items) ? res.data.items : []).map(function(item) {
      return {
        title:  item.title,
        url:    item.link,
        image:  (item.enclosure && item.enclosure.link) ? item.enclosure.link : (item.thumbnail||null),
        source: { name: "BBC News" },
      };
    });
  } catch(e) { return []; }
}

// ── Get logo ──────────────────────────────────────────────────────────────────
async function getLogo() {
  const logoPath = path.join(TMP_DIR, "logo.png");
  if (fs.existsSync(logoPath)) return logoPath;
  try {
    await downloadFile(LOGO_URL, logoPath);
    return logoPath;
  } catch(e) { return null; }
}

// ── Get music ─────────────────────────────────────────────────────────────────
async function getMusic() {
  const musicPath = path.join(TMP_DIR, "music.mp3");
  try {
    await downloadFile("https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3", musicPath);
    return musicPath;
  } catch(e) { return null; }
}

// ── Generate caption ──────────────────────────────────────────────────────────
async function generateCaption(article) {
  try {
    const res = await axios.get("https://api-library-kohi.onrender.com/api/copilot", {
      params: { prompt: "Write a short Facebook post caption (2 sentences, no hashtags, no asterisks):\n\n" + article.title },
      timeout: 15000,
    });
    const r = (res.data && res.data.data && res.data.data.text) ? res.data.data.text : null;
    if (r && r.length > 20) return r.replace(/\*\*/g,"").replace(/\*/g,"").trim();
  } catch(e) {}
  return article.title;
}

// ── Cleanup ───────────────────────────────────────────────────────────────────
function cleanTmp() {
  try {
    fs.readdirSync(TMP_DIR).forEach(function(f) {
      if (f !== "logo.png" && f !== "music.mp3") {
        try { fs.unlinkSync(path.join(TMP_DIR, f)); } catch(e) {}
      }
    });
  } catch(e) {}
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function autoPost(notifyFn) {
  if (state.isPosting) { notifyFn("⏳ Still generating, skipping..."); return; }
  state.isPosting = true;

  try {
    const articles = await fetchNews();
    if (!articles.length) { notifyFn("⚠️ No articles found."); return; }

    let article = null;
    for (let i = 0; i < articles.length; i++) {
      if (articles[i].url && !state.postedUrls.has(articles[i].url)) { article = articles[i]; break; }
    }
    if (!article) { state.postedUrls.clear(); article = articles[0]; }
    state.postedUrls.add(article.url);

    notifyFn("📰 Generating: " + article.title + "\n⏳ ~30 seconds...");

    const imageUrl  = await getImage(article);
    const logoPath  = await getLogo();
    const musicPath = await getMusic();

    const videoPath = await generateVideo(article, imageUrl, musicPath, logoPath);
    const caption   = await generateCaption(article);

    notifyFn("📤 Uploading...");
    await uploadToFacebook(videoPath, article.title, caption);

    state.totalPosted++;
    state.lastPosted = new Date().toISOString();
    notifyFn("✅ Video posted: " + article.title);

  } catch (err) {
    notifyFn("❌ Failed: " + err.message);
    console.error("[AutoVideo]", err.message);
  } finally {
    cleanTmp();
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
  setTimeout(function() { autoPost(function(m){ console.log("[AutoVideo]", m); }); }, 5 * 60 * 1000);
  state.interval = setInterval(function() { autoPost(function(m){ console.log("[AutoVideo]", m); }); }, 60 * 60 * 1000);
}

startAutoVideo();

// ── Command ───────────────────────────────────────────────────────────────────
module.exports.run = async function ({ api, args, event }) {
  const uid     = event.senderId;
  const ADMINS  = (process.env.ADMIN_IDS || process.env.ADMIN_ID || "").split(",").map(function(id){ return id.trim(); }).filter(Boolean);
  const isAdmin = ADMINS.length === 0 || ADMINS.includes(uid);

  if (!isAdmin) return api.send("⛔ Admins only!");

  const action = (args[0] || "status").toLowerCase();

  if (action === "status") {
    return api.send(
      "📺 AutoVideo Status\n━━━━━━━━━━━━━━\n" +
      "Status: "       + (state.interval ? "🟢 Running" : "🔴 Stopped") + "\n" +
      "Mode: Single image + text (fast)\n" +
      "Duration: 15 seconds\n" +
      "Render time: ~30 seconds\n" +
      "Total posted: " + state.totalPosted + "\n" +
      "Last posted: "  + (state.lastPosted ? new Date(state.lastPosted).toLocaleString() : "Never") + "\n" +
      "Pexels: "       + (process.env.PEXELS_API_KEY ? "✅" : "⚠️ Not set")
    );
  }
  if (action === "test") {
    api.send("🎬 Generating video...\n⏳ ~30 seconds...");
    await autoPost(function(msg) { api.send(msg); });
    return;
  }
  if (action === "on") {
    if (state.interval) return api.send("Already running!");
    startAutoVideo();
    return api.send("✅ AutoVideo started! Posts every hour.");
  }
  if (action === "off") {
    if (!state.interval) return api.send("Already stopped!");
    clearInterval(state.interval);
    state.interval = null;
    return api.send("🔴 Stopped.");
  }
  if (action === "reset") {
    state.postedUrls.clear();
    return api.send("🔄 History cleared!");
  }
  api.send("!autovideo status | test | on | off | reset");
};
