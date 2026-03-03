const axios = require("axios");
if (!global.fcState) global.fcState = new Map();
module.exports.config = { name: "flashcard", description: "Study with flashcards", usage: "!flashcard [topic] | flip | next | prev", category: "Study" };
module.exports.run = async function ({ api, args, event }) {
  const uid = event.senderId; const first = args[0]?.toLowerCase();
  if (["flip","next","prev"].includes(first)) {
    const s = global.fcState.get(uid);
    if (!s) return api.send("No flashcards! Generate: !flashcard [topic]");
    if (first === "flip") return api.send("💡 Answer " + (s.index+1) + "/" + s.cards.length + "\n━━━━━━━━━━━━━━\n" + s.cards[s.index].answer + "\n\n!flashcard next — next card");
    if (first === "next") s.index = Math.min(s.index+1, s.cards.length-1);
    if (first === "prev") s.index = Math.max(s.index-1, 0);
    return api.send("🃏 Card " + (s.index+1) + "/" + s.cards.length + "\n━━━━━━━━━━━━━━\n❓ " + s.cards[s.index].question + "\n\n!flashcard flip — answer\n!flashcard next — next");
  }
  const topic = args.join(" ");
  if (!topic) return api.send("Usage: !flashcard [topic]\nThen: !flashcard flip / next / prev");
  api.send("🃏 Generating flashcards for: " + topic + "...");
  try {
    const res = await axios.get("https://api-library-kohi.onrender.com/api/copilot", {
      params: { prompt: 'Create 5 flashcards for "' + topic + '".\nFormat:\nCARD1_Q: [question]\nCARD1_A: [answer]\nCARD2_Q: [question]\nCARD2_A: [answer]\nCARD3_Q: [question]\nCARD3_A: [answer]\nCARD4_Q: [question]\nCARD4_A: [answer]\nCARD5_Q: [question]\nCARD5_A: [answer]', model: "default", user: "fc_" + uid }, timeout: 30000 });
    const text = res.data?.data?.text || "";
    const cards = [];
    for (let i = 1; i <= 5; i++) {
      const q = text.match(new RegExp("CARD" + i + "_Q:\\s*(.+)", "i"));
      const a = text.match(new RegExp("CARD" + i + "_A:\\s*(.+)", "i"));
      if (q && a) cards.push({ question: q[1].trim(), answer: a[1].trim() });
    }
    if (!cards.length) return api.send("❌ Failed to parse. Try again!");
    global.fcState.set(uid, { cards, index: 0 });
    api.send("🃏 Flashcards: " + topic + " (" + cards.length + " cards)\n━━━━━━━━━━━━━━\nCard 1/" + cards.length + "\n\n❓ " + cards[0].question + "\n\n!flashcard flip — answer\n!flashcard next — next card");
  } catch (e) { api.send("❌ Failed. Try again!"); }
};
