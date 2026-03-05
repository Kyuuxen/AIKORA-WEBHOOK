const axios = require("axios");

module.exports.config = {
  name: "uptime",
  description: "Displays how long the bot has been running.",
  usage: "!uptime",
  category: "general",
};

module.exports.run = async function ({ api, args, event }) {
  const senderId = event.senderId;

  try {
    const uptimeSeconds = process.uptime();
    const hrs = Math.floor(uptimeSeconds / 3600);
    const mins = Math.floor((uptimeSeconds % 3600) / 60);
    const secs = Math.floor(uptimeSeconds % 60);
    const formatted = [
      hrs > 0 ? `${hrs}h` : null,
      mins > 0 ? `${mins}m` : null,
      `${secs}s`,
    ]
      .filter(Boolean)
      .join(" ");
    const message = `⏰ Bot uptime: ${formatted}`;
    api.send(message, senderId);
  } catch (err) {
    api.send(`❌ ${err.message}`, senderId);
  }
};
