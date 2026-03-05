const axios = require("axios");
if (!global.quizState) global.quizState = new Map();

/*
QUESTION:
 A:
 B:
 C:
 D:
 ANSWER:
*/

module.exports.config = {
  name: "quiz",
  description: "Answer questions about any topic",
  usage: "!quiz [topic] | !quiz [a|b|c|d]",
  category: "Study",
};

module.exports.run = async function ({ api, args, event }) {
  const uid = event?.sender?.id ?? event?.senderId;
  if (!uid) return;

  const first = args[0]?.toLowerCase();

  if (["a", "b", "c", "d"].includes(first)) {
    const state = global.quizState.get(uid);
    if (!state) return api.sendMessage("❌ No active quiz. Start one with: !quiz [topic]");
    global.quizState.delete(uid);
    if (first.toUpperCase() === state.correct) {
      return api.sendMessage(`✅ CORRECT!\n\n📖 ${state.explanation}`);
    }
    return api.sendMessage(
      `❌ Wrong! Correct answer: ${state.correct}\n\n📖 ${state.explanation}`
    );
  }

  const topic = args.join(" ").trim();
  if (!topic) {
    return api.sendMessage("❌ Provide a topic: !quiz [topic]\nThen answer with !quiz a/b/c/d");
  }

  api.sendMessage(`🧠 Generating quiz on: ${topic}...`);
  try {
    const res = await axios.get("https://api-library-kohi.onrender.com/api/copilot", {
      params: {
        prompt: `Generate a multiple choice question about "${topic}". Format:\nQUESTION: [question]\nA) [option]\nB) [option]\nC) [option]\nD) [option]\nANSWER: [letter]\nEXPLANATION: [why]`,
        model: "default",
        user: "quiz_" + uid,
      },
      timeout: 30000,
    });

    const text = res.data?.data?.text ?? "";
    const aMatch = text.match(/ANSWER:\s*([ABCD])/i);
    const eMatch = text.match(/EXPLANATION:\s*([\s\S]+?)(?:\n\n|$)/i);

    if (!aMatch) {
      return api.sendMessage("❌ Error in quiz generation. Try again!");
    }

    global.quizState.set(uid, {
      correct: aMatch[1].toUpperCase(),
      explanation: eMatch ? eMatch[1].trim() : "",
    });

    const cleanText = text.replace(/ANSWER:[\s\S]*/i, "").trim();
    api.sendMessage(`🧠 QUIZ: ${topic}\n━━━━━━━━━━━━━━\n${cleanText}\n\nReply: !quiz a / b / c / d`);
  } catch (err) {
    api.sendMessage("❌ Failed to fetch quiz. Try again!");
  }
};