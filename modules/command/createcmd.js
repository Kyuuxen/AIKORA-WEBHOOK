"use strict";
const axios = require("axios");
const fs    = require("fs");
const path  = require("path");

module.exports.config = {
  name: "createcmd",
  description: "Ultra-advanced AI command builder with versioning, testing, multi-AI, and GitHub sync",
  usage: "!createcmd [action] ...",
  category: "Admin",
};

// ══════════════════════════════════════════════════════════════════════════════
// CONSTANTS & PATHS
// ══════════════════════════════════════════════════════════════════════════════
const CMD_FOLDER    = path.join(__dirname);
const DB_FILE       = path.join(__dirname, ".cmdbuilder_db.json");
const MAX_RETRIES   = 3;
const MAX_VERSIONS  = 5; // keep last 5 versions per command

// ══════════════════════════════════════════════════════════════════════════════
// DATABASE — stores commands, versions, stats, marketplace
// ══════════════════════════════════════════════════════════════════════════════
const DB = {
  _data: null,

  load() {
    if (this._data) return this._data;
    try {
      if (fs.existsSync(DB_FILE)) {
        this._data = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
        return this._data;
      }
    } catch {}
    this._data = { commands: {}, marketplace: [], stats: { created: 0, fixed: 0, deleted: 0 } };
    return this._data;
  },

  save() {
    try { fs.writeFileSync(DB_FILE, JSON.stringify(this._data, null, 2)); } catch {}
  },

  getCmd(name)     { return this.load().commands[name] || null; },
  getAllCmds()      { return this.load().commands; },
  getStats()       { return this.load().stats; },
  getMarketplace() { return this.load().marketplace || []; },

  saveCmd(name, data) {
    const db = this.load();
    db.commands[name] = data;
    this.save();
  },

  deleteCmd(name) {
    const db = this.load();
    delete db.commands[name];
    this.save();
  },

  addVersion(name, code) {
    const db  = this.load();
    const cmd = db.commands[name];
    if (!cmd) return;
    if (!cmd.versions) cmd.versions = [];
    cmd.versions.unshift({ code, savedAt: new Date().toISOString() });
    if (cmd.versions.length > MAX_VERSIONS) cmd.versions = cmd.versions.slice(0, MAX_VERSIONS);
    this.save();
  },

  incrementStat(key) {
    const db = this.load();
    db.stats[key] = (db.stats[key] || 0) + 1;
    this.save();
  },

  addToMarketplace(entry) {
    const db = this.load();
    if (!db.marketplace) db.marketplace = [];
    // remove old entry for same command
    db.marketplace = db.marketplace.filter(e => e.name !== entry.name);
    db.marketplace.unshift(entry);
    if (db.marketplace.length > 50) db.marketplace = db.marketplace.slice(0, 50);
    this.save();
  },
};

// ══════════════════════════════════════════════════════════════════════════════
// MULTI-AI ENGINE — tries multiple AI models for best result
// ══════════════════════════════════════════════════════════════════════════════
const AI_MODELS = [
  { name: "Copilot",    url: "https://api-library-kohi.onrender.com/api/copilot",          param: "prompt", model: "default",           dataPath: "data.text" },
  { name: "GPT-5",      url: "https://api-library-kohi.onrender.com/api/pollination-ai",   param: "prompt", model: "openai-large",       dataPath: "data"      },
  { name: "Perplexity", url: "https://api-library-kohi.onrender.com/api/pollination-ai",   param: "prompt", model: "perplexity-reasoning", dataPath: "data"    },
];

function extractData(res, dataPath) {
  return dataPath.split(".").reduce((obj, key) => obj?.[key], res.data) || "";
}

async function askAI(prompt, userId, modelIndex = 0) {
  const model = AI_MODELS[modelIndex % AI_MODELS.length];
  const params = { [model.param]: prompt, user: userId };
  if (model.model) params.model = model.model;

  const res = await axios.get(model.url, { params, timeout: 90000 });
  return { text: extractData(res, model.dataPath), modelName: model.name };
}

// ══════════════════════════════════════════════════════════════════════════════
// PROMPT BUILDER — specialized prompts for different tasks
// ══════════════════════════════════════════════════════════════════════════════
const Prompts = {
  create(cmdName, description, style = "standard") {
    const styles = {
      standard: "Make it clean and functional.",
      fun:      "Make it fun and playful with lots of emojis.",
      minimal:  "Make it very minimal and fast.",
      advanced: "Make it feature-rich with multiple sub-commands and options.",
    };

    return `You are an elite Facebook Messenger bot developer. Write a production-quality Node.js command file.

═══════════ STRICT RULES ═══════════
1. ONLY use "axios" for HTTP (pre-installed)
2. NEVER import: ../utils, ../../config, fs, path, sqlite3, or ANY local files
3. ALL errors must be caught and shown to user with api.send()
4. Return ONLY raw JavaScript — no markdown fences, no backticks, no explanation
5. Code MUST start with: const axios = require("axios"); OR module.exports

═══════════ TEMPLATE ═══════════
const axios = require("axios");

module.exports.config = {
  name: "${cmdName}",
  description: "WRITE_GOOD_DESCRIPTION",
  usage: "!${cmdName} [args]",
  category: "general",
};

module.exports.run = async function ({ api, args, event }) {
  const senderId = event.senderId;
  const input = args.join(" ").trim();
  
  // Guard: check if input is needed
  if (!input) return api.send("Usage: !${cmdName} [your input]");
  
  try {
    // Your logic here
    // api.send("reply") sends message to user
    // args[0], args[1] for individual arguments
  } catch (err) {
    api.send("❌ Something went wrong. Please try again.");
  }
};

═══════════ TASK ═══════════
Command name: "${cmdName}"
What it should do: ${description}
Style: ${styles[style] || styles.standard}

Use free public APIs (no API key). Format output nicely with emojis. Include input validation.`;
  },

  fix(cmdName, code, error) {
    return `You are an expert Node.js debugger. Fix this broken Facebook Messenger bot command.

ERROR: ${error}

RULES:
- Only use axios for HTTP
- Never use local imports (../utils, ../../config etc)
- Return ONLY the complete fixed JavaScript code, no markdown

BROKEN CODE:
${code}

Return the complete working fixed code:`;
  },

  improve(cmdName, code, suggestion) {
    return `You are an expert Node.js developer. Improve this Facebook Messenger bot command.

IMPROVEMENT REQUEST: ${suggestion}

RULES:
- Only use axios for HTTP  
- Never use local imports
- Keep the same command name: "${cmdName}"
- Return ONLY the improved JavaScript code, no markdown

CURRENT CODE:
${code}

Return the complete improved code:`;
  },

  explain(code) {
    return `Explain what this Facebook Messenger bot command does in simple terms.
List: what it does, what APIs it uses, what arguments it accepts, any limitations.
Keep it short — max 5 lines.

CODE:
${code}`;
  },
};

// ══════════════════════════════════════════════════════════════════════════════
// CODE UTILITIES
// ══════════════════════════════════════════════════════════════════════════════
function cleanCode(raw) {
  let code = raw;
  // Strip all markdown code blocks
  code = code.replace(/```(?:javascript|js|node|json)?\n?/gi, "");
  code = code.replace(/```/gi, "");
  // Strip common AI preamble
  code = code.replace(/^Here(?:'s| is) the.*?\n/im, "");
  code = code.replace(/^Sure[!,].*?\n/im, "");
  code = code.replace(/^This command.*?\n/im, "");
  code = code.replace(/^Below is.*?\n/im, "");
  // Find where actual code starts
  const codeStart = code.search(/^(?:const|let|var|require|module\.exports|\/\/|async|function)/m);
  if (codeStart > 0) code = code.substring(codeStart);
  return code.trim();
}

function validateCode(code, cmdName) {
  const errors = [];
  if (!code.includes("module.exports.config"))  errors.push("missing config export");
  if (!code.includes("module.exports.run"))     errors.push("missing run() export");
  // Accept both single and double quotes for name
  const hasName = code.includes(`name: "${cmdName}"`) || code.includes(`name: '${cmdName}'`);
  if (!hasName) errors.push("command name mismatch");
  if (/require\([\"\']\.\.\//.test(code))         errors.push("uses local imports");
  if (/require\([\"\']\.\.\/\.\.\//.test(code))   errors.push("uses config imports");
  if (code.length < 150)                         errors.push("code too short/incomplete");
  return errors;
}

function hotLoad(filePath) {
  try {
    delete require.cache[require.resolve(filePath)];
    const cmd = require(filePath);
    if (global.commands && cmd.config?.name && typeof cmd.run === "function") {
      global.commands.set(cmd.config.name.toLowerCase(), cmd);
      return { success: true, config: cmd.config };
    }
    return { success: false, reason: "invalid structure" };
  } catch (err) {
    return { success: false, reason: err.message };
  }
}

function sandboxTest(code, cmdName) {
  // Static analysis — check for common issues before saving
  const issues = [];
  const warnings = [];

  if (code.includes("process.exit"))       issues.push("contains process.exit()");
  if (code.includes("eval("))             issues.push("uses eval() — dangerous");
  if (code.includes("child_process"))     issues.push("uses child_process — not allowed");
  if (!code.includes("try"))              warnings.push("no error handling (try/catch)");
  if (!code.includes("api.send"))         issues.push("never calls api.send() — no output");
  if ((code.match(/api\.send/g) || []).length > 10) warnings.push("too many api.send() calls");
  if (code.includes("while(true)"))       issues.push("infinite loop detected");
  if (code.includes("while (true)"))      issues.push("infinite loop detected");
  if (code.includes("setInterval"))       warnings.push("uses setInterval — may cause issues");

  return { issues, warnings, safe: issues.length === 0 };
}

// ══════════════════════════════════════════════════════════════════════════════
// GITHUB SYNC — push generated command to GitHub repo
// ══════════════════════════════════════════════════════════════════════════════
async function pushToGitHub(cmdName, code) {
  const token  = process.env.GITHUB_TOKEN;
  const repo   = process.env.GITHUB_REPO;   // format: "username/repo-name"
  const branch = process.env.GITHUB_BRANCH || "main";

  if (!token || !repo) return { success: false, reason: "GITHUB_TOKEN or GITHUB_REPO not set" };

  const filePath = `modules/command/${cmdName}.js`;
  const apiUrl   = `https://api.github.com/repos/${repo}/contents/${filePath}`;

  try {
    // Check if file already exists (need SHA to update)
    let sha = null;
    try {
      const existing = await axios.get(apiUrl, {
        headers: { Authorization: `Bearer ${token}`, "User-Agent": "AIKORA-Bot" },
      });
      sha = existing.data.sha;
    } catch {}

    // Create or update file
    const body = {
      message: `feat: AI-generated command !${cmdName}`,
      content: Buffer.from(code).toString("base64"),
      branch,
    };
    if (sha) body.sha = sha;

    await axios.put(apiUrl, body, {
      headers: {
        Authorization:  `Bearer ${token}`,
        "User-Agent":   "AIKORA-Bot",
        "Content-Type": "application/json",
      },
    });

    return { success: true, url: `https://github.com/${repo}/blob/${branch}/${filePath}` };
  } catch (err) {
    return { success: false, reason: err.response?.data?.message || err.message };
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// CORE: GENERATE COMMAND WITH MULTI-AI + RETRIES
// ══════════════════════════════════════════════════════════════════════════════
async function generateCommand({ cmdName, description, style, userId, notify }) {
  let bestCode  = "";
  let modelUsed = "";

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const modelIndex = attempt - 1;
    const model      = AI_MODELS[modelIndex % AI_MODELS.length];

    notify(`🤖 Attempt ${attempt}/${MAX_RETRIES} using ${model.name}...`);

    try {
      const prompt        = Prompts.create(cmdName, description, style);
      const { text, modelName } = await askAI(prompt, userId, modelIndex);
      const code          = cleanCode(text);
      const validErrors   = validateCode(code, cmdName);
      const { issues, warnings, safe } = sandboxTest(code, cmdName);

      if (validErrors.length > 0) {
        notify(`⚠️ ${modelName}: Validation failed — ${validErrors.join(", ")}. Trying next model...`);
        continue;
      }

      if (!safe) {
        notify(`⚠️ ${modelName}: Security issues — ${issues.join(", ")}. Trying next model...`);
        continue;
      }

      if (warnings.length > 0) {
        notify(`⚠️ Warnings: ${warnings.join(", ")} (continuing anyway...)`);
      }

      bestCode  = code;
      modelUsed = modelName;
      break;

    } catch (err) {
      notify(`❌ ${model.name} failed: ${err.message}`);
    }
  }

  if (!bestCode) throw new Error("All AI models failed to generate valid code. Try rephrasing your description.");

  return { code: bestCode, modelUsed };
}

// ══════════════════════════════════════════════════════════════════════════════
// COMMAND HANDLER
// ══════════════════════════════════════════════════════════════════════════════
module.exports.run = async function ({ api, args, event }) {
  const senderId = event.senderId;
  const action   = args[0]?.toLowerCase();
  const notify   = (msg) => api.send(msg);

  // ── HELP ───────────────────────────────────────────────────────────────────
  if (!action) {
    return api.send(
      `⚡ AIKORA Command Builder Pro\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🆕 CREATE\n` +
      `!createcmd create [name] [desc]\n` +
      `!createcmd create [name] --style [fun|advanced|minimal] [desc]\n\n` +
      `📋 MANAGE\n` +
      `!createcmd list\n` +
      `!createcmd info [name]\n` +
      `!createcmd preview [name]\n` +
      `!createcmd delete [name]\n\n` +
      `✏️ IMPROVE\n` +
      `!createcmd edit [name] [new desc]\n` +
      `!createcmd improve [name] [suggestion]\n` +
      `!createcmd fix [name] [error]\n` +
      `!createcmd explain [name]\n\n` +
      `🕐 VERSIONS\n` +
      `!createcmd versions [name]\n` +
      `!createcmd rollback [name] [version#]\n\n` +
      `🏪 MARKETPLACE\n` +
      `!createcmd share [name]\n` +
      `!createcmd market\n` +
      `!createcmd install [name]\n\n` +
      `☁️ GITHUB\n` +
      `!createcmd push [name]\n` +
      `!createcmd pushall\n\n` +
      `📊 STATS\n` +
      `!createcmd stats`
    );
  }

  // ── CREATE ─────────────────────────────────────────────────────────────────
  if (action === "create") {
    if (args.length < 3) {
      return api.send(
        "Usage: !createcmd create [name] [description]\n\n" +
        "Styles (optional):\n" +
        "!createcmd create dog --style fun Random dog image\n" +
        "!createcmd create calc --style advanced Calculator with history\n\n" +
        "Examples:\n" +
        "• !createcmd create weather Get weather for any city\n" +
        "• !createcmd create meme Random meme from meme-api\n" +
        "• !createcmd create anime Random anime quote\n" +
        "• !createcmd create crypto Get crypto price\n" +
        "• !createcmd create trivia Random trivia with answer"
      );
    }

    let cmdName     = args[1].toLowerCase().replace(/[^a-z0-9]/g, "");
    let style       = "standard";
    let descStart   = 2;

    // Parse --style flag
    if (args[2] === "--style" && args[3]) {
      style     = args[3].toLowerCase();
      descStart = 4;
    }

    const description = args.slice(descStart).join(" ");

    if (!cmdName)            return api.send("❌ Invalid name. Use letters/numbers only.");
    if (cmdName.length > 20) return api.send("❌ Name too long (max 20 chars).");
    if (description.length < 5) return api.send("❌ Description too short. Be more specific.");

    const filePath = path.join(CMD_FOLDER, `${cmdName}.js`);
    if (fs.existsSync(filePath) && !DB.getCmd(cmdName)) {
      return api.send(`⚠️ "!${cmdName}" is a built-in command. Choose a different name.`);
    }

    api.send(
      `⚡ Building "!${cmdName}"\n` +
      `📝 Task: ${description}\n` +
      `🎨 Style: ${style}\n` +
      `━━━━━━━━━━━━━━\n` +
      `Trying up to ${MAX_RETRIES} AI models...\n` +
      `This may take 30-90 seconds...`
    );

    try {
      const { code, modelUsed } = await generateCommand({ cmdName, description, style, userId: senderId, notify });

      // Save version history
      const existing = DB.getCmd(cmdName);
      if (existing?.code) DB.addVersion(cmdName, existing.code);

      // Save to disk
      fs.writeFileSync(filePath, code, "utf8");

      // Save to DB
      DB.saveCmd(cmdName, {
        name:        cmdName,
        description,
        style,
        code,
        modelUsed,
        createdAt:   existing?.createdAt || new Date().toISOString(),
        updatedAt:   new Date().toISOString(),
        editCount:   (existing?.editCount || 0),
        versions:    existing?.versions || [],
        sharedAt:    existing?.sharedAt || null,
      });

      DB.incrementStat("created");

      // Hot-load
      const loaded = hotLoad(filePath);
      const { issues, warnings } = sandboxTest(code, cmdName);

      // Auto-push to GitHub if configured
      let githubMsg = "";
      if (process.env.GITHUB_TOKEN && process.env.GITHUB_REPO) {
        const ghResult = await pushToGitHub(cmdName, code);
        githubMsg = ghResult.success
          ? `\n☁️ GitHub: Pushed! ${ghResult.url}`
          : `\n☁️ GitHub: ${ghResult.reason}`;
      }

      api.send(
        `✅ "!${cmdName}" created!\n` +
        `━━━━━━━━━━━━━━\n` +
        `🤖 AI Model: ${modelUsed}\n` +
        `💾 Code size: ${code.split("\n").length} lines\n` +
        `🔥 Status: ${loaded.success ? "Live & ready!" : `Saved (${loaded.reason})`}\n` +
        (warnings.length ? `⚠️ Warnings: ${warnings.join(", ")}\n` : "") +
        githubMsg + `\n\n` +
        `Try it: !${cmdName}`
      );

    } catch (err) {
      api.send(`❌ Failed: ${err.message}\n\nTip: Try rephrasing your description more clearly.`);
    }
    return;
  }

  // ── LIST ───────────────────────────────────────────────────────────────────
  if (action === "list") {
    const all   = DB.getAllCmds();
    const names = Object.keys(all);
    if (!names.length) return api.send("📋 No AI commands yet.\nUse !createcmd create [name] [desc]");

    const cats = {};
    names.forEach(n => {
      const cat = all[n].style || "standard";
      if (!cats[cat]) cats[cat] = [];
      cats[cat].push(n);
    });

    let msg = `📋 AI Commands (${names.length} total)\n━━━━━━━━━━━━━━\n`;
    Object.entries(cats).forEach(([cat, cmds]) => {
      msg += `\n🎨 ${cat.toUpperCase()}\n`;
      cmds.forEach(n => {
        const loaded = global.commands?.has(n) ? "🟢" : "🔴";
        msg += `${loaded} !${n} — ${all[n].description.substring(0, 40)}\n`;
      });
    });
    msg += `\n🟢 = loaded  🔴 = not loaded`;
    return api.send(msg);
  }

  // ── INFO ───────────────────────────────────────────────────────────────────
  if (action === "info") {
    const cmdName = args[1]?.toLowerCase();
    if (!cmdName) return api.send("Usage: !createcmd info [name]");

    const entry    = DB.getCmd(cmdName);
    const filePath = path.join(CMD_FOLDER, `${cmdName}.js`);
    if (!entry && !fs.existsSync(filePath)) return api.send(`❌ "!${cmdName}" not found.`);

    const code     = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
    const { issues, warnings } = sandboxTest(code, cmdName);
    const loaded   = global.commands?.has(cmdName);

    return api.send(
      `📊 !${cmdName}\n` +
      `━━━━━━━━━━━━━━\n` +
      `📝 ${entry?.description || "built-in"}\n` +
      `🤖 AI: ${entry?.modelUsed || "unknown"}\n` +
      `🎨 Style: ${entry?.style || "standard"}\n` +
      `📅 Created: ${entry?.createdAt ? new Date(entry.createdAt).toLocaleString() : "unknown"}\n` +
      `🔄 Last updated: ${entry?.updatedAt ? new Date(entry.updatedAt).toLocaleString() : "unknown"}\n` +
      `✏️ Edits: ${entry?.editCount || 0}\n` +
      `🕐 Saved versions: ${entry?.versions?.length || 0}\n` +
      `💾 Lines: ${code.split("\n").length}\n` +
      `🔥 Loaded: ${loaded ? "✅" : "❌"}\n` +
      `🛡️ Issues: ${issues.length ? issues.join(", ") : "none"}\n` +
      `⚠️ Warnings: ${warnings.length ? warnings.join(", ") : "none"}\n` +
      `🌐 Shared: ${entry?.sharedAt ? "✅" : "❌"}`
    );
  }

  // ── PREVIEW ────────────────────────────────────────────────────────────────
  if (action === "preview") {
    const cmdName = args[1]?.toLowerCase();
    if (!cmdName) return api.send("Usage: !createcmd preview [name]");

    const filePath = path.join(CMD_FOLDER, `${cmdName}.js`);
    if (!fs.existsSync(filePath)) return api.send(`❌ "!${cmdName}" not found.`);

    const code    = fs.readFileSync(filePath, "utf8");
    const lines   = code.split("\n").length;
    const preview = lines > 30
      ? code.split("\n").slice(0, 30).join("\n") + `\n... (${lines - 30} more lines)`
      : code;

    return api.send(`👁️ !${cmdName} (${lines} lines)\n━━━━━━━━━━━━━━\n${preview}`);
  }

  // ── EXPLAIN ────────────────────────────────────────────────────────────────
  if (action === "explain") {
    const cmdName = args[1]?.toLowerCase();
    if (!cmdName) return api.send("Usage: !createcmd explain [name]");

    const filePath = path.join(CMD_FOLDER, `${cmdName}.js`);
    if (!fs.existsSync(filePath)) return api.send(`❌ "!${cmdName}" not found.`);

    const code = fs.readFileSync(filePath, "utf8");
    api.send(`🔍 Analyzing !${cmdName}...`);

    try {
      const { text } = await askAI(Prompts.explain(code), senderId);
      api.send(`🔍 !${cmdName} explained:\n━━━━━━━━━━━━━━\n${cleanCode(text)}`);
    } catch {
      api.send("❌ Could not explain command.");
    }
    return;
  }

  // ── EDIT ───────────────────────────────────────────────────────────────────
  if (action === "edit") {
    if (args.length < 3) return api.send("Usage: !createcmd edit [name] [new description]");

    const cmdName     = args[1].toLowerCase();
    const description = args.slice(2).join(" ");
    const filePath    = path.join(CMD_FOLDER, `${cmdName}.js`);

    if (!fs.existsSync(filePath)) return api.send(`❌ "!${cmdName}" not found.`);

    const existing = DB.getCmd(cmdName);
    if (existing?.code) DB.addVersion(cmdName, existing.code);

    api.send(`✏️ Regenerating "!${cmdName}"...\nThis may take 30-90 seconds...`);

    try {
      const style = existing?.style || "standard";
      const { code, modelUsed } = await generateCommand({ cmdName, description, style, userId: senderId, notify });

      fs.writeFileSync(filePath, code, "utf8");
      DB.saveCmd(cmdName, {
        ...existing,
        description,
        code,
        modelUsed,
        updatedAt:  new Date().toISOString(),
        editCount:  (existing?.editCount || 0) + 1,
      });

      const loaded = hotLoad(filePath);

      // Auto push
      let ghMsg = "";
      if (process.env.GITHUB_TOKEN && process.env.GITHUB_REPO) {
        const gh = await pushToGitHub(cmdName, code);
        ghMsg = gh.success ? "\n☁️ GitHub: Synced!" : `\n☁️ GitHub: ${gh.reason}`;
      }

      api.send(
        `✅ "!${cmdName}" updated!\n` +
        `🤖 AI: ${modelUsed}\n` +
        `🔥 Status: ${loaded.success ? "Reloaded!" : loaded.reason}` +
        ghMsg
      );
    } catch (err) {
      api.send(`❌ Edit failed: ${err.message}`);
    }
    return;
  }

  // ── IMPROVE ────────────────────────────────────────────────────────────────
  if (action === "improve") {
    if (args.length < 3) return api.send("Usage: !createcmd improve [name] [what to improve]\nExample: !createcmd improve weather add humidity and wind speed to output");

    const cmdName    = args[1].toLowerCase();
    const suggestion = args.slice(2).join(" ");
    const filePath   = path.join(CMD_FOLDER, `${cmdName}.js`);

    if (!fs.existsSync(filePath)) return api.send(`❌ "!${cmdName}" not found.`);

    const code     = fs.readFileSync(filePath, "utf8");
    const existing = DB.getCmd(cmdName);
    if (code) DB.addVersion(cmdName, code);

    api.send(`🚀 Improving "!${cmdName}"...\nSuggestion: ${suggestion}`);

    try {
      const { text, modelName } = await askAI(Prompts.improve(cmdName, code, suggestion), senderId);
      const improved = cleanCode(text);

      const errors = validateCode(improved, cmdName);
      if (errors.length) return api.send(`❌ AI returned invalid code: ${errors.join(", ")}`);

      const { safe, issues } = sandboxTest(improved, cmdName);
      if (!safe) return api.send(`❌ Security issues: ${issues.join(", ")}`);

      fs.writeFileSync(filePath, improved, "utf8");
      DB.saveCmd(cmdName, { ...existing, code: improved, modelUsed: modelName, updatedAt: new Date().toISOString(), editCount: (existing?.editCount || 0) + 1 });

      const loaded = hotLoad(filePath);
      api.send(`✅ "!${cmdName}" improved!\n🤖 ${modelName}\n🔥 ${loaded.success ? "Reloaded!" : loaded.reason}`);
    } catch (err) {
      api.send(`❌ Improve failed: ${err.message}`);
    }
    return;
  }

  // ── FIX ────────────────────────────────────────────────────────────────────
  if (action === "fix") {
    if (args.length < 2) return api.send("Usage: !createcmd fix [name] [error description]");

    const cmdName  = args[1].toLowerCase();
    const errorMsg = args.slice(2).join(" ") || "runtime error or unexpected behavior";
    const filePath = path.join(CMD_FOLDER, `${cmdName}.js`);

    if (!fs.existsSync(filePath)) return api.send(`❌ "!${cmdName}" not found.`);

    const code = fs.readFileSync(filePath, "utf8");
    DB.addVersion(cmdName, code);

    api.send(`🔧 Fixing "!${cmdName}"...\nError: ${errorMsg}`);

    try {
      for (let i = 0; i < AI_MODELS.length; i++) {
        const { text, modelName } = await askAI(Prompts.fix(cmdName, code, errorMsg), senderId, i);
        const fixed  = cleanCode(text);
        const errors = validateCode(fixed, cmdName);

        if (errors.length) { notify(`⚠️ ${modelName} fix invalid: ${errors.join(", ")}`); continue; }

        const { safe, issues } = sandboxTest(fixed, cmdName);
        if (!safe) { notify(`⚠️ ${modelName} fix unsafe: ${issues.join(", ")}`); continue; }

        fs.writeFileSync(filePath, fixed, "utf8");
        DB.incrementStat("fixed");

        const loaded = hotLoad(filePath);
        api.send(`✅ "!${cmdName}" fixed by ${modelName}!\n🔥 ${loaded.success ? "Reloaded!" : loaded.reason}`);
        return;
      }
      api.send("❌ All models failed to fix. Try describing the error more specifically.");
    } catch (err) {
      api.send(`❌ Fix failed: ${err.message}`);
    }
    return;
  }

  // ── VERSIONS ───────────────────────────────────────────────────────────────
  if (action === "versions") {
    const cmdName = args[1]?.toLowerCase();
    if (!cmdName) return api.send("Usage: !createcmd versions [name]");

    const entry = DB.getCmd(cmdName);
    if (!entry) return api.send(`❌ "!${cmdName}" not found.`);

    const versions = entry.versions || [];
    if (!versions.length) return api.send(`📦 No saved versions for "!${cmdName}" yet.`);

    let msg = `🕐 Versions of !${cmdName} (${versions.length})\n━━━━━━━━━━━━━━\n`;
    versions.forEach((v, i) => {
      const date  = new Date(v.savedAt).toLocaleString();
      const lines = v.code.split("\n").length;
      msg += `${i + 1}. ${date} — ${lines} lines\n`;
    });
    msg += `\nUse !createcmd rollback ${cmdName} [#] to restore`;
    return api.send(msg);
  }

  // ── ROLLBACK ───────────────────────────────────────────────────────────────
  if (action === "rollback") {
    const cmdName = args[1]?.toLowerCase();
    const vNum    = parseInt(args[2]) - 1;

    if (!cmdName || isNaN(vNum)) return api.send("Usage: !createcmd rollback [name] [version#]");

    const entry    = DB.getCmd(cmdName);
    const versions = entry?.versions || [];

    if (!versions[vNum]) return api.send(`❌ Version ${vNum + 1} not found. Use !createcmd versions ${cmdName}`);

    const filePath   = path.join(CMD_FOLDER, `${cmdName}.js`);
    const oldCode    = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
    if (oldCode) DB.addVersion(cmdName, oldCode);

    const restoreCode = versions[vNum].code;
    fs.writeFileSync(filePath, restoreCode, "utf8");

    const loaded = hotLoad(filePath);
    api.send(`⏮️ "!${cmdName}" rolled back to version ${vNum + 1}!\n🔥 ${loaded.success ? "Reloaded!" : loaded.reason}`);
    return;
  }

  // ── SHARE to marketplace ───────────────────────────────────────────────────
  if (action === "share") {
    const cmdName = args[1]?.toLowerCase();
    if (!cmdName) return api.send("Usage: !createcmd share [name]");

    const entry    = DB.getCmd(cmdName);
    const filePath = path.join(CMD_FOLDER, `${cmdName}.js`);

    if (!entry || !fs.existsSync(filePath)) return api.send(`❌ "!${cmdName}" not found.`);

    const code = fs.readFileSync(filePath, "utf8");
    DB.addToMarketplace({
      name:        cmdName,
      description: entry.description,
      code,
      style:       entry.style,
      modelUsed:   entry.modelUsed,
      sharedAt:    new Date().toISOString(),
    });

    entry.sharedAt = new Date().toISOString();
    DB.saveCmd(cmdName, entry);

    api.send(`🌐 "!${cmdName}" shared to marketplace!\nOthers can install it with: !createcmd install ${cmdName}`);
    return;
  }

  // ── MARKETPLACE ────────────────────────────────────────────────────────────
  if (action === "market") {
    const market = DB.getMarketplace();
    if (!market.length) return api.send("🏪 Marketplace is empty.\nShare commands with: !createcmd share [name]");

    let msg = `🏪 Command Marketplace (${market.length})\n━━━━━━━━━━━━━━\n`;
    market.slice(0, 10).forEach((entry, i) => {
      const date = new Date(entry.sharedAt).toLocaleDateString();
      msg += `${i + 1}. !${entry.name} [${entry.style || "standard"}]\n   📝 ${entry.description.substring(0, 50)}\n   📅 ${date}\n\n`;
    });
    msg += `Install: !createcmd install [name]`;
    return api.send(msg);
  }

  // ── INSTALL from marketplace ───────────────────────────────────────────────
  if (action === "install") {
    const cmdName = args[1]?.toLowerCase();
    if (!cmdName) return api.send("Usage: !createcmd install [name]");

    const market = DB.getMarketplace();
    const entry  = market.find(e => e.name === cmdName);

    if (!entry) return api.send(`❌ "!${cmdName}" not found in marketplace.\nUse !createcmd market to see available commands.`);

    const filePath = path.join(CMD_FOLDER, `${cmdName}.js`);
    fs.writeFileSync(filePath, entry.code, "utf8");
    DB.saveCmd(cmdName, { ...entry, createdAt: new Date().toISOString(), editCount: 0 });

    const loaded = hotLoad(filePath);
    api.send(`📦 "!${cmdName}" installed from marketplace!\n🔥 ${loaded.success ? "Ready to use!" : loaded.reason}`);
    return;
  }

  // ── PUSH to GitHub ─────────────────────────────────────────────────────────
  if (action === "push") {
    const cmdName = args[1]?.toLowerCase();
    if (!cmdName) return api.send("Usage: !createcmd push [name]\n\nRequires in Render env:\n• GITHUB_TOKEN\n• GITHUB_REPO (username/repo)");

    const filePath = path.join(CMD_FOLDER, `${cmdName}.js`);
    if (!fs.existsSync(filePath)) return api.send(`❌ "!${cmdName}" not found.`);

    const code = fs.readFileSync(filePath, "utf8");
    api.send(`☁️ Pushing "!${cmdName}" to GitHub...`);

    const result = await pushToGitHub(cmdName, code);
    api.send(result.success
      ? `✅ Pushed!\n🔗 ${result.url}`
      : `❌ Push failed: ${result.reason}`
    );
    return;
  }

  // ── PUSH ALL to GitHub ────────────────────────────────────────────────────
  if (action === "pushall") {
    const all   = DB.getAllCmds();
    const names = Object.keys(all);
    if (!names.length) return api.send("No AI commands to push.");

    api.send(`☁️ Pushing ${names.length} commands to GitHub...`);
    let success = 0, failed = 0;

    for (const name of names) {
      const fp = path.join(CMD_FOLDER, `${name}.js`);
      if (!fs.existsSync(fp)) continue;
      const code   = fs.readFileSync(fp, "utf8");
      const result = await pushToGitHub(name, code);
      result.success ? success++ : failed++;
    }

    api.send(`☁️ GitHub push complete!\n✅ Success: ${success}\n❌ Failed: ${failed}`);
    return;
  }

  // ── DELETE ─────────────────────────────────────────────────────────────────
  if (action === "delete") {
    const cmdName = args[1]?.toLowerCase();
    if (!cmdName) return api.send("Usage: !createcmd delete [name]");

    if (!DB.getCmd(cmdName)) return api.send(`⛔ Can only delete AI-generated commands.\n"!${cmdName}" is built-in.`);

    const filePath = path.join(CMD_FOLDER, `${cmdName}.js`);
    if (!fs.existsSync(filePath)) return api.send(`❌ "!${cmdName}" not found.`);

    fs.unlinkSync(filePath);
    DB.deleteCmd(cmdName);
    DB.incrementStat("deleted");
    if (global.commands) global.commands.delete(cmdName);

    api.send(`🗑️ "!${cmdName}" deleted.`);
    return;
  }

  // ── STATS ──────────────────────────────────────────────────────────────────
  if (action === "stats") {
    const stats  = DB.getStats();
    const all    = DB.getAllCmds();
    const loaded = Object.keys(all).filter(n => global.commands?.has(n)).length;

    return api.send(
      `📊 Command Builder Stats\n` +
      `━━━━━━━━━━━━━━\n` +
      `✅ Total created: ${stats.created || 0}\n` +
      `🔧 Total fixed: ${stats.fixed || 0}\n` +
      `🗑️ Total deleted: ${stats.deleted || 0}\n` +
      `📦 Currently saved: ${Object.keys(all).length}\n` +
      `🔥 Currently loaded: ${loaded}\n` +
      `🏪 In marketplace: ${DB.getMarketplace().length}\n` +
      `☁️ GitHub sync: ${process.env.GITHUB_TOKEN ? "✅ Configured" : "❌ Not set"}`
    );
  }

  // ── Unknown ────────────────────────────────────────────────────────────────
  api.send(`❓ Unknown action "${action}".\nType !createcmd for help.`);
};
