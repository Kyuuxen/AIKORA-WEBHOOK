const axios = require("axios");
module.exports.config = { name: "summarize", description: "Summarize any text", usage: "!summarize [text]", category: "Study" };
module.exports.run = async function ({ api, args }) {
  const text = args.join(" ");
  if (!text) return api.send("Usage: !summarize [text or topic]\nExample: !summarize the French Revolution");
  api.send("📝 Summarizing...");
  try {
    const res = await axios.get("https://api-library-kohi.onrender.com/api/copilot", {
      params: { prompt: "Summarize in 3-5 clear bullet points:\n\n" + text, model: "default", user: "summarize" }, timeout: 30000 });
    api.send("📝 Summary\n━━━━━━━━━━━━━━\n" + (res.data?.data?.text || "No response."));
  } catch (e) { api.send("❌ Failed. Try again!"); }
};
