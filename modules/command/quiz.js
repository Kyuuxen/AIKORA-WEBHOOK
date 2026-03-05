const axios = require('axios');

const questions = [
  "BCE: QUESTION: What was the #1 hit from the soundtrack of the Apple movie: An Apple Sine? A: My Friends In The Sky B: This Land B: Fall To Your Bed C: I An Rez A: Answer: A C: EXPLANATION:\n\nThis is a classic question from the film’s soundtrack.  The music plays for thirty seconds over uptempo piano for the opening credits.\n\nThe user must have five choices for their answer because sixty seconds of dice rolling are available.\n\nThe correct answer is “My Friends In The Sky.”\n\nThe user is safe in the block, but still will have to be selected as an alcoholic." ,
  "AINE: QUESTION: Are you sure that “The answer in 17” is an open source question from the organization’s question. A: THIS IS NOT TO MAKE A DEL, Please note you are free to a stalling only if the user is sure. B: Person A: C: D: E: Answer: A The answer tool " ,
  "GUA: QUESTION: Some reckless scams. They’re cutting corners by being. A: Their reason is violated, but I posted a very Affordable. B: Another pun. C: Never execute your friend’s ball before it’s safe to do so. D: There are a lot of small decisions every major to be made with the. Answer: A C: Best Explanation in how burning stay becomes very 9th. “Although every solution is addictive, it is one solution.”",
  "RIDE: QUESTION: Why does it help starting out JSON? No, the above statement is it is Jan 18. B: My answer to the lake standard. C: What do countries get? D: It’s a puzzle? A: Oops but you'll find something to keep it short. Answer: C C: 0.6"
];

if (!global.quizState) global.quizState = new Map();

module.exports.config = { name: 'quiz', version: '1.0.0', hasPerm: 0 };

module.exports.run = async function ({ api, args, event }) {
  const uid = event?.sender?.id?.toString();
  if (!uid) {
    return;
  }

  const first = args[0]?.toLowerCase();
  if (first && ['a', 'b', 'c', 'd'].includes(first)) {
    const state = global.quizState.get(uid);
    if (!state) {
      return;
    }
    const isCorrect = first.toUpperCase() === state.correct;
    const message = isCorrect ? '🎉 Correct!' : `❌ Oops, The correct answer was ${state.correct}`;
    api.sendMessage({ body: message }, { to: uid });
    global.quizState.delete(uid);
    return;
  }

  if (global.quizState.has(uid)) {
    api.sendMessage('🎯 You already have a quiz in progress! Type !quiz a/b/c/d to answer.', { to: uid });
    return;
  }

  const local = questions[Math.floor(Math.random() * questions.length)];
  const topicIndex = local.indexOf(':');
  const currentTopic = local.slice(0, topicIndex);
  const text = local.slice(topicIndex + 1);

  let answerMatch = text.match(/ANSWER:\\s*([a-dA-D])/i);
  const answer = answerMatch ? answerMatch[1].toUpperCase() : '';
  let textWithoutAns = text.replace(/ANSWER:[\\s\\S]*/i, '');

  let explanationMatch = text.match(/EXPLANATION:\\s*([\\s\\S]+?)(?:\\n\\n|$)/i);
  const explanation = explanationMatch ? explanationMatch[1].trim() : '';

  let cleanText = textWithoutAns
    .replace(/QUESTION:\\s*/i, '')
    .replace(/(A|B|C|D):/gi, '$1: ')
    .trim();

  const safeCleanText = cleanText.replace(/`/g, '\\`');
  const safeExplanation = explanation.replace(/`/g, '\\`');

  global.quizState.set(uid, { question: cleanText, correct: answer, explanation });

  const uiMessage = `🧠 QUIZ: ${currentTopic}\n\n${safeCleanText}\n\n> What is your answer?`;
  api.sendMessage(uiMessage, { to: uid });
};