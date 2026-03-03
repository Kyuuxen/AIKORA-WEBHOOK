module.exports.config = {
  name: "aimode",
  description: "Switch or check the current AI model",
  usage: "!aimode [model] or !aimode list",
  category: "Admin",
};

const AI_MODELS = {
  copilot: {
    label: "🚀 Microsoft Copilot",
    call: async (axios, uid, msg, sys, buildCtx) => {
      const r = await axios.get("https://api-library-kohi.onrender.com/api/copilot", {
        params: { prompt: sys + "\n\n" + buildCtx(uid, msg), model: "default", user: uid },
        timeout: 20000,
      });
      return r.data?.data?.text || null;
    }
  },
  gpt5: {
    label: "🧠 GPT-5",
    call: async (axios, uid, msg, sys) => {
      const r = await axios.get("https://api-library-kohi.onrender.com/api/pollination-ai", {
        params: { prompt: sys + "\n\nUser: " + msg, model: "openai-large", user: uid },
        timeout: 20000,
      });
      return r.data?.data || null;
    }
  },
  aria: {
    label: "🤖 Aria AI",
    call: async (axios, uid, msg) => {
      const r = await axios.get("https://betadash-api-swordslush-production.up.railway.app/Aria", {
        params: { ask: msg, userid: uid },
        timeout: 20000,
      });
      return r.data?.message || r.data?.response || r.data?.reply || null;
    }
  },
  you: {
    label: "🔍 You.com",
    call: async (axios, uid, msg) => {
      const r = await axios.get("https://betadash-api-swordslush-production.up.railway.app/you", {
        params: { chat: msg },
        timeout: 20000,
      });
      return r.data?.message || r.data?.response || null;
    }
  },
  perplexity: {
    label: "💡 Perplexity",
    call: async (axios, uid, msg, sys) => {
      const r = await axios.get("https://api-library-kohi.onrender.com/api/pollination-ai", {
        params: { prompt: sys + "\n\nUser: " + msg, model: "perplexity-reasoning", user: uid + "_p" },
        timeout: 20000,
      });
      return r.data?.data || null;
    }
  },
  mistral: {
    label: "⚡ Mistral",
    call: async (axios, uid, msg, sys) => {
      const r = await axios.get("https://api-library-kohi.onrender.com/api/pollination-ai", {
        params: { prompt: sys + "\n\nUser: " + msg, model: "mistral", user: uid + "_m" },
        timeout: 20000,
      });
      return r.data?.data || null;
    }
  },
};

module.exports.run = async function ({ api, args }) {
  const action = args[0]?.toLowerCase();

  // Show list
  if (!action || action === "list") {
    const current = global.aiMode || "copilot";
    let msg = `🤖 AI Mode\n━━━━━━━━━━━━━━\n`;
    msg += `Current: ${AI_MODELS[current]?.label || current}\n\n`;
    msg += `Available models:\n`;
    Object.entries(AI_MODELS).forEach(([key, val]) => {
      msg += `${key === current ? "✅" : "▪️"} !aimode ${key} — ${val.label}\n`;
    });
    msg += `\nAuto mode tries all models in order.\n▪️ !aimode auto — Use all models as fallback`;
    return api.send(msg);
  }

  // Switch to auto
  if (action === "auto") {
    global.aiMode = "auto";
    global.aiModeModel = null;
    return api.send(`🔄 AI Mode: AUTO\nWill try all models in order until one responds.`);
  }

  // Switch to specific model
  if (AI_MODELS[action]) {
    global.aiMode = action;
    global.aiModeModel = AI_MODELS[action];
    return api.send(`✅ AI switched to ${AI_MODELS[action].label}\n\nAll messages will now use this model.\nType !aimode auto to go back to auto mode.`);
  }

  api.send(
    `❌ Unknown model "${action}".\n\n` +
    `Available: ${Object.keys(AI_MODELS).join(", ")}, auto\n\n` +
    `Type !aimode list to see all options.`
  );
};

// Export models and list so index.js can use them
module.exports.AI_MODELS = AI_MODELS;
