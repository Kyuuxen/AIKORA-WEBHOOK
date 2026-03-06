const axios = require("axios");

module.exports.config = {
  name: "gf",
  description: "Pretend she's your girlfriend. Send sweet replies, jokes, or quotes based on your message.",
  usage: "!gf [your input]",
  category: "general",
};

module.exports.run = async function ({ api, args, event }) {
  if (!args || args.length === 0) {
    return api.sendMessage("Usage: !gf [your input]", event.threadID, event.messageID);
  }

  const senderName = event.senderName || "darling";
  const input = args.join(" ").trim().toLowerCase();

  try {
    if (input.includes("joke") || input.includes("laugh")) {
      const jokeRes = await axios.get("https://official-joke-api.appspot.com/jokes/random");
      const joke = `${jokeRes.data.setup}\n${jokeRes.data.punchline}`;
      return api.sendMessage(
        `😂 Hey ${senderName}! Here’s a joke for you:\n\n${joke}\n\nHope it made you smile!`,
        event.threadID,
        event.messageID
      );
    } else if (input.includes("quote") || input.includes("inspire")) {
      const quoteRes = await axios.get("https://api.quotable.io/random");
      const quote = `"${quoteRes.data.content}" — ${quoteRes.data.author}`;
      return api.sendMessage(
        `💬 ${senderName}, here's a thoughtful quote for you:\n\n${quote}\n\nFeel the vibes!`,
        event.threadID,
        event.messageID
      );
    } else {
      const loveRes = await axios.get("https://api.quotable.io/random?tags=life,love");
      const loveQuote = `"${loveRes.data.content}"`;
      return api.sendMessage(
        `💖 Hi ${senderName}! I saw something that made me think of you:\n\n${loveQuote}\n\nTell me what you’d like to talk about next!`,
        event.threadID,
        event.messageID
      );
    }
  } catch (err) {
    return api.sendMessage("❌ Something went wrong. Please try again.", event.threadID, event.messageID);
  }
};