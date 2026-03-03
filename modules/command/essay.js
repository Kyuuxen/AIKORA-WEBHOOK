const axios = require("axios");
module.exports.config = { name: "essay", description: "Generate essay outline", usage: "!essay [topic]", category: "Study" };
module.exports.run = async function ({ api, args }) {
  const topic = args.join(" ");
  if (!topic) return api.send("Usage: !essay [topic]\nExample: !essay climate change");
  api.send("✍️ Generating essay outline for: " + topic + "...");
  try {
    const res = await axios.get("https://api-library-kohi.onrender.com/api/copilot", {
      params: { prompt: 'Create an essay outline for "' + topic + '". Include: Introduction (thesis), 3 body paragraphs with main points, Conclusion. Keep it concise.', model: "default", user: "essay" }, timeout: 30000 });
    api.send("✍️ Essay Outline: " + topic + "\n━━━━━━━━━━━━━━\n" + (res.data?.data?.text || "No response."));
  } catch (e) { api.send("❌ Failed. Try again!"); }
};
