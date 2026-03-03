const axios = require("axios");
module.exports.config = { name: "study", description: "AI study guide", usage: "!study [topic]", category: "Study" };
module.exports.run = async function ({ api, args }) {
  const topic = args.join(" ");
  if (!topic) return api.send("📚 Study Commands:\n!study [topic]\n!explain [topic]\n!quiz [topic]\n!flashcard [topic]\n!summarize [text]\n!essay [topic]\n!define [word]\n!formula [topic]\n!timeline [topic]\n!mindmap [topic]\n!chess");
  api.send("📖 Generating study guide for: " + topic + "...");
  try {
    const res = await axios.get("https://api-library-kohi.onrender.com/api/copilot", {
      params: { prompt: 'Create a study guide for "' + topic + '". Include: 1) Overview 2) Key Concepts (5 points) 3) Important Facts 4) Exam Questions (3) 5) Quick Tip. Keep under 1500 chars.', model: "default", user: "study" }, timeout: 30000 });
    api.send("📚 " + topic.toUpperCase() + "\n━━━━━━━━━━━━━━\n" + (res.data?.data?.text || "No response."));
  } catch (e) { api.send("❌ Failed. Try again!"); }
};
