const axios = require("axios");

module.exports.config = {
  name: "uptime",
  description: "Displays how long the bot has been running.",
  usage: "!uptime",
  category: "general",
};

module. = async function ({ api, args, event }) {
  if (args.length !== 0) return api.send("Usage: !uptime");
  try {
    const totalSec = Math.floor(process.uptime());
    const hrs = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    const formatted = `${hrs}h ${mins}m ${secs}s`;
    api.send(`⏱️ Bot has been running for ${formatted}.`);
  } catch (err) {
    api.send("❌ Something went wrong. Please try again.");
  }
};
