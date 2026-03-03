module.exports.config = {
  name: "time",
  description: "Get current date and time (Philippines UTC+8)",
  usage: "!time",
  category: "utility",
};

module.exports.run = async function ({ api }) {
  // Use the Asia/Manila time zone (Philippines, UTC+8)
  const manilaDate = new Date().toLocaleString("en-US", { timeZone: "Asia/Manila" });
  const manila = new Date(manilaDate);

  // Format pieces
  const dateStr = manila.toDateString(); // e.g. "Tue Mar 03 2026"
  const timeStr = manila.toLocaleTimeString("en-US", { hour12: false }); // 24-hour format
  const timezoneLabel = "UTC+8 (Philippines)";

  api.send(
    `🕐 Current Time\n` +
    `━━━━━━━━━━━━━━\n` +
    `📅 Date: ${dateStr}\n` +
    `⏰ Time: ${timeStr}\n` +
    `🌍 Timezone: ${timezoneLabel}`
  );
};
