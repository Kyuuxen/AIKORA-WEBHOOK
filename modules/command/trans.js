const axios = require("axios");

module.exports.config = {
  name: "trans",
  description: "Translate text to another language",
  usage: "!trans [language] [text]",
  category: "utility",
};

const LANG_MAP = {
  "english": "en", "en": "en",
  "tagalog": "tl", "tl": "tl", "filipino": "tl",
  "japanese": "ja", "ja": "ja",
  "korean": "ko", "ko": "ko",
  "chinese": "zh-CN", "zh": "zh-CN",
  "spanish": "es", "es": "es",
  "french": "fr", "fr": "fr",
  "german": "de", "de": "de",
  "italian": "it", "it": "it",
  "russian": "ru", "ru": "ru",
  "arabic": "ar", "ar": "ar",
  "thai": "th", "th": "th",
  "vietnamese": "vi", "vi": "vi",
  "indonesian": "id", "id": "id",
  "malay": "ms", "ms": "ms",
  "portuguese": "pt", "pt": "pt",
};

module.exports.run = async function ({ api, args }) {
  if (!args.length) return api.send("Usage: !trans [language] [text]\nExample: !trans tagalog Hello world");

  let targetLang = "en";
  let text = "";

  if (LANG_MAP[args[0].toLowerCase()]) {
    targetLang = LANG_MAP[args[0].toLowerCase()];
    text = args.slice(1).join(" ");
  } else {
    text = args.join(" ");
  }

  if (!text) return api.send("❌ Please provide text to translate.");

  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
    const res = await axios.get(url);
    const translated = res.data[0].map(x => x[0]).join("");
    const detected = res.data[2];
    api.send(`🌐 ${detected} → ${targetLang}\n\n${translated}`);
  } catch (e) {
    api.send("❌ Translation failed.");
  }
};
