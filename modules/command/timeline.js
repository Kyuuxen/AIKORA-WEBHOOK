const axios = require("axios");
module.exports.config = { name: "timeline", description: "Historical timeline of any topic", usage: "!timeline [topic]", category: "Study" };
module.exports.run = async function ({ api, args }) {
  const topic = args.join(" ");
  if (!topic) return api.send("Usage: !timeline [topic]\nExample: !timeline World War 2");
  api.send("📅 Generating timeline for: " + topic + "...");
  try {
    const res = await axios.get("https://api-library-kohi.onrender.com/api/copilot", {
      params: { prompt: 'Create a chronological timeline for "' + topic + '" with 6-8 key events. Format each as: [YEAR/DATE]: [Event] — [1 sentence description]', model: "default", user: "timeline" }, timeout: 30000 });
    api.send("📅 Timeline: " + topic + "\n━━━━━━━━━━━━━━\n" + (res.data?.data?.text || "No response."));
  } catch (e) { api.send("❌ Failed. Try again!"); }
};
