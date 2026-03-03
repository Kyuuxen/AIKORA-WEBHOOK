const axios = require("axios");

module.exports.config = {
  name: "copilot",
  description: "Ask Microsoft Copilot AI",
  usage: "!copilot [question] | !copilot -think [question]",
  category: "AI",
};

module.exports.run = async function ({ api, args, event }) {
  let model = "default";
  let prompt = args.join(" ");

  // Support -think and -gpt5 flags
  if (args[0]?.startsWith("-")) {
    const flag = args[0].slice(1).toLowerCase();
    if (flag === "think") {
      model = "think-deeper";
      prompt = args.slice(1).join(" ");
    } else if (flag === "gpt5") {
      model = "gpt-5";
      prompt = args.slice(1).join(" ");
    }
  }

  if (!prompt) return api.send(
    "🚀 Usage: !copilot [question]\n" +
    "Flags:\n" +
    "  !copilot -think [question] → Deep thinking mode\n" +
    "  !copilot -gpt5 [question]  → GPT-5 mode"
  );

  api.send("⏳ Copilot is thinking...");

  try {
    const res = await axios.get("https://api-library-kohi.onrender.com/api/copilot", {
      params: { prompt, model, user: event.senderId },
      timeout: 60000,
    });

    const result = res.data?.data;
    if (!result?.text) return api.send("⚠️ Couldn't get an answer from Copilot.");

    let msg = `🚀 COPILOT\n━━━━━━━━━━━━━━\n${result.text}`;

    // Add sources if available
    if (result.citations && result.citations.length > 0) {
      msg += "\n\n📚 Sources:\n";
      result.citations.slice(0, 3).forEach((s, i) => {
        msg += `${i + 1}. ${s.title}\n${s.url}\n`;
      });
    }

    api.send(msg);
  } catch (e) {
    api.send("❌ Copilot is having issues right now. Try again later.");
  }
};
