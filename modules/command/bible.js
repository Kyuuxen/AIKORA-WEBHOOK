const { http } = require("../utils");

module.exports.config = {
    name: "bible",
    author: "Sethdico",
    version: "2.0",
    category: "Fun",
    description: "Random Bible verse.",
    adminOnly: false,
    usePrefix: false,
    cooldown: 5,
};

module.exports.run = async function ({ event, api }) {
  try {
    const res = await http.get("https://urangkapolka.vercel.app/api/bible");
    const { verse, reference } = res.data;
    
    const msg = `✝️ **${reference || "Bible"}**\n━━━━━━━━━━━━━━━━\n${verse || res.data.text}`;
    
    // Flow: Postback "bible" triggers the next verse
    const buttons = [{ type: "postback", title: "📖 New Verse", payload: "bible" }];

    await api.sendButton(msg, buttons, event.sender.id);
  } catch (e) {
    api.sendMessage("❌ Amen... but the API is currently offline.", event.sender.id);
  }
};
