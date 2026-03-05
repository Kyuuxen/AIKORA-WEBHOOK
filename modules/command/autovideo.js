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

const TMP_DIR  = "/tmp/autovideo";
const LOGO_URL = "https://i.ibb.co/nxXsv5M/file-000000000e907206aa347a1de1d8d10a.png";
const PAGE_NAME = "AIKORA NEWS";
const VIDEO_DUR = 60;
const SLIDE_DUR = 5;
const IMG_COUNT = Math.floor(VIDEO_DUR / SLIDE_DUR);

if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

// ── Safe text for ffmpeg drawtext (remove all special chars) ──────────────────
function safeText(str) {
  return String(str)
    .replace(/'/g, " ")
    .replace(/"/g, " ")
    .replace(/\\/g, " ")
    .replace(/:/g, "-")
    .replace(/\[/g, "(")
    .replace(/\]/g, ")")
    .replace(/[^\x20-\x7E]/g, "") // ASCII only
    .substring(0, 60)
    .trim();
}

// ── Download file ─────────────────────────────────────────────────────────────
async function downloadFile(url, dest) {
  const res = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 30000,
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  fs.writeFileSync(dest, Buffer.from(res.data));
}

// ── Convert ANY image format to proper 1280x720 jpg using ffmpeg ──────────────
async function toJpg(srcPath, destPath) {
  await execAsync(
    'ffmpeg -y -i "' + srcPath + '" ' +
    '-vf "scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,format=yuv420p" ' +
    '-q:v 2 "' + destPath + '"',
    { timeout: 30000 }
  );
  return destPath;
}

// ── Get images ────────────────────────────────────────────────────────────────
async function getImages(article, count) {
  const images = [];

  // Try Pexels first
  const pexelsKey = process.env.PEXELS_API_KEY;
  if (pexelsKey) {
    try {
      const query = article.title.split(" ").slice(0, 3).join(" ");
      const res   = await axios.get("https://api.pexels.com/v1/search", {
        params: { query: query, per_page: count + 2, orientation: "landscape" },
        headers: { Authorization: pexelsKey },
        timeout: 15000,
      });
      const photos = (res.data && res.data.photos) ? res.data.photos : [];
      for (let i = 0; i < photos.length && images.length < count; i++) {
        try {
          const rawPath = path.join(TMP_DIR, "raw" + i + ".jpg");
          const jpgPath = path.join(TMP_DIR, "img" + images.length + ".jpg");
          await downloadFile(photos[i].src.large, rawPath);
          await toJpg(rawPath, jpgPath);
          images.push(jpgPath);
        } catch(e) { console.log("[AutoVideo] Pexels img " + i + " failed:", e.message); }
      }
    } catch(e) { console.log("[AutoVideo] Pexels search failed:", e.message); }
  }

  // Try article image
  if (images.length < count && (article.image || article.urlToImage)) {
    try {
      const rawPath = path.join(TMP_DIR, "article_raw.jpg");
      const jpgPath = path.join(TMP_DIR, "img" + images.length + ".jpg");
      await downloadFile(article.image || article.urlToImage, rawPath);
      await toJpg(rawPath, jpgPath);
      images.push(jpgPath);
    } catch(e) { console.log("[AutoVideo] Article image failed:", e.message); }
  }

  // Fill remaining with solid color frames
  const colors = ["1a1a2e", "16213e", "0f3460", "1b1b2f", "0d0d0d", "1a0a0a", "0a1a0a"];
  while (images.length < count) {
    const color   = colors[images.length % colors.length];
    const jpgPath = path.join(TMP_DIR, "img" + images.length + ".jpg");
    await execAsync(
      'ffmpeg -y -f lavfi -i "color=c=0x' + color + ':size=1280x720:rate=25" ' +
      '-frames:v 1 "' + jpgPath + '"',
      { timeout: 15000 }
    );
    images.push(jpgPath);
  }

  return images;
}

// ── Get logo ──────────────────────────────────────────────────────────────────
async function getLogo() {
  const rawPath  = path.join(TMP_DIR, "logo_raw.png");
  const logoPath = path.join(TMP_DIR, "logo.png");
  if (fs.existsSync(logoPath)) return logoPath;
  try {
    await downloadFile(LOGO_URL, rawPath);
    // Resize logo to 120x120 max
    await execAsync(
      'ffmpeg -y -i "' + rawPath + '" -vf "scale=120:120:force_original_aspect_ratio=decrease" "' + logoPath + '"',
      { timeout: 15000 }
    );
    return logoPath;
  } catch(e) {
    console.log("[AutoVideo] Logo failed:", e.message);
    return null;
  }
}

// ── Get music ─────────────────────────────────────────────────────────────────
async function getMusic() {
  const musicPath = path.join(TMP_DIR, "music.mp3");
  const tracks    = [
    "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
    "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3",
    "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3",
  ];
  try {
    await downloadFile(tracks[state.totalPosted % tracks.length], musicPath);
    return musicPath;
  } catch(e) {
    console.log("[AutoVideo] Music failed:", e.message);
    return null;
  }
}

// ── Generate video ────────────────────────────────────────────────────────────
async function generateVideo(article, images, musicPath, logoPath) {
  const outPath  = path.join(TMP_DIR, "output.mp4");
  if (fs.existsSync(outPath)) fs.unlinkSync(outPath);

  const headline = safeText(article.title);
  const source   = safeText((article.source && article.source.name) ? article.source.name : "NEWS").toUpperCase();
  const dateStr  = safeText(new Date().toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" }));

  // Step 1: Create slideshow from images (no filters, just concat)
  const listFile = path.join(TMP_DIR, "imglist.txt");
  let listContent = "";
  for (let i = 0; i < images.length; i++) {
    listContent += "file '" + images[i] + "'\n";
    listContent += "duration " + SLIDE_DUR + "\n";
  }
  // Add last image again (required by ffmpeg concat demuxer)
  listContent += "file '" + images[images.length - 1] + "'\n";
  fs.writeFileSync(listFile, listContent);

  const slideshowPath = path.join(TMP_DIR, "slideshow.mp4");

  // Generate clean slideshow
  await execAsync(
    'ffmpeg -y -f concat -safe 0 -i "' + listFile + '" ' +
    '-vf "fps=25,format=yuv420p" ' +
    '-c:v libx264 -preset fast -crf 23 ' +
    '-t ' + VIDEO_DUR + ' ' +
    '"' + slideshowPath + '"',
    { timeout: 180000 }
  );

  console.log("[AutoVideo] Slideshow created");

  // Step 2: Add overlays (logo + lower third + text) to slideshow
  let filterParts = [];
  let inputs      = '"' + slideshowPath + '"';
  let inputIdx    = 1;

  // Start with base video
  let currentStream = "0:v";

  // Add logo overlay if available
  if (logoPath && fs.existsSync(logoPath)) {
    inputs += ' -i "' + logoPath + '"';
    filterParts.push(
      "[" + currentStream + "][" + inputIdx + ":v]overlay=20:20:format=auto[afterlogo]"
    );
    currentStream = "afterlogo";
    inputIdx++;
  }

  // Add GMA-style lower third bar + text
  const drawFilters = [
    // Dark bar
    "drawbox=x=0:y=625:w=1280:h=95:color=black@0.85:t=fill",
    // Red accent line
    "drawbox=x=0:y=623:w=1280:h=4:color=red:t=fill",
    // Page name
    "drawtext=text='" + PAGE_NAME + "':fontcolor=red:fontsize=20:x=20:y=635",
    // Date
    "drawtext=text='" + dateStr + "':fontcolor=white@0.7:fontsize=16:x=w-tw-20:y=635",
    // Headline
    "drawtext=text='" + headline + "':fontcolor=white:fontsize=24:x=20:y=660",
    // Source
    "drawtext=text='" + source + "':fontcolor=yellow:fontsize=18:x=w-tw-20:y=663",
  ].join(",");

  filterParts.push("[" + currentStream + "]" + drawFilters + "[finalout]");

  const filterComplex = filterParts.join("; ");

  // Step 3: Combine with music
  let finalCmd = 'ffmpeg -y -i ' + inputs;

  if (musicPath && fs.existsSync(musicPath)) {
    finalCmd += ' -i "' + musicPath + '"';
    const audioIdx = inputIdx;
    finalCmd += ' -filter_complex "' + filterComplex + '"';
    finalCmd += ' -map "[finalout]"';
    finalCmd += ' -map ' + audioIdx + ':a';
    finalCmd += ' -c:v libx264 -preset fast -crf 23';
    finalCmd += ' -c:a aac -b:a 128k';
    finalCmd += ' -filter:a "volume=0.25"';
    finalCmd += ' -t ' + VIDEO_DUR;
    finalCmd += ' -shortest';
  } else {
    finalCmd += ' -filter_complex "' + filterComplex + '"';
    finalCmd += ' -map "[finalout]"';
    finalCmd += ' -c:v libx264 -preset fast -crf 23';
    finalCmd += ' -t ' + VIDEO_DUR;
    finalCmd += ' -an';
  }

  finalCmd += ' "' + outPath + '"';

  console.log("[AutoVideo] Rendering final video...");
  await execAsync(finalCmd, { timeout: 300000, maxBuffer: 50 * 1024 * 1024 });

  if (!fs.existsSync(outPath)) throw new Error("ffmpeg failed — output not created");
  const size = (fs.statSync(outPath).size / 1024 / 1024).toFixed(1);
  console.log("[AutoVideo] Final video: " + size + "MB");
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
        title:       item.title,
        description: item.description ? item.description.replace(/<[^>]*>/g,"").substring(0,200) : "",
        url:         item.link,
        image:       (item.enclosure && item.enclosure.link) ? item.enclosure.link : (item.thumbnail||null),
        source:      { name: "BBC News" },
      };
    });
  } catch(e) { return []; }
}

// ── Generate caption ──────────────────────────────────────────────────────────
async function generateCaption(article) {
  try {
    const res = await axios.get("https://api-library-kohi.onrender.com/api/copilot", {
      params: { prompt: "Write a short engaging Facebook post caption for this news video (2-3 sentences, no hashtags, no asterisks, no markdown):\n\nHeadline: " + article.title },
      timeout: 25000,
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

// ── Main auto post ────────────────────────────────────────────────────────────
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
    notifyFn("📰 Generating: " + article.title + "\n⏳ Takes 3-5 minutes...");

    const [images, musicPath, logoPath] = await Promise.all([
      getImages(article, IMG_COUNT),
      getMusic(),
      getLogo(),
    ]);

    notifyFn("🎬 Rendering video...");
    const videoPath = await generateVideo(article, images, musicPath, logoPath);
    const caption   = await generateCaption(article);

    notifyFn("📤 Uploading to Facebook...");
    await uploadToFacebook(videoPath, article.title, caption);

    state.totalPosted++;
    state.lastPosted = new Date().toISOString();
    notifyFn("✅ Video posted: " + article.title);

  } catch (err) {
    notifyFn("❌ Failed: " + err.message);
    console.error("[AutoVideo] Error:", err.message);
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
  console.log("[AutoVideo] Starting GMA-style news video generator...");
  setTimeout(function() { autoPost(function(msg) { console.log("[AutoVideo]", msg); }); }, 5 * 60 * 1000);
  state.interval = setInterval(function() { autoPost(function(msg) { console.log("[AutoVideo]", msg); }); }, 60 * 60 * 1000);
}

startAutoVideo();

// ── Command ───────────────────────────────────────────────────────────────────
module.exports.run = async function ({ api, args, event }) {
  const uid     = event.senderId;
  const ADMINS  = (process.env.ADMIN_IDS || process.env.ADMIN_ID || "").split(",").map(function(id){ return id.trim(); }).filter(Boolean);
  const isAdmin = ADMINS.length === 0 || ADMINS.includes(uid);

  if (!isAdmin) return api.send("⛔ This command is for admins only!");

  const action = (args[0] || "status").toLowerCase();

  if (action === "status") {
    return api.send(
      "📺 AutoVideo (GMA Style)\n━━━━━━━━━━━━━━\n" +
      "Status: "       + (state.interval ? "🟢 Running" : "🔴 Stopped") + "\n" +
      "Total posted: " + state.totalPosted + "\n" +
      "Last posted: "  + (state.lastPosted ? new Date(state.lastPosted).toLocaleString() : "Never") + "\n" +
      "Interval: Every 1 hour\n" +
      "Duration: 60 seconds\n" +
      "Pexels: "       + (process.env.PEXELS_API_KEY ? "✅ Connected" : "⚠️ Not set")
    );
  }
  if (action === "test") {
    api.send("🎬 Generating GMA-style video...\n⏳ Takes 3-5 minutes...");
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
    state.postedUrls.clear();
    return api.send("🔄 History cleared!");
  }
  api.send("!autovideo status | test | on | off | reset");
};
