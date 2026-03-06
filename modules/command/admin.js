const axios = require("axios");

module.exports.config = {
  name: "admin",
  description: "Send your feedback or chat with admin. The bot will reply with a helpful message from the admin team.",
  usage: "!admin [your message]",
  category: "general",
};

module.exports.run = async function ({ api, args, event }) {
  const senderId = event.senderId;
  const input = args.join(" ").trim();

  if (!input) return api.send("❗ Usage: !admin [your message]");

  try {
    const reply = await api.send(`📬 Sending your message to admin...`);

    const response = await axios.get("https://api.adviceslip.com/advice");
    const advice = response.data.slip?.advice ?? "We couldn't fetch advice at the moment.";

    const message = `🤖 *Admin Response*\n\n💬 You said: *${input}*\n\n📝 *Advice*: ${advice}\n\n✨ Have a great day!`;

    api.send(message);
  } catch (err) {
    api.send(`❌ Oops! Something went wrong while contacting admin (${err.message}).`);
  }
};