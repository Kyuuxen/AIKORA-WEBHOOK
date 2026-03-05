const axios = require("axios");
const fs    = require("fs");
const path  = require("path");

module.exports.config = {
  name:        "selfheal",
  description: "AI self-healing system — detects errors and auto-fixes commands via GitHub",
  usage:       "!selfheal status | on | off | log | fix [command]",
  category:    "Admin",
};

// ── Constants ─────────────────────────────────────────────────────────────────
const CMD_DIR    = path.join(__dirname);
const LOG_FILE   = path.join(__dirname, ".selfheal_log.json");
const MAX_LOG    = 50;
const MAX_FIXES  = 3; // max auto-fix attempts per command

// ── State ─────────────────────────────────────────────────────────────────────
if (!global.selfHealState) {
  global.selfHealState = {
    enabled:   true,
    totalFixed: 0,
    log:       [],
  };
}
const state = global.selfHealState;

// ── Load/Save log ─────────────────────────────────────────────────────────────
function loadLog() {
  try {
    if (fs.existsSync(LOG_FILE)) {
      const data = JSON.parse(fs.readFileSync(LOG_FILE, "utf8"));
      state.log        = data.log        || [];
      state.totalFixed = data.totalFixed || 0;
    }
  } catch(e) {}
}

function saveLog() {
  try {
    fs.writeFileSync(LOG_FILE, JSON.stringify({
      log:        state.log.slice(-MAX_LOG),
      totalFixed: state.totalFixed,
    }, null, 2));
  } catch(e) {}
}

loadLog();

// ── GitHub helpers ────────────────────────────────────────────────────────────
async function githubGet(filePath) {
  const token  = process.env.GITHUB_TOKEN;
  const repo   = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || "main";
  if (!token || !repo) throw new Error("GITHUB_TOKEN or GITHUB_REPO not set");

  const res = await axios.get(
    "https://api.github.com/repos/" + repo + "/contents/" + filePath,
    {
      headers: { Authorization: "Bearer " + token, "User-Agent": "AIKORA-SelfHeal" },
      params:  { ref: branch },
      timeout: 15000,
    }
  );
  return {
    content: Buffer.from(res.data.content, "base64").toString("utf8"),
    sha:     res.data.sha,
  };
}

async function githubPush(filePath, content, message, sha) {
  const token  = process.env.GITHUB_TOKEN;
  const repo   = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || "main";
  if (!token || !repo) throw new Error("GITHUB_TOKEN or GITHUB_REPO not set");

  const body = {
    message: message,
    content: Buffer.from(content).toString("base64"),
    branch:  branch,
  };
  if (sha) body.sha = sha;

  await axios.put(
    "https://api.github.com/repos/" + repo + "/contents/" + filePath,
    body,
    {
      headers: {
        Authorization:  "Bearer " + token,
        "User-Agent":   "AIKORA-SelfHeal",
        "Content-Type": "application/json",
      },
      timeout: 20000,
    }
  );
}

// ── AI fix using Pollinations ─────────────────────────────────────────────────
async function askAI(prompt) {
  const models = ["openai", "claude-hybridspace", "llama"];
  for (let i = 0; i < models.length; i++) {
    try {
      const res = await axios.post(
        "https://text.pollinations.ai/",
        {
          messages: [{ role: "user", content: prompt }],
          model:    models[i],
          seed:     Math.floor(Math.random() * 9999),
        },
        { headers: { "Content-Type": "application/json" }, timeout: 60000 }
      );
      const text = typeof res.data === "string" ? res.data : JSON.stringify(res.data);
      if (text && text.length > 100) return text;
    } catch(e) { console.log("[SelfHeal] AI model " + models[i] + " failed:", e.message); }
  }
  throw new Error("All AI models failed");
}

// ── Clean AI response to get pure code ───────────────────────────────────────
function cleanCode(raw) {
  let code = raw;
  code = code.replace(/```(?:javascript|js|node|json)?\n?/gi, "");
  code = code.replace(/```/gi, "");
  code = code.replace(/^Here(?:'s| is) the.*?\n/im, "");
  code = code.replace(/^Sure[!,].*?\n/im, "");
  code = code.replace(/^The (?:fixed|corrected).*?\n/im, "");
  const codeStart = code.search(/^(?:const|let|var|require|module\.exports|\/\/|async|function)/m);
  if (codeStart > 0) code = code.substring(codeStart);
  return code.trim();
}

// ── Hot reload a command ──────────────────────────────────────────────────────
function hotLoad(filePath) {
  try {
    delete require.cache[require.resolve(filePath)];
    const cmd = require(filePath);
    if (global.commands && cmd.config && cmd.config.name && typeof cmd.run === "function") {
      global.commands.set(cmd.config.name.toLowerCase(), cmd);
      return { success: true, name: cmd.config.name };
    }
    return { success: false, reason: "Invalid structure after fix" };
  } catch(err) {
    return { success: false, reason: err.message };
  }
}

// ── Main self-heal function ───────────────────────────────────────────────────
async function healCommand(cmdName, errorMessage, notifyFn) {
  if (!state.enabled) return;

  console.log("[SelfHeal] Healing: " + cmdName + " | Error: " + errorMessage);

  // Check fix attempts
  const existing = state.log.filter(function(l) {
    return l.cmd === cmdName && l.type === "fix" &&
      (Date.now() - new Date(l.time).getTime()) < 60 * 60 * 1000; // last 1 hour
  });

  if (existing.length >= MAX_FIXES) {
    console.log("[SelfHeal] Max fixes reached for: " + cmdName);
    if (notifyFn) notifyFn("⚠️ SelfHeal: Max fix attempts reached for !" + cmdName + ". Manual fix needed.");
    return;
  }

  // Find command file
  const filePath    = path.join(CMD_DIR, cmdName + ".js");
  const githubPath  = "modules/command/" + cmdName + ".js";

  if (!fs.existsSync(filePath)) {
    console.log("[SelfHeal] File not found:", filePath);
    return;
  }

  try {
    // Read broken code
    const brokenCode = fs.readFileSync(filePath, "utf8");

    if (notifyFn) notifyFn("🔧 SelfHeal: Detected error in !" + cmdName + "\n🤖 AI is fixing it...");

    // Ask AI to fix
    const prompt =
      "You are an expert Node.js debugger for a Facebook Messenger bot.\n\n" +
      "Fix this broken command file. The error is:\n" +
      "ERROR: " + errorMessage + "\n\n" +
      "RULES:\n" +
      "- Only use axios for HTTP requests\n" +
      "- Never use local imports (../utils, ../../config etc)\n" +
      "- Must have module.exports.config and module.exports.run\n" +
      "- Return ONLY the complete fixed JavaScript code, no markdown, no explanation\n\n" +
      "BROKEN CODE:\n" + brokenCode + "\n\n" +
      "Return the complete working fixed code:";

    const aiResponse = await askAI(prompt);
    const fixedCode  = cleanCode(aiResponse);

    // Validate fixed code
    if (!fixedCode.includes("module.exports.config") || !fixedCode.includes("module.exports.run")) {
      throw new Error("AI returned invalid code structure");
    }
    if (fixedCode.length < 150) {
      throw new Error("AI returned code too short");
    }

    // Write fixed file locally
    fs.writeFileSync(filePath, fixedCode, "utf8");

    // Hot reload
    const loaded = hotLoad(filePath);

    // Push to GitHub for persistence
    let githubSuccess = false;
    try {
      const { sha } = await githubGet(githubPath);
      await githubPush(
        githubPath,
        fixedCode,
        "🔧 SelfHeal: Auto-fixed " + cmdName + " — " + errorMessage.substring(0, 50),
        sha
      );
      githubSuccess = true;
    } catch(ghErr) {
      console.log("[SelfHeal] GitHub push failed:", ghErr.message);
    }

    // Log the fix
    state.totalFixed++;
    state.log.push({
      type:    "fix",
      cmd:     cmdName,
      error:   errorMessage.substring(0, 100),
      time:    new Date().toISOString(),
      github:  githubSuccess,
      loaded:  loaded.success,
    });
    saveLog();

    const msg =
      "✅ SelfHeal: Fixed !" + cmdName + "!\n" +
      "🐛 Error was: " + errorMessage.substring(0, 60) + "\n" +
      "🔄 Hot reloaded: " + (loaded.success ? "✅" : "❌") + "\n" +
      "☁️ GitHub synced: " + (githubSuccess ? "✅ Permanent fix" : "⚠️ Local only");

    console.log("[SelfHeal]", msg);
    if (notifyFn) notifyFn(msg);

  } catch(err) {
    console.log("[SelfHeal] Fix failed:", err.message);

    state.log.push({
      type:  "fail",
      cmd:   cmdName,
      error: err.message.substring(0, 100),
      time:  new Date().toISOString(),
    });
    saveLog();

    if (notifyFn) notifyFn("❌ SelfHeal: Could not fix !" + cmdName + "\nReason: " + err.message);
  }
}

// ── Attach error interceptor to all commands ──────────────────────────────────
function attachInterceptors(notifyFn) {
  if (!global.commands) return 0;
  let count = 0;

  global.commands.forEach(function(cmd, name) {
    if (!cmd._selfHealWrapped && typeof cmd.run === "function") {
      const originalRun = cmd.run;
      cmd.run = async function(ctx) {
        try {
          return await originalRun(ctx);
        } catch(err) {
          console.error("[SelfHeal] Error in !" + name + ":", err.message);

          // Log the error
          state.log.push({
            type:  "error",
            cmd:   name,
            error: err.message.substring(0, 100),
            time:  new Date().toISOString(),
          });
          saveLog();

          // Notify user
          try { ctx.api.send("⚠️ !" + name + " encountered an error. SelfHeal is fixing it..."); } catch(e) {}

          // Trigger heal
          healCommand(name, err.message, notifyFn);

          // Re-throw so bot knows it failed
          throw err;
        }
      };
      cmd._selfHealWrapped = true;
      count++;
    }
  });
  return count;
}

// ── Auto-start: attach interceptors after all commands load ───────────────────
setTimeout(function() {
  const count = attachInterceptors(function(msg) {
    console.log("[SelfHeal]", msg);
    // Notify admin if ADMIN_IDS set
    const adminId = (process.env.ADMIN_IDS || process.env.ADMIN_ID || "").split(",")[0].trim();
    if (adminId && global.bot && global.bot.sendMessage) {
      global.bot.sendMessage({ text: msg }, adminId);
    }
  });
  console.log("[SelfHeal] ✅ Monitoring " + count + " commands for errors.");
}, 5000); // wait 5s for all commands to load

// ── Command ───────────────────────────────────────────────────────────────────
module.exports.run = async function ({ api, args, event }) {
  const uid     = event.senderId;
  const ADMINS  = (process.env.ADMIN_IDS || process.env.ADMIN_ID || "").split(",").map(function(id) { return id.trim(); }).filter(Boolean);
  const isAdmin = ADMINS.length === 0 || ADMINS.includes(uid);

  if (!isAdmin) return api.send("⛔ Admins only!");

  const action = (args[0] || "status").toLowerCase();

  if (action === "status") {
    const errors = state.log.filter(function(l) { return l.type === "error"; }).length;
    const fixes  = state.log.filter(function(l) { return l.type === "fix"; }).length;
    const fails  = state.log.filter(function(l) { return l.type === "fail"; }).length;
    const cmdCount = global.commands ? global.commands.size : 0;
    return api.send(
      "🔧 SelfHeal Status\n━━━━━━━━━━━━━━\n" +
      "Status: "         + (state.enabled ? "🟢 Active" : "🔴 Disabled") + "\n" +
      "Monitoring: "     + cmdCount + " commands\n" +
      "Total errors: "   + errors + "\n" +
      "Total fixed: "    + fixes + "\n" +
      "Failed fixes: "   + fails + "\n" +
      "GitHub: "         + (process.env.GITHUB_TOKEN ? "✅ Connected" : "❌ Not set") + "\n" +
      "AI: Pollinations (3 models)"
    );
  }

  if (action === "on") {
    state.enabled = true;
    const count = attachInterceptors(function(msg) { api.send(msg); });
    return api.send("✅ SelfHeal enabled! Monitoring " + count + " commands.");
  }

  if (action === "off") {
    state.enabled = false;
    return api.send("🔴 SelfHeal disabled.");
  }

  if (action === "log") {
    if (!state.log.length) return api.send("📋 No events logged yet.");
    const recent = state.log.slice(-10).reverse();
    const lines  = recent.map(function(l) {
      const icon = l.type === "fix" ? "✅" : l.type === "fail" ? "❌" : "⚠️";
      const time = new Date(l.time).toLocaleTimeString();
      return icon + " [" + time + "] !" + l.cmd + " — " + l.error.substring(0, 40);
    });
    return api.send("📋 SelfHeal Log (last 10):\n━━━━━━━━━━━━━━\n" + lines.join("\n"));
  }

  if (action === "fix") {
    const cmdName = args[1] ? args[1].toLowerCase().replace("!", "") : null;
    if (!cmdName) return api.send("Usage: !selfheal fix [command name]");
    api.send("🔧 Manually triggering fix for !" + cmdName + "...");
    await healCommand(cmdName, "Manual fix requested", function(msg) { api.send(msg); });
    return;
  }

  if (action === "clear") {
    state.log = [];
    saveLog();
    return api.send("🔄 Log cleared!");
  }

  api.send(
    "🔧 SelfHeal Commands\n━━━━━━━━━━━━━━\n" +
    "!selfheal status     — Check status\n" +
    "!selfheal on         — Enable\n" +
    "!selfheal off        — Disable\n" +
    "!selfheal log        — View error log\n" +
    "!selfheal fix [cmd]  — Manually fix a command\n" +
    "!selfheal clear      — Clear log"
  );
};
