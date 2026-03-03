const axios = require("axios");

module.exports.config = {
  name: "dict",
  description: "Dictionary - define a word",
  usage: "!dict [word] or !dict slang [word]",
  category: "utility",
};

module.exports.run = async function ({ api, args }) {
  const isSlang = args[0]?.toLowerCase() === "slang";
  const query = isSlang ? args.slice(1).join(" ") : args.join(" ");

  if (!query) return api.send("Usage:\n!dict [word] - formal definition\n!dict slang [word] - urban slang");

  if (isSlang) {
    try {
      const res = await axios.get(`https://api.urbandictionary.com/v0/define?term=${encodeURIComponent(query)}`);
      const entry = res.data.list?.[0];
      if (!entry) return api.send(`No slang found for "${query}".`);
      const def = entry.definition.replace(/[\[\]]/g, "");
      const ex  = entry.example.replace(/[\[\]]/g, "");
      api.send(`📖 ${query} (slang)\n━━━━━━━━━━━━━━\n${def}\n\n💬 Example:\n${ex}`);
    } catch (e) {
      api.send("❌ Urban Dictionary is down.");
    }
    return;
  }

  try {
    const res = await axios.get(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(query)}`);
    const data = res.data[0];
    const def  = data.meanings[0].definitions[0].definition;
    const ex   = data.meanings[0].definitions[0].example || "";
    const type = data.meanings[0].partOfSpeech;
    const phonetics = data.phonetics.find(p => p.text)?.text || "";

    let msg = `📖 ${data.word}`;
    if (phonetics) msg += ` /${phonetics}/`;
    msg += `\n(${type})\n━━━━━━━━━━━━━━\n${def}`;
    if (ex) msg += `\n\n💬 Example:\n"${ex}"`;

    api.send(msg);
  } catch (e) {
    api.send(`❌ No definition found for "${query}".`);
  }
};
