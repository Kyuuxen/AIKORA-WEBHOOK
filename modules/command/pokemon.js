const axios = require("axios");

module.exports.config = {
  name: "pokemon",
  description: "Get Pokedex info for a Pokemon",
  usage: "!pokemon [name/random]",
  category: "fun",
};

module.exports.run = async function ({ api, args }) {
  let query = args[0]?.toLowerCase();
  if (!query) return api.send("⚡ Usage: !pokemon [name]\nExample: !pokemon pikachu\nTip: !pokemon random");

  if (query === "random") query = Math.floor(Math.random() * 1025) + 1;

  try {
    const res = await axios.get(`https://pokeapi.co/api/v2/pokemon/${query}`);
    const d = res.data;
    const name = d.name.toUpperCase();
    const types = d.types.map(t => t.type.name).join("/");
    const s = {};
    d.stats.forEach(st => s[st.stat.name] = st.base_stat);

    api.send(
      `⚡ ${name} #${d.id}\n` +
      `━━━━━━━━━━━━━━\n` +
      `🧬 Type: ${types}\n` +
      `📏 Height: ${d.height / 10}m | Weight: ${d.weight / 10}kg\n\n` +
      `📊 STATS\n` +
      `HP: ${s.hp} | ATK: ${s.attack}\n` +
      `DEF: ${s.defense} | SPD: ${s.speed}\n` +
      `SP.ATK: ${s["special-attack"]} | SP.DEF: ${s["special-defense"]}`
    );
  } catch (e) {
    api.send("❌ Pokemon not found. Try: !pokemon pikachu");
  }
};
