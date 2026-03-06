const axios = require("axios");

module.exports.config = {
  name: "spotify",
  description: "Download Spotify tracks or playlists using a public API",
  usage: "!spotify <Spotify URL>",
  category: "general",
};

module.exports.run = async function ({ api, args, event }) {
  const input = args.join(" ").trim();

  if (!input) return api.send("❗️ Usage: !spotify <Spotify URL>");

  let url;
  try {
    url = new URL(input);
  } catch (_) {
    return api.send("❌ Please provide a valid URL");
  }

  try {
    const res = await axios.get("https://doux.gleeze.com/downloader/spdlv2", {
      params: { url: url.href }
    });
    const data = res.data;

    let message = "🎵 Download ready:\n";

    if (data.url) {
      message += `${data.url}`;
    } else if (Array.isArray(data.data)) {
      message += data.data.join("\n");
    } else {
      message += JSON.stringify(data, null, 2);
    }

    await api.send(message);
  } catch (err) {
    console.error(err);
    api.send("❌ Something went wrong. Please try again.");
  }
};