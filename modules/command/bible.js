const axios = require("axios");

module.exports.config = {
  name: "bible",
  description: "Get a random Bible verse",
  usage: "!bible",
  category: "fun",
};

module.exports.run = async function ({ api }) {
  try {
    const res = await axios.get("https://urangkapolka.vercel.app/api/bible");
    const { verse, reference, text } = res.data;
    api.send(`✝️ ${reference || "Bible"}\n━━━━━━━━━━━━━━\n${verse || text}`);
  } catch (e) {
    api.send("❌ Amen... but the Bible API is currently offline.");
  }
};
