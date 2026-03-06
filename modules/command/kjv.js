const axios = require("axios");

module.exports.config = {
  name: "kjv",
  description: "Retrieve a verse from the King James Version",
  usage: "!kjv [book chapter:verse]",
  category: "general",
};

module.exports.run = async function ({ api, args, event }) {
  const input = args.join(" ").trim();
  if (!input) return api.send("Usage: !kjv [book chapter:verse]");

  const encodedInput = encodeURIComponent(input);
  const url = `https://bible-api.com/${encodedInput}?version=KJV`;

  try {
    const response = await axios.get(url);
    const data = response.data;
    if (data.error) {
      return api.send(`❌ ${data.error}`);
    }
    const verseText = data.text.replace(/\s+/g, " ").trim();
    const reference = data.reference || "Unknown Reference";
    const message = `${reference}\n📖 ${verseText}`;
    api.send(message);
  } catch (err) {
    api.send("❌ Something went wrong. Please try again.");
  }
};