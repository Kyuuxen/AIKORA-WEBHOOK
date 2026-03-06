const axios = require("axios");

module.exports.config = {
  name: "gf",
  description: "Pretend she's your girlfriend. Send sweet replies, jokes, or quotes based on your message.",
  usage: "!gf [your input]",
  category: "general",
};

module.exports.run = async function ({ api, args, event }) {
  const senderId = event.senderId;
  const input = args.join(" ").trim();
  
  if (!input) return api.send("Usage: !gf [your input]");
  
  const senderName = event.senderName || "darling";
  const lower = input.toLowerCase();
  try {
    if (lower.includes("joke") || lower.includes("laugh")) {
      const jokeRes = await axios.get("https://official-joke-api.appspot.com/jokes/random");
      const joke = `${jokeRes.data.setup}\n${jokeRes.data.punchline}`;
      return api.send(`😂 Hey ${senderName}! Here’s a joke for you:\n\n${joke}\n\nHope it made you smile!`);
    } else if (lower.includes("quote") || lower.includes("inspire")) {
      const quoteRes = await axios.get("https://api.quotable.io/random");
      const quote = `"${quoteRes.data.content}" — ${quoteRes.data.author}`;
      return api.send(`💬 ${senderName}, here's a thoughtful quote for you:\n\n${quote}\n\nFeel the vibes!`);
    } else {
      const loveRes = await axios.get("https://api.quotable.io/random?tags=life,love");
      const loveQuote = `"${loveRes.data.content}"`;
      return api.send(`💖 Hi ${senderName}! I saw something that made me think of you:\n\n${loveQuote}\n\nTell me what you’d like to talk about next!`);
    }
  } catch (err) {
    return api.send("❌ Something went wrong. Please try again.");
  }
};