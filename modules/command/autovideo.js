const axios     = require("axios");
const fs        = require("fs");
const path      = require("path");
const { promisify } = require("util");
const { exec }      = require("child_process");
const execAsync     = promisify(exec);

module.exports.config = {
  name:        "autovideo",
  description: "Auto generate GMA-style news slideshow videos and post to Facebook",
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

const TMP_DIR   = "/tmp/autovideo";
const LOGO_URL  = "https://i.ibb.co/nxXsv5M/file-000000000e907206aa347a1de1d8d10a.png";
const PAGE_NAME = "AIKORA NEWS";

// ── Reduced settings for speed ────────────────────────────────────────────────
const WIDTH     = 854;   // 480p width (faster than 720p)
const HEIGHT    = 480;   // 480p height
const FPS       = 15;    // lower fps = faster render
const VIDEO_DUR = 30;    // 30 seconds (was 60 - half the render time)
const SLIDE_DUR = 5;     // 5 seconds per image
const IMG_COUNT = 6;     // 6 images only

if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

// ── Safe text for ffmpeg drawtext ─────────────────────────────────────────────
function safeText(str) {
  return String(str)
    .replace(/['"\\:[\]]/g, " ")
    .replace(/[^\x20-\x7E]/g, "")
    .substring(0, 55)
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

// ── Convert image to proper jpg at target resolution ──────────────────────────
async function toJpg(srcPath, destPath) {
  await execAsync(
    'ffmpeg -y -i "' + srcPath + '" ' +
    '-vf "scale=' + WIDTH + ':' + HEIGHT + ':force_original_aspect_ratio=increase,' +
    'crop=' + WIDTH + ':' + HEIGHT + ',format=yuv420p" ' +
    '-q:v 3 "' + destPath + '"',
    { timeout: 20000 }
  );
}

// ── Get images ────────────────────────────────────────────────────────────────
async function getImages(article) {
  const images = [];

  // Try Pexels
  const pexelsKey = process.env.PEXELS_API_KEY;
  if (pexelsKey) {
    try {
      const query = article.title.split(" ").slice(0, 3).join(" ");
      const res   = await axios.get("https://api.pexels.com/v1/search", {
        params: { query: query, per_page: IMG_COUNT + 2, orientation: "landscape" },
        headers: { Authorization: pexelsKey },
        timeout: 15000,
      });
      const photos = (res.data && res.data.photos) ? res.data.photos : [];
      for (let i = 0; i < photos.length && images.length < IMG_COUNT; i++) {
        try {
          const raw  = path.join(TMP_DIR, "raw" + i + ".jpg");
          const jpg  = path.join(TMP_DIR, "img" + images.length + ".jpg");
          await downloadFile(photos[i].src.medium, raw); // medium size = faster download
          await toJpg(raw, jpg);
          images.push(jpg);
        } catch(e) {}
      }
    } catch(e) { console.log("[AutoVideo] Pexels:", e.message); }
  }

  // Try article image
  if (images.length < IMG_COUNT && (article.image || article.urlToImage)) {
    try {
      const raw = path.join(TMP_DIR, "article_raw.jpg");
      const jpg = path.join(TMP_DIR, "img" + images.length + ".jpg");
      await downloadFile(article.image || article.urlToImage, raw);
      await toJpg(raw, jpg);
      images.push(jpg);
    } catch(e) {}
  }

  // Fill with colored frames
  const colors = ["1a1a2e","16213e","0f3460","1b1b2f","0d0d0d","1a0a0a"];
  while (images.length < IMG_COUNT) {
    const jpg = path.join(TMP_DIR, "img" + images.length + ".jpg");
    await execAsync(
      'ffmpeg -y -f lavfi -i "color=c=0x' + colors[images.length % colors.length] +
      ':size=' + WIDTH + 'x' + HEIGHT + ':rate=1" -frames:v 1 "' + jpg + '"',
      { timeout: 15000 }
    );
    images.push(jpg);
  }

  return images;
}

// ── Get logo ──────────────────────────────────────────────────────────────────
async function getLogo() {
  const logoPath = path.join(TMP_DIR, "logo.png");
  if (fs.existsSync(logoPath)) return logoPath;
  try {
    const raw = path.join(TMP_DIR, "logo_raw.png");
    await downloadFile(LOGO_URL, raw);
    await execAsync(
      'ffmpeg -y -i "' + raw + '" -vf "scale=80:80:force_original_aspect_ratio=decrease" "' + logoPath + '"',
      { timeout: 15000 }
    );
    return logoPath;
  } catch(e) { return null; }
}

// ── Get music ─────────────────────────────────────────────────────────────────
async function getMusic() {
  const musicPath = path.join(TMP_DIR, "music.mp3");
  try {
    const tracks = [
      "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
      "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3",
    ];
    await downloadFile(tracks[state.totalPosted % tracks.length], musicPath);
    return musicPath;
  } catch(e) { return null; }
}

// ── Generate video ────────────────────────────────────────────────────────────
async function generateVideo(article, images, musicPath, logoPath) {
  const outPath = path.join(TMP_DIR, "output.mp4");
  if (fs.existsSync(outPath)) fs.unlinkSync(outPath);

  const headline = safeText(article.title);
  const source   = safeText((article.source && article.source.name) ? article.source.name : "NEWS").toUpperCase();
  const dateStr  = safeText(new Date().toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" }));

  // Build image list file for concat
  const listFile = path.join(TMP_DIR, "list.txt");
  let listTxt    = "";
  for (let i = 0; i < images.length; i++) {
    listTxt += "file '" + images[i] + "'\nduration " + SLIDE_DUR + "\n";
  }
  listTxt += "file '" + images[images.length-1] + "'\n";
  fs.writeFileSync(listFile, listTxt);

  // Slideshow path
  const slidePath = path.join(TMP_DIR, "slide.mp4");

  // Step 1: Fast slideshow
  await execAsync(
    'ffmpeg -y -f concat -safe 0 -i "' + listFile + '" ' +
    '-vf "fps=' + FPS + ',format=yuv420p" ' +
    '-c:v libx264 -preset ultrafast -crf 30 ' +
    '-t ' + VIDEO_DUR + ' ' +
    '"' + slidePath + '"',
    { timeout: 120000 }
  );
  console.log("[AutoVideo] Slideshow done");

  // Step 2: Add overlays
  const barY   = HEIGHT - 95;
  const lineY  = HEIGHT - 97;
  const text1Y = HEIGHT - 85;
  const text2Y = HEIGHT - 60;

  const drawFilters = [
    "drawbox=x=0:y=" + barY  + ":w=" + WIDTH + ":h=95:color=black@0.85:t=fill",
    "drawbox=x=0:y=" + lineY + ":w=" + WIDTH + ":h=3:color=red:t=fill",
    "drawtext=text='" + PAGE_NAME + "':fontcolor=red:fontsize=15:x=12:y=" + text1Y,
    "drawtext=text='" + dateStr   + "':fontcolor=white@0.6:fontsize=13:x=w-tw-12:y=" + text1Y,
    "drawtext=text='" + headline  + "':fontcolor=white:fontsize=19:x=12:y=" + text2Y,
    "drawtext=text='" + source    + "':fontcolor=yellow:fontsize=14:x=w-tw-12:y=" + text2Y,
  ].join(",");

  // Build inputs
  let inputs    = '"' + slidePath + '"';
  let inputIdx  = 1;
  let baseStream = "0:v";
  let filters   = [];

  if (logoPath && fs.existsSync(logoPath)) {
    inputs += ' -i "' + logoPath + '"';
    filters.push("[" + baseStream + "][" + inputIdx + ":v]overlay=15:15:format=auto[logoout]");
    baseStream = "logoout";
    inputIdx++;
  }

  filters.push("[" + baseStream + "]" + drawFilters + "[final]");

  const fc = filters.join("; ");

  let cmd = 'ffmpeg -y -i ' + inputs;

  if (musicPath && fs.existsSync(musicPath)) {
    cmd += ' -i "' + musicPath + '"';
    cmd += ' -filter_complex "' + fc + '"';
    cmd += ' -map "[final]" -map ' + inputIdx + ':a';
    cmd += ' -c:v libx264 -preset ultrafast -crf 30';
    cmd += ' -c:a aac -b:a 96k -filter:a "volume=0.25"';
    cmd += ' -t ' + VIDEO_DUR + ' -shortest';
  } else {
    cmd += ' -filter_complex "' + fc + '"';
    cmd += ' -map "[final]"';
    cmd += ' -c:v libx264 -preset ultrafast -crf 30';
    cmd += ' -t ' + VIDEO_DUR + ' -an';
  }

  cmd += ' "' + outPath + '"';

  console.log("[AutoVideo] Rendering final...");
  await execAsync(cmd, { timeout: 180000, maxBuffer: 50 * 1024 * 1024 });

  if (!fs.existsSync(outPath)) throw new Error("Output file not created");
  console.log("[AutoVideo] Done: " + (fs.statSync(outPath).size/1024/1024).toFixed(1) + "MB");
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

  const CHUNK  = 5 * 1024 * 1024;
  const buffer = fs.readFileSync(filePath);
  let offset   = 0;
  while (offset < fileSize) {
    const chunk    = buffer.slice(offset, Math.min(offset + CHUNK, fileSize));
    const chunkRes = await axios.post(
      "https://graph-video.facebook.com/v19.0/" + pageId + "/videos", chunk,
      {
        params: { upload_phase: "transfer", upload_session_id: sessionId, start_offset: offset, access_token: feedToken },
        headers: { "Content-Type": "application/octet-stream" },
        timeout: 120000, maxBodyLength: Infinity, maxContentLength: Infinity,
      }
    );
    offset = parseInt(chunkRes.data.start_offset) || (offset + chunk.length);
    console.log("[AutoVideo] Upload: " + Math.round((offset/fileSize)*100) + "%");
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
        description: item.description ? item.description.replace(/<[^>]*>/g,"").substring(0,200) : "",
        url:    item.link,
        image:  (item.enclosure && item.enclosure.link) ? item.enclosure.link : (item.thumbnail||null),
        source: { name: "BBC News" },
      };
    });
  } catch(e) { return []; }
}

// ── Generate caption ──────────────────────────────────────────────────────────
async function generateCaption(article) {
  try {
    const res = await axios.get("https://api-library-kohi.onrender.com/api/copilot", {
      params: { prompt: "Write a short Facebook post caption for this news video (2-3 sentences, no hashtags, no asterisks):\n\nHeadline: " + article.title },
      timeout: 20000,
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
      if (f !== "logo.png") {
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
    notifyFn("📰 Generating: " + article.title + "\n⏳ Takes ~2 minutes...");

    const [images, musicPath, logoPath] = await Promise.all([
      getImages(article),
      getMusic(),
      getLogo(),
    ]);

    notifyFn("🎬 Rendering...");
    const videoPath = await generateVideo(article, images, musicPath, logoPath);
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
      "Resolution: 480p (fast mode)\n" +
      "Duration: 30 seconds\n" +
      "Total posted: " + state.totalPosted + "\n" +
      "Last posted: "  + (state.lastPosted ? new Date(state.lastPosted).toLocaleString() : "Never") + "\n" +
      "Pexels: "       + (process.env.PEXELS_API_KEY ? "✅" : "⚠️ Not set")
    );
  }
  if (action === "test") {
    api.send("🎬 Generating video...\n⏳ ~2 minutes, please wait...");
    await autoPost(function(msg) { api.send(msg); });
    return;
  }
  if (action === "on") {
    if (state.interval) return api.send("Already running!");
    startAutoVideo();
    return api.send("✅ AutoVideo started! Posts every 1 hour.");
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
