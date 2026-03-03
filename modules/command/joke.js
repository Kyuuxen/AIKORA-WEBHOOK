const axios = require("axios");

module.exports.config = {
  name: "joke",
  description: "Get a random joke",
  usage: "!joke",
  category: "fun",
};

module.exports.run = async function ({ api }) {
  try {
    const res = await axios.get("https://official-joke-api.appspot.com/random_joke");
    api.send(`🤣 ${res.data.setup}\n\n👉 ${res.data.punchline}`);
  } catch (e) {
    api.send("🤣 Why did the bot fail? Because the API was down.");
  }
};
