const axios = require("axios");

module.exports.config = {
  name: "admin",
  description: "Send feedback or a question to the admin team.",
  usage: "!admin [your message]",
  category: "general",
};

module.exports.run = async function ({ api, args, event }) {
  const senderId = event.senderId;
  const message = args.join(" ").trim();

  if (!message) return api.send("❗️ Usage: !admin [your message]");

  try {
    const response = await axios.post(
      "https://jsonplaceholder.typicode.com/posts",
      {
        userId: senderId,
        title: "Admin feedback",
        body: message,
      }
    );

    if (response.status === 201) {
      return api.send(
        `✅ Your message has been sent to the admin. ${String.fromCodePoint(
          0x1f4ac
        )}`
      );
    } else {
      return api.send(`❌ Failed to send message. Status: ${response.status}`);
    }
  } catch (err) {
    return api.send(`❌ Something went wrong: ${err.message}`);
  }
};