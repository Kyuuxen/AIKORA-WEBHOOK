const axios = require("axios");

module.exports.config = {
  name: "nasa",
  description: "NASA astronomy picture of the day",
  usage: "!nasa or !nasa random",
  category: "fun",
};

module.exports.run = async function ({ api, args }) {
  const apiKey = process.env.NASA_API_KEY || "DEMO_KEY";
  let url = `https://api.nasa.gov/planetary/apod?api_key=${apiKey}`;
  if (args[0] === "random") url += "&count=1";

  try {
    const res = await axios.get(url);
    const data = Array.isArray(res.data) ? res.data[0] : res.data;
    const desc = data.explanation.length > 500
      ? data.explanation.substring(0, 497) + "..."
      : data.explanation;

    api.send(
      `🚀 NASA — ${data.title}\n` +
      `📅 ${data.date}\n` +
      `━━━━━━━━━━━━━━\n` +
      `${desc}\n\n` +
      `🔗 ${data.hdurl || data.url}`
    );
  } catch (e) {
    api.send("❌ NASA API unavailable. Try again later.");
  }
};
