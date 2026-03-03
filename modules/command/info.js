module.exports.config = {
  name: "info",
  description: "Shows bot information",
  usage: "!info",
  category: "utility",
};

module.exports.run = async function ({ api }) {
  api.send(
    `🤖 AIKORA Bot\n` +
    `━━━━━━━━━━━━━━\n` +
    `📌 Version: 1.0.0\n` +
    `⚡ Platform: Facebook Messenger\n` +
    `🔧 Prefix: !\n` +
    `📡 Status: Online\n` +
    `━━━━━━━━━━━━━━\n` +
    `Type !help to see all commands.`
  );
};
