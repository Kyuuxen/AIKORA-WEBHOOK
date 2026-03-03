const axios = require("axios");
module.exports.config = { name: "explain", description: "Explain any topic simply", usage: "!explain [topic]", category: "Study" };
module.exports.run = async function ({ api, args }) {
  const topic = args.join(" ");
  if (!topic) return api.send("Usage: !explain [topic]\nExample: !explain quantum physics");
  api.send("🔍 Explaining: " + topic + "...");
  try {
    const res = await axios.get("https://api-library-kohi.onrender.com/api/copilot", {
      params: { prompt: 'Explain "' + topic + '" simply like explaining to a 10-year-old. Use an analogy. Keep under 500 characters.', model: "default", user: "explain" }, timeout: 30000 });
    api.send("💡 " + topic + "\n━━━━━━━━━━━━━━\n" + (res.data?.data?.text || "No response."));
  } catch (e) { api.send("❌ Failed. Try again!"); }
};
