const axios = require("axios");

module.exports.config = {
  name:        "quiz",
  description: "AI-generated quiz with multiple choice questions",
  usage:       "!quiz [topic]",
  category:    "Fun",
};

// ── Active quiz sessions ──────────────────────────────────────────────────────
if (!global.quizSessions) global.quizSessions = {};

// ── Ask AI via Pollinations ───────────────────────────────────────────────────
async function askAI(prompt) {
  const models = ["openai", "llama", "mistral"];
  for (let i = 0; i < models.length; i++) {
    try {
      const res = await axios.post(
        "https://text.pollinations.ai/",
        {
          messages: [{ role: "user", content: prompt }],
          model:    models[i],
          seed:     Math.floor(Math.random() * 9999),
        },
        { headers: { "Content-Type": "application/json" }, timeout: 30000 }
      );
      const text = typeof res.data === "string" ? res.data : JSON.stringify(res.data);
      if (text && text.length > 50) return text;
    } catch(e) { console.log("[Quiz] AI " + models[i] + " failed:", e.message); }
  }
  throw new Error("All AI models failed");
}

// ── Generate quiz question ────────────────────────────────────────────────────
async function generateQuestion(topic) {
  const prompt =
    "Generate a multiple choice quiz question about: " + topic + "\n\n" +
    "You MUST respond in EXACTLY this format with no extra text:\n" +
    "QUESTION: [the question here]\n" +
    "A: [option A]\n" +
    "B: [option B]\n" +
    "C: [option C]\n" +
    "D: [option D]\n" +
    "ANSWER: [just the letter A, B, C, or D]\n" +
    "EXPLANATION: [brief explanation why]\n\n" +
    "Do not add anything else. Follow the exact format above.";

  const raw = await askAI(prompt);

  // Parse the response
  const questionMatch     = raw.match(/QUESTION:\s*(.+?)(?:\n|$)/i);
  const aMatch            = raw.match(/^A[:.]\s*(.+?)(?:\n|$)/im);
  const bMatch            = raw.match(/^B[:.]\s*(.+?)(?:\n|$)/im);
  const cMatch            = raw.match(/^C[:.]\s*(.+?)(?:\n|$)/im);
  const dMatch            = raw.match(/^D[:.]\s*(.+?)(?:\n|$)/im);
  const answerMatch       = raw.match(/ANSWER:\s*([ABCD])/i);
  const explanationMatch  = raw.match(/EXPLANATION:\s*(.+?)(?:\n|$)/i);

  if (!questionMatch || !aMatch || !bMatch || !cMatch || !dMatch || !answerMatch) {
    console.log("[Quiz] Parse failed. Raw response:", raw.substring(0, 200));
    throw new Error("Could not parse quiz format");
  }

  return {
    question:    questionMatch[1].trim(),
    options:     {
      A: aMatch[1].trim(),
      B: bMatch[1].trim(),
      C: cMatch[1].trim(),
      D: dMatch[1].trim(),
    },
    answer:      answerMatch[1].toUpperCase(),
    explanation: explanationMatch ? explanationMatch[1].trim() : "Correct!",
    topic:       topic,
  };
}

// ── Format quiz message ───────────────────────────────────────────────────────
function formatQuestion(q, num) {
  return (
    "🧠 QUIZ" + (num ? " #" + num : "") + " — " + q.topic.toUpperCase() + "\n" +
    "━━━━━━━━━━━━━━\n" +
    "❓ " + q.question + "\n\n" +
    "A️⃣  " + q.options.A + "\n" +
    "B️⃣  " + q.options.B + "\n" +
    "C️⃣  " + q.options.C + "\n" +
    "D️⃣  " + q.options.D + "\n\n" +
    "Reply with A, B, C, or D!"
  );
}

// ── Command ───────────────────────────────────────────────────────────────────
module.exports.run = async function ({ api, args, event }) {
  const uid   = event.senderId;
  const input = args.join(" ").trim().toLowerCase();

  // Check if answering an active quiz
  const answer = input.toUpperCase();
  if (["A","B","C","D"].includes(answer) && global.quizSessions[uid]) {
    const session = global.quizSessions[uid];
    const correct = session.answer;
    const isRight = answer === correct;

    delete global.quizSessions[uid];

    let msg = isRight
      ? "✅ CORRECT! Well done!\n\n"
      : "❌ Wrong! The answer is " + correct + "\n\n";

    msg += "💡 " + session.explanation + "\n\n";
    msg += isRight ? "🎉 Keep it up! Try another: !quiz [topic]" : "💪 Try again: !quiz [topic]";

    return api.send(msg);
  }

  // Generate new quiz
  const topic = input || "general knowledge";

  await api.send("🧠 Generating quiz on: " + topic + "...");

  try {
    const question = await generateQuestion(topic);

    // Save session
    global.quizSessions[uid] = {
      answer:      question.answer,
      explanation: question.explanation,
      topic:       topic,
      time:        Date.now(),
    };

    // Auto-expire session after 5 minutes
    setTimeout(function() {
      if (global.quizSessions[uid] && global.quizSessions[uid].time === global.quizSessions[uid].time) {
        delete global.quizSessions[uid];
      }
    }, 5 * 60 * 1000);

    await api.send(formatQuestion(question));

  } catch(err) {
    console.error("[Quiz] Error:", err.message);
    await api.send(
      "❌ Could not generate quiz.\n\n" +
      "Try a more specific topic like:\n" +
      "!quiz philippine history\n" +
      "!quiz math\n" +
      "!quiz animals"
    );
  }
};
