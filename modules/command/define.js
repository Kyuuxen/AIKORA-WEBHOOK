const axios = require("axios");
module.exports.config = { name: "define", description: "Define any word", usage: "!define [word]", category: "Study" };
module.exports.run = async function ({ api, args }) {
  const word = args.join(" ");
  if (!word) return api.send("Usage: !define [word]\nExample: !define photosynthesis");
  try {
    const res = await axios.get("https://api.dictionaryapi.dev/api/v2/entries/en/" + encodeURIComponent(word), { timeout: 10000 });
    const data = res.data[0];
    const meaning = data.meanings[0];
    const def = meaning?.definitions[0];
    let msg = "📖 " + data.word.toUpperCase() + "\n━━━━━━━━━━━━━━\n";
    msg += "Type: " + meaning?.partOfSpeech + "\n";
    msg += "Definition: " + def?.definition + "\n";
    if (def?.example) msg += "Example: " + def.example + "\n";
    if (data.phonetics?.[0]?.text) msg += "Pronunciation: " + data.phonetics[0].text;
    api.send(msg);
  } catch (e) { api.send("❌ Word not found: " + word); }
};
