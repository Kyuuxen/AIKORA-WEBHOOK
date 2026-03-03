const axios = require("axios");
module.exports.config = { name: "formula", description: "Get key formulas for any subject", usage: "!formula [topic]", category: "Study" };
module.exports.run = async function ({ api, args }) {
  const topic = args.join(" ");
  if (!topic) return api.send("Usage: !formula [topic]\nExamples:\n!formula physics\n!formula algebra\n!formula chemistry");
  api.send("🔢 Getting formulas for: " + topic + "...");
  try {
    const res = await axios.get("https://api-library-kohi.onrender.com/api/copilot", {
      params: { prompt: 'List the 5-8 most important formulas for "' + topic + '". For each formula show: Name, Formula, and what each variable means. Format clearly.', model: "default", user: "formula" }, timeout: 30000 });
    api.send("🔢 " + topic.toUpperCase() + " FORMULAS\n━━━━━━━━━━━━━━\n" + (res.data?.data?.text || "No response."));
  } catch (e) { api.send("❌ Failed. Try again!"); }
};
