const axios = require("axios");

module.exports.config = {
  name: "lyrics",
  description: "Search for song lyrics",
  usage: "!lyrics [song name]",
  category: "utility",
};

module.exports.run = async function ({ api, args }) {
  const query = args.join(" ");
  if (!query) return api.send("🎵 Usage: !lyrics [song name]\nExample: !lyrics Shape of You");

  try {
    const res = await axios.get("https://api-library-kohi.onrender.com/api/lyrics", {
      params: { query }
    });
    const { title, artist, lyrics } = res.data.data;
    if (!lyrics) return api.send("❌ Lyrics not found.");

    // Split if too long (Messenger has 2000 char limit)
    const msg = `🎵 ${title}\n🎤 ${artist}\n━━━━━━━━━━━━━━\n${lyrics}`;
    if (msg.length > 1900) {
      api.send(`🎵 ${title}\n🎤 ${artist}\n━━━━━━━━━━━━━━\n${lyrics.substring(0, 1800)}...\n\n(lyrics truncated)`);
    } else {
      api.send(msg);
    }
  } catch (e) {
    api.send("❌ Lyrics API is currently down.");
  }
};
