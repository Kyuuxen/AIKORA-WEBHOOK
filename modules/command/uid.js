module.exports.config = {
  name: "uid",
  description: "Shows your Facebook User ID",
  usage: "!uid",
  category: "utility",
};

module.exports.run = async function ({ api, event }) {
  api.send(`🪪 Your Facebook ID:\n${event.senderId}`);
};
