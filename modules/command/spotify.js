const axios = require('axios');

module.exports.config = {
  name: "spotify",
  version: "1.0.0",
  author: {
    name: "ChatGPT",
    contact: "OPENAI",
  },
  role: 0,
  isLeader: true,
  shortDescription: {
    vi: "Tải xuống spotify",
    en: "Download spotify tracks",
  },
  longDescription: {
    vi: "Lệnh này tải về danh sách các file từ Spotify",
    en: "This command downloads a list of tracks from Spotify",
  },
  category: "download",
  cooldowns: 5,
  dependencies: {
    axios: "^0.21.1",
  },
  permission: {
    description:
      "The permission required to execute the command. You can name it whatever you like, but its value SHOULD NOT BE EMPTY.",
  },
};

module.exports.run = async function ({ api, event, args }) {
  const send = api.sendMessage
    ? (...args) => api.sendMessage(...args)
    : (...args) => api.send(...args);

  if (!args || !args.length) {
    return send(
      "❗️ Usage: !download https://open.spotify.com/playlist/.... or !download <song link>",
      event.threadID,
      event.messageID
    );
  }

  const _url = args.join(" ").trim();
  if (!_url.startsWith("http") && !_url.startsWith("https")) {
    return send(
      "❌ Please provide a valid Spotify URL.",
      event.threadID,
      event.messageID
    );
  }

  let spotifyUrl;
  try {
    spotifyUrl = new URL(_url);
  } catch (_) {
    return send(
      "❌ Invalid Spotify URL.",
      event.threadID,
      event.messageID
    );
  }

  const query = new URLSearchParams({
    url: spotifyUrl.toString(),
  });

  const endpoint = `https://doux.gleeze.com/downloader/spdlv2?${query.toString()}`;

  try {
    const { data } = await axios.get(endpoint, {
      headers: {
        "User-Agent": "Mozilla/5.0",
      },
    });

    const links = Array.isArray(data) ? data : [data];
    if (!links.length) {
      throw new Error("No data received.");
    }

    const formatted = links.map((link, i) => `${i + 1}) ${link}`).join("\n");
    return send(formatted, event.threadID, event.messageID);
  } catch (err) {
    console.error(err);
    const errorMsg =
      err.response && err.response.data
        ? typeof err.response.data === "string"
          ? err.response.data
          : JSON.stringify(err.response.data)
        : err.message || "An unknown error occurred.";
    return send(`❌ ${errorMsg}`, event.threadID, event.messageID);
  }
};