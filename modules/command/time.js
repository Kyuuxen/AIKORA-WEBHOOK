module.exports.config = {
  name: "time",
  description: "Get current date and time",
  usage: "!time",
  category: "utility",
};

module.exports.run = async function ({ api }) {
  const now = new Date();
  api.send(
    `🕐 Current Time\n` +
    `━━━━━━━━━━━━━━\n` +
    `📅 Date: ${now.toDateString()}\n` +
    `⏰ Time: ${now.toLocaleTimeString()}\n` +
    `🌍 Timezone: UTC${now.getTimezoneOffset() > 8 ? "-" : "+"}${Math.abs(now.getTimezoneOffset() / 60)}`
  );
};
