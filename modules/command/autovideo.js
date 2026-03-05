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

// ── Global state ──────────────────────────────────────────────────────────────
if (!global.autoVideoState) {
  global.autoVideoState = {
    postedUrls:  new Set(),
    totalPosted: 0,
    lastPosted:  null,
    interval:    null,
    isPosting:   false,
    topicIndex:  0,
  };
}
const state = global.autoVideoState;

const TMP_DIR = "/tmp/autovideo";
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

// ── Config ────────────────────────────────────────────────────────────────────
const LOGO_URL    = "https://i.ibb.co/nxXsv5M/file-000000000e907206aa347a1de1d8d10a.png";
const VIDEO_DUR   = 60;   // seconds
const SLIDE_DUR   = 5;    // seconds per image
const IMG_COUNT   = Math.floor(VIDEO_DUR / SLIDE_DUR); // 12 images
const MUSIC_URL   = "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3"; // royalty free
const PAGE_NAME   = "AIKORA NEWS";

// ── Topics ────────────────────────────────────────────────────────────────────
const TOPICS = [
  "Philippines news today", "world news breaking", "Philippines latest news",
  "Asia news today", "technology news today", "sports news highlights",
  "business news today", "science news today", "health news today", "viral news today",
];

// ── Fetch news articles ───────────────────────────────────────────────────────
async function fetchNews() {
  try {
    const res = await axios.get("https://gnews.io/api/v4/top-headlines", {
      params: { lang: "en", country: "ph", max: 10, apikey: process.env.GNEWS_API_KEY || "demo" },
      timeout: 15000,
    });
    return (res.data && res.data.articles) ? res.data.articles : [];
  } catch (e) {}
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
  } catch (e) { return []; }
}

// ── Pick fresh article ────────────────────────────────────────────────────────
function pickFresh(articles) {
  for (let i = 0; i < articles.length; i++) {
    if (articles[i].url && !state.postedUrls.has(articles[i].url)) return articles[i];
  }
  return null;
}

// ── Download file to disk ─────────────────────────────────────────────────────
async function downloadFile(url, dest) {
  const res = await axios.get(url, { responseType: "arraybuffer", timeout: 30000 });
  fs.writeFileSync(dest, Buffer.from(res.data));
}

// ── Get images for slideshow ──────────────────────────────────────────────────
// Uses Pexels API or article images
async function getImages(article, count) {
  const images = [];
  const tmpImages = [];

  // Try article image first
  if (article.image || article.urlToImage) {
    try {
      const imgUrl  = article.image || article.urlToImage;
      const imgPath = path.join(TMP_DIR, "img0.jpg");
      await downloadFile(imgUrl, imgPath);
      images.push(imgPath);
      tmpImages.push(imgPath);
    } catch(e) {}
  }

  // Fill remaining slots with Pexels images based on topic keywords
  const pexelsKey = process.env.PEXELS_API_KEY;
  if (pexelsKey && images.length < count) {
    try {
      const query   = article.title.split(" ").slice(0,3).join(" ");
      const res     = await axios.get("https://api.pexels.com/v1/search", {
        params: { query: query, per_page: count, orientation: "landscape" },
        headers: { Authorization: pexelsKey },
        timeout: 15000,
      });
      const photos  = (res.data && res.data.photos) ? res.data.photos : [];
      for (let i = 0; i < photos.length && images.length < count; i++) {
        try {
          const imgPath = path.join(TMP_DIR, "img" + images.length + ".jpg");
          await downloadFile(photos[i].src.large, imgPath);
          images.push(imgPath);
          tmpImages.push(imgPath);
        } catch(e) {}
      }
    } catch(e) { console.log("[AutoVideo] Pexels failed:", e.message); }
  }

  // Fallback: generate solid color images with ffmpeg if we don't have enough
  while (images.length < count) {
    const colors  = ["#1a1a2e","#16213e","#0f3460","#1a1a2e","#0d0d0d"];
    const color   = colors[images.length % colors.length];
    const imgPath = path.join(TMP_DIR, "img" + images.length + ".jpg");
    await execAsync(
      'ffmpeg -f lavfi -i "color=c=' + color.replace("#","") + ':size=1280x720:rate=1" -frames:v 1 ' + imgPath + ' -y',
      { timeout: 15000 }
    );
    images.push(imgPath);
    tmpImages.push(imgPath);
  }

  return images;
}

// ── Download background music ─────────────────────────────────────────────────
async function getMusic() {
  const musicPath = path.join(TMP_DIR, "music.mp3");
  // Use a different royalty-free track each time
  const tracks = [
    "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
    "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3",
    "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3",
  ];
  const track = tracks[state.totalPosted % tracks.length];
  try {
    await downloadFile(track, musicPath);
    return musicPath;
  } catch(e) {
    console.log("[AutoVideo] Music download failed:", e.message);
    return null;
  }
}

// ── Download logo ─────────────────────────────────────────────────────────────
async function getLogo() {
  const logoPath = path.join(TMP_DIR, "logo.png");
  if (fs.existsSync(logoPath)) return logoPath; // reuse if already downloaded
  try {
    await downloadFile(LOGO_URL, logoPath);
    return logoPath;
  } catch(e) {
    console.log("[AutoVideo] Logo download failed:", e.message);
    return null;
  }
}

// ── Generate GMA-style news video with ffmpeg ─────────────────────────────────
async function generateVideo(article, images, musicPath, logoPath) {
  const outPath   = path.join(TMP_DIR, "output.mp4");
  if (fs.existsSync(outPath)) fs.unlinkSync(outPath);

  const headline  = article.title.replace(/'/g, "").replace(/"/g,"").replace(/:/g,"-").substring(0, 80);
  const source    = ((article.source && article.source.name) ? article.source.name : "NEWS").toUpperCase();
  const dateStr   = new Date().toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" });

  // Build ffmpeg input list (each image shown for SLIDE_DUR seconds)
  let inputs      = "";
  let filterParts = [];
  let scaleOverlay = [];

  // Scale and prepare each image
  for (let i = 0; i < images.length; i++) {
    inputs += ' -loop 1 -t ' + SLIDE_DUR + ' -i "' + images[i] + '"';
    filterParts.push('[' + i + ':v]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,setsar=1[v' + i + ']');
  }

  // Concatenate all image clips
  const concatIn  = images.map(function(_,i){ return '[v'+i+']'; }).join('');
  filterParts.push(concatIn + 'concat=n=' + images.length + ':v=1:a=0[base]');

  // Add logo watermark (top left, scaled to 120px wide)
  if (logoPath && fs.existsSync(logoPath)) {
    filterParts.push('[base][' + images.length + ':v]overlay=20:20:format=auto[withlogo]');
    inputs += ' -i "' + logoPath + '"';
  } else {
    filterParts.push('[base]copy[withlogo]');
  }

  // GMA-style lower third bar:
  // Dark semi-transparent bar at bottom + white headline text + red accent + source tag
  const drawtext = [
    // Dark bar background
    "drawbox=x=0:y=620:w=1280:h=100:color=black@0.85:t=fill",
    // Red accent line
    "drawbox=x=0:y=618:w=1280:h=4:color=red@1:t=fill",
    // Page name top-left of bar (small, red)
    "drawtext=text='" + PAGE_NAME + "':fontcolor=red:fontsize=18:x=20:y=630:fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    // Date top-right of bar
    "drawtext=text='" + dateStr + "':fontcolor=white@0.7:fontsize=16:x=w-tw-20:y=630:fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    // Main headline (large white text)
    "drawtext=text='" + headline + "':fontcolor=white:fontsize=26:x=20:y=655:fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:line_spacing=4",
    // Source tag (right side)
    "drawtext=text='" + source + "':fontcolor=yellow:fontsize=18:x=w-tw-20:y=658:fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  ].join(",");

  filterParts.push('[withlogo]' + drawtext + '[final]');

  const filterComplex = filterParts.join('; ');

  // Build full ffmpeg command
  let cmd = 'ffmpeg -y' + inputs;

  if (musicPath && fs.existsSync(musicPath)) {
    cmd += ' -i "' + musicPath + '"';
    const audioIndex = logoPath ? images.length + 2 : images.length + 1;
    cmd += ' -filter_complex "' + filterComplex + '"';
    cmd += ' -map "[final]"';
    cmd += ' -map ' + audioIndex + ':a';
    cmd += ' -c:v libx264 -preset fast -crf 23';
    cmd += ' -c:a aac -b:a 128k';
    cmd += ' -t ' + VIDEO_DUR;
    cmd += ' -af "volume=0.3,afade=t=out:st=' + (VIDEO_DUR-3) + ':d=3"'; // fade out music
    cmd += ' -shortest';
  } else {
    cmd += ' -filter_complex "' + filterComplex + '"';
    cmd += ' -map "[final]"';
    cmd += ' -c:v libx264 -preset fast -crf 23';
    cmd += ' -t ' + VIDEO_DUR;
    cmd += ' -an'; // no audio
  }

  cmd += ' "' + outPath + '"';

  console.log("[AutoVideo] Running ffmpeg...");
  await execAsync(cmd, { timeout: 300000, maxBuffer: 50 * 1024 * 1024 }); // 5 min timeout

  if (!fs.existsSync(outPath)) throw new Error("ffmpeg failed — output not created");
  const size = (fs.statSync(outPath).size / 1024 / 1024).toFixed(1);
  console.log("[AutoVideo] Video generated: " + size + "MB");
  return outPath;
}

// ── Upload video to Facebook ──────────────────────────────────────────────────
async function uploadToFacebook(filePath, title, caption) {
  const pageId    = process.env.PAGE_ID;
  const feedToken = process.env.PAGE_FEED_TOKEN;
  if (!pageId || !feedToken) throw new Error("PAGE_ID or PAGE_FEED_TOKEN not set.");

  const fileSize  = fs.statSync(filePath).size;
  console.log("[AutoVideo] Uploading " + (fileSize/1024/1024).toFixed(1) + "MB to Facebook...");

  // Init
  const initRes = await axios.post(
    "https://graph-video.facebook.com/v19.0/" + pageId + "/videos", null,
    { params: { upload_phase: "start", file_size: fileSize, access_token: feedToken }, timeout: 30000 }
  );
  const sessionId = initRes.data.upload_session_id;

  // Upload chunks
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

  // Finish
  await axios.post(
    "https://graph-video.facebook.com/v19.0/" + pageId + "/videos", null,
    {
      params: {
        upload_phase: "finish", upload_session_id: sessionId,
        title: title.substring(0,100), description: caption.substring(0,500),
        access_token: feedToken,
      },
      timeout: 60000,
    }
  );
  console.log("[AutoVideo] Upload complete!");
}

// ── Cleanup ───────────────────────────────────────────────────────────────────
function cleanTmp() {
  try {
    fs.readdirSync(TMP_DIR).forEach(function(f) {
      if (f !== "logo.png") { // keep logo cached
        try { fs.unlinkSync(path.join(TMP_DIR, f)); } catch(e) {}
      }
    });
  } catch(e) {}
}

// ── Generate AI caption ───────────────────────────────────────────────────────
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

// ── Main auto post ────────────────────────────────────────────────────────────
async function autoPost(notifyFn) {
  if (state.isPosting) { notifyFn("⏳ Still generating, skipping..."); return; }
  state.isPosting = true;

  try {
    // Fetch news
    const articles = await fetchNews();
    if (!articles.length) { notifyFn("⚠️ No articles found."); return; }

    let article = pickFresh(articles);
    if (!article) {
      state.postedUrls.clear();
      article = articles[0];
    }

    state.postedUrls.add(article.url);
    notifyFn("📰 Generating video for: " + article.title + "\n⏳ This takes 2-4 minutes...");

    // Prepare assets
    const [images, musicPath, logoPath] = await Promise.all([
      getImages(article, IMG_COUNT),
      getMusic(),
      getLogo(),
    ]);

    notifyFn("🎬 Rendering GMA-style video with ffmpeg...");
    const videoPath = await generateVideo(article, images, musicPath, logoPath);

    const caption = await generateCaption(article);

    notifyFn("📤 Uploading to Facebook...");
    await uploadToFacebook(videoPath, article.title, caption);

    state.totalPosted++;
    state.lastPosted = new Date().toISOString();
    notifyFn("✅ News video posted: " + article.title);

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
    console.log("[AutoVideo] Not started: Missing PAGE_ID or PAGE_FEED_TOKEN.");
    return;
  }
  console.log("[AutoVideo] Starting GMA-style news video generator...");
  setTimeout(function() { autoPost(function(msg) { console.log("[AutoVideo]", msg); }); }, 5 * 60 * 1000);
  state.interval = setInterval(function() { autoPost(function(msg) { console.log("[AutoVideo]", msg); }); }, 60 * 60 * 1000); // every 1 hour
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
      "Status: "        + (state.interval ? "🟢 Running" : "🔴 Stopped") + "\n" +
      "Total posted: "  + state.totalPosted + "\n" +
      "Last posted: "   + (state.lastPosted ? new Date(state.lastPosted).toLocaleString() : "Never") + "\n" +
      "Interval: Every 1 hour\n" +
      "Video length: 60 seconds\n" +
      "Style: GMA News lower third\n" +
      "Logo: " + (LOGO_URL ? "✅ Set" : "❌ Not set") + "\n" +
      "Music: ✅ Royalty free\n" +
      "Pexels: " + (process.env.PEXELS_API_KEY ? "✅ Connected" : "⚠️ Not set (using article images)")
    );
  }
  if (action === "test") {
    api.send("🎬 Generating GMA-style news video...\n⏳ Takes 2-4 minutes, please wait...");
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
    return api.send("🔴 AutoVideo stopped.");
  }
  if (action === "reset") {
    state.postedUrls.clear();
    return api.send("🔄 History cleared!");
  }
  api.send("!autovideo status | test | on | off | reset");
};
