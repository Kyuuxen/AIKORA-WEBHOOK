module.exports.config = {
  name: "ping",
  description: "Check if bot is online",
  usage: "!ping",
  category: "utility",
};

module.exports.run = async function ({ api }) {
  const start = Date.now();
  await api.send(`🏓 Pong! Response time: ${Date.now() - start}ms\n✅ AIKORA is online!`);
};
