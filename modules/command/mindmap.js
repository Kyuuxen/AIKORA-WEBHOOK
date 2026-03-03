const axios = require("axios");
module.exports.config = { name: "mindmap", description: "Generate a mind map outline", usage: "!mindmap [topic]", category: "Study" };
module.exports.run = async function ({ api, args }) {
  const topic = args.join(" ");
  if (!topic) return api.send("Usage: !mindmap [topic]\nExample: !mindmap climate change");
  api.send("🗺️ Generating mind map for: " + topic + "...");
  try {
    const res = await axios.get("https://api-library-kohi.onrender.com/api/copilot", {
      params: { prompt: 'Create a mind map text outline for "' + topic + '". Show main topic in center, then 4-5 main branches, each with 2-3 sub-branches. Use indentation and symbols like → and • to show hierarchy.', model: "default", user: "mindmap" }, timeout: 30000 });
    api.send("🗺️ Mind Map: " + topic + "\n━━━━━━━━━━━━━━\n" + (res.data?.data?.text || "No response."));
  } catch (e) { api.send("❌ Failed. Try again!"); }
};
