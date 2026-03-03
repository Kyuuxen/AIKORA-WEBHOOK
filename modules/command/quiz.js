const axios = require("axios");
if (!global.quizState) global.quizState = new Map();
module.exports.config = { name: "quiz", description: "Quiz yourself on any topic", usage: "!quiz [topic] | !quiz [a/b/c/d]", category: "Study" };
module.exports.run = async function ({ api, args, event }) {
  const uid = event.senderId;
  const first = args[0]?.toLowerCase();
  if (["a","b","c","d"].includes(first)) {
    const state = global.quizState.get(uid);
    if (!state) return api.send("No active quiz! Start: !quiz [topic]");
    global.quizState.delete(uid);
    return first.toUpperCase() === state.correct
      ? api.send("✅ CORRECT!\n\n📖 " + state.explanation)
      : api.send("❌ Wrong! Answer: " + state.correct + "\n\n📖 " + state.explanation);
  }
  const topic = args.join(" ");
  if (!topic) return api.send("Usage: !quiz [topic]\nThen answer: !quiz a / b / c / d");
  api.send("🧠 Generating quiz on: " + topic + "...");
  try {
    const res = await axios.get("https://api-library-kohi.onrender.com/api/copilot", {
      params: { prompt: 'Generate a multiple choice question about "' + topic + '".\nFormat:\nQUESTION: [question]\nA) [option]\nB) [option]\nC) [option]\nD) [option]\nANSWER: [letter]\nEXPLANATION: [why]', model: "default", user: "quiz_" + uid }, timeout: 30000 });
    const text = res.data?.data?.text || "";
    const aMatch = text.match(/ANSWER:\s*([ABCD])/i);
    const eMatch = text.match(/EXPLANATION:\s*([\s\S]+?)(?:\n\n|$)/i);
    if (!aMatch) return api.send("❌ Could not generate. Try again!");
    global.quizState.set(uid, { correct: aMatch[1].toUpperCase(), explanation: eMatch ? eMatch[1].trim() : "" });
    api.send("🧠 QUIZ: " + topic + "\n━━━━━━━━━━━━━━\n" + text.replace(/ANSWER:[\s\S]*/i, "").trim() + "\n\nReply: !quiz a / b / c / d");
  } catch (e) { api.send("❌ Failed. Try again!"); }
};
