const axios = require("axios");

module.exports.config = {
  name:        "aimode",
  description: "Claude AI with GitHub repo awareness — knows all your bot commands",
  usage:       "!aimode [model] | list | reload",
  category:    "Admin",
};

// ── Cache for GitHub commands list ────────────────────────────────────────────
if (!global.aiBotContext) {
  global.aiBotContext = {
    commands:    null,
    lastFetched: null,
  };
}

// ── Fetch commands list from GitHub ──────────────────────────────────────────
async function fetchCommandsFromGitHub() {
  const token  = process.env.GITHUB_TOKEN;
  const repo   = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || "main";
  if (!token || !repo) return null;

  try {
    const res = await axios.get(
      "https://api.github.com/repos/" + repo + "/contents/modules/command",
      {
        headers: { Authorization: "Bearer " + token, "User-Agent": "AIKORA-Bot" },
        params:  { ref: branch },
        timeout: 15000,
      }
    );

    const files = (res.data || [])
      .filter(function(f) { return f.name.endsWith(".js"); })
      .map(function(f) { return f.name.replace(".js", ""); });

    console.log("[AIMode] Fetched " + files.length + " commands from GitHub");
    return files;
  } catch(e) {
    console.log("[AIMode] GitHub fetch failed:", e.message);
    return null;
  }
}

// ── Get commands list (cached for 10 mins) ────────────────────────────────────
async function getCommands() {
  const now = Date.now();
  if (
    global.aiBotContext.commands &&
    global.aiBotContext.lastFetched &&
    now - global.aiBotContext.lastFetched < 10 * 60 * 1000
  ) {
    return global.aiBotContext.commands;
  }

  // Also get loaded commands from global.commands
  const loaded = global.commands
    ? Array.from(global.commands.keys())
    : [];

  // Fetch from GitHub
  const github = await fetchCommandsFromGitHub();

  // Merge both lists
  const merged = Array.from(new Set([...loaded, ...(github || [])])).sort();
  global.aiBotContext.commands    = merged;
  global.aiBotContext.lastFetched = now;
  return merged;
}

// ── Build system prompt with bot context ─────────────────────────────────────
async function buildSystemPrompt() {
  const commands = await getCommands();
  const prefix   = process.env.PREFIX || "!";
  const botName  = process.env.BOTNAME || "AIKORA";

  const cmdList = commands.length
    ? commands.map(function(c) { return prefix + c; }).join(", ")
    : "unknown";

  return (
    "You are " + botName + ", an AI-powered Facebook Messenger bot assistant.\n\n" +
    "AVAILABLE COMMANDS IN THIS BOT:\n" +
    cmdList + "\n\n" +
    "RULES:\n" +
    "- If a user asks if a command exists, check the list above and answer accurately\n" +
    "- If a user asks what you can do, list relevant commands from above\n" +
    "- Keep responses short and friendly\n" +
    "- Use Taglish (mix of Tagalog and English) when appropriate\n" +
    "- You are helpful, witty, and fun\n" +
    "- Never make up commands that don't exist in the list above\n" +
    "- If asked about a command not in the list, say it doesn't exist yet\n"
  );
}

// ── Claude AI ─────────────────────────────────────────────────────────────────
const AI_MODELS = {
  claude: {
    label: "🧠 Claude (Anthropic)",
    call: async function(uid, msg, systemPrompt) {
      const res = await axios.post(
        "https://text.pollinations.ai/",
        {
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user",   content: msg },
          ],
          model: "claude-hybridspace",
          seed:  Math.floor(Math.random() * 9999),
        },
        { headers: { "Content-Type": "application/json" }, timeout: 30000 }
      );
      const text = typeof res.data === "string" ? res.data : JSON.stringify(res.data);
      return text && text.length > 2 ? text : null;
    },
  },
};

// ── Always use Claude ─────────────────────────────────────────────────────────
global.aiMode      = "claude";
global.aiModeModel = AI_MODELS["claude"];
console.log("[AIMode] Claude AI ready");

// ── Pre-load commands on startup ──────────────────────────────────────────────
setTimeout(function() {
  getCommands().then(function(cmds) {
    console.log("[AIMode] Pre-loaded " + cmds.length + " commands for bot context");
  });
}, 8000);

// ── Command ───────────────────────────────────────────────────────────────────
module.exports.run = async function ({ api, args, event }) {
  const uid    = event.senderId;
  const action = (args[0] || "list").toLowerCase();

  if (action === "list") {
    const current = global.aiMode || "claude";
    const cmds    = await getCommands();
    let msg = "🤖 AI Mode\n━━━━━━━━━━━━━━\n";
    msg += "Current: " + (AI_MODELS[current] ? AI_MODELS[current].label : current) + "\n";
    msg += "Bot commands loaded: " + cmds.length + "\n\n";
    msg += "Model: " + AI_MODELS["claude"].label + " ✅\n";
    return api.send(msg);
  }

  if (action === "reload") {
    global.aiBotContext.commands    = null;
    global.aiBotContext.lastFetched = null;
    const cmds = await getCommands();
    return api.send("🔄 Reloaded " + cmds.length + " commands from GitHub!\n\nCommands: " + cmds.slice(0, 20).join(", ") + (cmds.length > 20 ? "..." : ""));
  }

  if (action === "commands") {
    const cmds = await getCommands();
    const prefix = process.env.PREFIX || "!";
    return api.send("📋 Bot Commands (" + cmds.length + " total):\n━━━━━━━━━━━━━━\n" + cmds.map(function(c){ return prefix + c; }).join(", "));
  }

  api.send(
    "ℹ️ Only Claude is available.\n\n" +
    "!aimode list     — Show status\n" +
    "!aimode reload   — Reload commands from GitHub\n" +
    "!aimode commands — Show all bot commands"
  );
};

// ── Export for index.js to use ────────────────────────────────────────────────
module.exports.AI_MODELS       = AI_MODELS;
module.exports.buildSystemPrompt = buildSystemPrompt;
module.exports.getCommands     = getCommands;
