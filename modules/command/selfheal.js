const axios = require("axios");
const fs    = require("fs");
const path  = require("path");

module.exports.config = {
  name:        "selfheal",
  description: "AI self-healing system with logic test cases — detects and fixes commands automatically",
  usage:       "!selfheal status | on | off | log | fix [cmd] | addtest [cmd] | tests",
  category:    "Admin",
};

// ── Constants ─────────────────────────────────────────────────────────────────
const CMD_DIR   = path.join(__dirname);
const LOG_FILE  = path.join(__dirname, ".selfheal_log.json");
const TEST_FILE = path.join(__dirname, ".selfheal_tests.json");
const MAX_LOG   = 50;
const MAX_TRIES = 5; // max AI fix attempts per session

// ── Built-in test cases for common commands ───────────────────────────────────
const DEFAULT_TESTS = {
  "quiz": {
    desc:    "Must contain question and multiple choice answer",
    checks:  ["QUESTION:", "A:", "B:", "C:", "D:", "ANSWER:"],
    mustNot: ["Could not parse", "undefined", "null"],
  },
  "anime": {
    desc:    "Must return anime info",
    checks:  ["Title", "Rating"],
    mustNot: ["error", "undefined"],
  },
  "autonews": {
    desc:    "Must have config and run",
    checks:  ["module.exports.config", "module.exports.run"],
    mustNot: [],
  },
  "autoreact": {
    desc:    "Must have config and run",
    checks:  ["module.exports.config", "module.exports.run"],
    mustNot: [],
  },
};

// ── State ─────────────────────────────────────────────────────────────────────
if (!global.selfHealState) {
  global.selfHealState = {
    enabled:    true,
    totalFixed: 0,
    totalFails: 0,
    log:        [],
    tests:      {},
  };
}
const state = global.selfHealState;

// ── Load/Save ─────────────────────────────────────────────────────────────────
function loadData() {
  try {
    if (fs.existsSync(LOG_FILE)) {
      const d = JSON.parse(fs.readFileSync(LOG_FILE, "utf8"));
      state.log        = d.log        || [];
      state.totalFixed = d.totalFixed || 0;
      state.totalFails = d.totalFails || 0;
    }
  } catch(e) {}
  try {
    if (fs.existsSync(TEST_FILE)) {
      state.tests = JSON.parse(fs.readFileSync(TEST_FILE, "utf8"));
    } else {
      state.tests = Object.assign({}, DEFAULT_TESTS);
      fs.writeFileSync(TEST_FILE, JSON.stringify(state.tests, null, 2));
    }
  } catch(e) { state.tests = Object.assign({}, DEFAULT_TESTS); }
}

function saveLog() {
  try { fs.writeFileSync(LOG_FILE, JSON.stringify({ log: state.log.slice(-MAX_LOG), totalFixed: state.totalFixed, totalFails: state.totalFails }, null, 2)); } catch(e) {}
}

function saveTests() {
  try { fs.writeFileSync(TEST_FILE, JSON.stringify(state.tests, null, 2)); } catch(e) {}
}

loadData();

// ── GitHub helpers ────────────────────────────────────────────────────────────
async function githubGet(filePath) {
  const token  = process.env.GITHUB_TOKEN;
  const repo   = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || "main";
  if (!token || !repo) throw new Error("GITHUB_TOKEN or GITHUB_REPO not set");
  const res = await axios.get(
    "https://api.github.com/repos/" + repo + "/contents/" + filePath,
    { headers: { Authorization: "Bearer " + token, "User-Agent": "AIKORA-SelfHeal" }, params: { ref: branch }, timeout: 15000 }
  );
  return { content: Buffer.from(res.data.content, "base64").toString("utf8"), sha: res.data.sha };
}

async function githubPush(filePath, content, message, sha) {
  const token  = process.env.GITHUB_TOKEN;
  const repo   = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || "main";
  if (!token || !repo) throw new Error("GITHUB_TOKEN or GITHUB_REPO not set");
  const body = { message: message, content: Buffer.from(content).toString("base64"), branch: branch };
  if (sha) body.sha = sha;
  await axios.put(
    "https://api.github.com/repos/" + repo + "/contents/" + filePath,
    body,
    { headers: { Authorization: "Bearer " + token, "User-Agent": "AIKORA-SelfHeal", "Content-Type": "application/json" }, timeout: 20000 }
  );
}

// ── AI helper ─────────────────────────────────────────────────────────────────
async function askAI(prompt) {
  const models = ["openai", "claude-hybridspace", "llama", "mistral"];
  for (let i = 0; i < models.length; i++) {
    try {
      const res = await axios.post(
        "https://text.pollinations.ai/",
        { messages: [{ role: "user", content: prompt }], model: models[i], seed: Math.floor(Math.random() * 9999) },
        { headers: { "Content-Type": "application/json" }, timeout: 60000 }
      );
      const text = typeof res.data === "string" ? res.data : JSON.stringify(res.data);
      if (text && text.length > 100) return { text: text, model: models[i] };
    } catch(e) { console.log("[SelfHeal] AI " + models[i] + " failed:", e.message); }
  }
  throw new Error("All AI models failed");
}

// ── Clean AI response ─────────────────────────────────────────────────────────
function cleanCode(raw) {
  let code = raw;
  code = code.replace(/```(?:javascript|js|node|json)?\n?/gi, "");
  code = code.replace(/```/gi, "");
  code = code.replace(/^Here(?:'s| is) the.*?\n/im, "");
  code = code.replace(/^Sure[!,].*?\n/im, "");
  code = code.replace(/^The (?:fixed|corrected|updated).*?\n/im, "");
  const start = code.search(/^(?:const|let|var|require|module\.exports|\/\/|async|function)/m);
  if (start > 0) code = code.substring(start);
  return code.trim();
}

// ── Run test cases against code ───────────────────────────────────────────────
function runTests(cmdName, code) {
  const test = state.tests[cmdName];
  if (!test) return { passed: true, reason: "No tests defined" };

  const failures = [];

  // Check required strings
  if (test.checks) {
    for (let i = 0; i < test.checks.length; i++) {
      if (!code.includes(test.checks[i])) {
        failures.push("Missing required: \"" + test.checks[i] + "\"");
      }
    }
  }

  // Check forbidden strings
  if (test.mustNot) {
    for (let i = 0; i < test.mustNot.length; i++) {
      if (code.toLowerCase().includes(test.mustNot[i].toLowerCase())) {
        failures.push("Contains forbidden: \"" + test.mustNot[i] + "\"");
      }
    }
  }

  // Always check basic structure
  if (!code.includes("module.exports.config")) failures.push("Missing module.exports.config");
  if (!code.includes("module.exports.run"))    failures.push("Missing module.exports.run");
  if (code.length < 200)                        failures.push("Code too short (" + code.length + " chars)");

  return {
    passed:   failures.length === 0,
    failures: failures,
    reason:   failures.join(", "),
  };
}

// ── Hot reload ────────────────────────────────────────────────────────────────
function hotLoad(filePath) {
  try {
    delete require.cache[require.resolve(filePath)];
    const cmd = require(filePath);
    if (global.commands && cmd.config && cmd.config.name && typeof cmd.run === "function") {
      global.commands.set(cmd.config.name.toLowerCase(), cmd);
      return { success: true, name: cmd.config.name };
    }
    return { success: false, reason: "Invalid structure" };
  } catch(err) { return { success: false, reason: err.message }; }
}

// ── Main heal function with test loop ─────────────────────────────────────────
async function healCommand(cmdName, errorMessage, notifyFn) {
  if (!state.enabled) return;

  const filePath   = path.join(CMD_DIR, cmdName + ".js");
  const githubPath = "modules/command/" + cmdName + ".js";

  if (!fs.existsSync(filePath)) {
    notifyFn && notifyFn("❌ SelfHeal: File not found — " + cmdName + ".js");
    return;
  }

  const originalCode = fs.readFileSync(filePath, "utf8");
  const test         = state.tests[cmdName];
  const hasTests     = test && (test.checks || test.mustNot);

  notifyFn && notifyFn(
    "🔧 SelfHeal: Fixing !" + cmdName + "\n" +
    "🐛 Error: " + errorMessage.substring(0, 60) + "\n" +
    "🧪 Tests: " + (hasTests ? test.desc || "Custom tests" : "Basic structure only") + "\n" +
    "🤖 Starting AI fix loop..."
  );

  let lastCode  = originalCode;
  let lastError = errorMessage;
  let fixed     = false;
  let attempt   = 0;

  while (attempt < MAX_TRIES && !fixed) {
    attempt++;
    notifyFn && notifyFn("🔄 Fix attempt " + attempt + "/" + MAX_TRIES + "...");

    try {
      // Build smart prompt based on test failures
      const testResult = runTests(cmdName, lastCode);
      const testInfo   = testResult.passed
        ? "The code passes structural tests but has a runtime error."
        : "The code FAILS these tests:\n" + testResult.failures.map(function(f){ return "  - " + f; }).join("\n");

      const prompt =
        "You are an expert Node.js developer fixing a Facebook Messenger bot command.\n\n" +
        "COMMAND NAME: " + cmdName + "\n" +
        "ERROR: " + lastError + "\n\n" +
        testInfo + "\n\n" +
        (hasTests ? (
          "REQUIRED: The fixed code MUST contain these strings:\n" +
          (test.checks || []).map(function(c){ return "  - " + c; }).join("\n") + "\n\n" +
          (test.mustNot && test.mustNot.length ? (
            "FORBIDDEN: The code must NOT contain:\n" +
            test.mustNot.map(function(c){ return "  - " + c; }).join("\n") + "\n\n"
          ) : "")
        ) : "") +
        "RULES:\n" +
        "- Only use axios for HTTP\n" +
        "- Never use local imports (../utils, ../../config)\n" +
        "- Must have module.exports.config and module.exports.run\n" +
        "- Return ONLY the complete fixed JavaScript code, no markdown\n\n" +
        "CURRENT CODE:\n" + lastCode + "\n\n" +
        "Return the complete fixed code:";

      const { text, model } = await askAI(prompt);
      const fixedCode = cleanCode(text);

      console.log("[SelfHeal] Attempt " + attempt + " using " + model + " — code length: " + fixedCode.length);

      // Run tests on fixed code
      const result = runTests(cmdName, fixedCode);

      if (!result.passed) {
        notifyFn && notifyFn("⚠️ Attempt " + attempt + " failed tests: " + result.reason.substring(0, 80) + "\nRetrying...");
        lastCode  = fixedCode; // use this as base for next attempt
        lastError = "Tests failed: " + result.reason;
        continue;
      }

      // Tests passed — write file
      fs.writeFileSync(filePath, fixedCode, "utf8");
      const loaded = hotLoad(filePath);

      if (!loaded.success) {
        notifyFn && notifyFn("⚠️ Attempt " + attempt + " hot reload failed: " + loaded.reason + "\nRetrying...");
        lastCode  = fixedCode;
        lastError = "Hot reload failed: " + loaded.reason;
        fs.writeFileSync(filePath, originalCode, "utf8"); // restore original
        continue;
      }

      // Push to GitHub
      let githubSuccess = false;
      try {
        const { sha } = await githubGet(githubPath);
        await githubPush(githubPath, fixedCode, "🔧 SelfHeal: Fixed " + cmdName + " (attempt " + attempt + ")", sha);
        githubSuccess = true;
      } catch(ghErr) { console.log("[SelfHeal] GitHub push failed:", ghErr.message); }

      // Log success
      state.totalFixed++;
      state.log.push({ type: "fix", cmd: cmdName, error: errorMessage.substring(0, 100), attempts: attempt, github: githubSuccess, time: new Date().toISOString() });
      saveLog();

      notifyFn && notifyFn(
        "✅ SelfHeal: Fixed !" + cmdName + "!\n" +
        "🔄 Attempts needed: " + attempt + "\n" +
        "🧪 All tests passed: ✅\n" +
        "⚡ Hot reloaded: ✅\n" +
        "☁️ GitHub synced: " + (githubSuccess ? "✅ Permanent" : "⚠️ Local only")
      );
      fixed = true;

    } catch(err) {
      console.log("[SelfHeal] Attempt " + attempt + " error:", err.message);
      lastError = err.message;
    }
  }

  if (!fixed) {
    state.totalFails++;
    state.log.push({ type: "fail", cmd: cmdName, error: errorMessage.substring(0, 100), attempts: attempt, time: new Date().toISOString() });
    saveLog();
    // Restore original
    fs.writeFileSync(filePath, originalCode, "utf8");
    notifyFn && notifyFn(
      "❌ SelfHeal: Could not fix !" + cmdName + " after " + attempt + " attempts.\n" +
      "Original code restored.\n" +
      "💡 Try: !selfheal addtest " + cmdName + " to add better test cases."
    );
  }
}

// ── Attach error interceptors ─────────────────────────────────────────────────
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
          console.error("[SelfHeal] Caught error in !" + name + ":", err.message);
          state.log.push({ type: "error", cmd: name, error: err.message.substring(0, 100), time: new Date().toISOString() });
          saveLog();
          try { ctx.api.send("⚠️ !" + name + " has an error. SelfHeal is fixing it automatically..."); } catch(e) {}
          healCommand(name, err.message, notifyFn);
          throw err;
        }
      };
      cmd._selfHealWrapped = true;
      count++;
    }
  });
  return count;
}

// ── Auto start ────────────────────────────────────────────────────────────────
setTimeout(function() {
  const count = attachInterceptors(function(msg) {
    console.log("[SelfHeal]", msg);
    const adminId = (process.env.ADMIN_IDS || process.env.ADMIN_ID || "").split(",")[0].trim();
    if (adminId && global.sendMessage) global.sendMessage({ text: msg }, adminId);
  });
  console.log("[SelfHeal] ✅ Monitoring " + count + " commands with test cases.");
}, 5000);

// ── Command ───────────────────────────────────────────────────────────────────
module.exports.run = async function ({ api, args, event }) {
  const uid     = event.senderId;
  const ADMINS  = (process.env.ADMIN_IDS || process.env.ADMIN_ID || "").split(",").map(function(id){ return id.trim(); }).filter(Boolean);
  const isAdmin = ADMINS.length === 0 || ADMINS.includes(uid);
  if (!isAdmin) return api.send("⛔ Admins only!");

  const action = (args[0] || "status").toLowerCase();

  if (action === "status") {
    const errors = state.log.filter(function(l){ return l.type === "error"; }).length;
    const fixes  = state.log.filter(function(l){ return l.type === "fix"; }).length;
    const fails  = state.log.filter(function(l){ return l.type === "fail"; }).length;
    return api.send(
      "🔧 SelfHeal v2 Status\n━━━━━━━━━━━━━━\n" +
      "Status: "        + (state.enabled ? "🟢 Active" : "🔴 Disabled") + "\n" +
      "Monitoring: "    + (global.commands ? global.commands.size : 0) + " commands\n" +
      "Test cases: "    + Object.keys(state.tests).length + " commands\n" +
      "Max attempts: "  + MAX_TRIES + " per fix\n" +
      "Errors caught: " + errors + "\n" +
      "Fixed: "         + fixes + " ✅\n" +
      "Failed: "        + fails + " ❌\n" +
      "GitHub: "        + (process.env.GITHUB_TOKEN ? "✅" : "❌")
    );
  }

  if (action === "tests") {
    const list = Object.keys(state.tests).map(function(k) {
      const t = state.tests[k];
      return "!" + k + " — " + (t.desc || "Custom") + "\n   ✅ Must have: " + (t.checks || []).join(", ") + (t.mustNot && t.mustNot.length ? "\n   ❌ Must not: " + t.mustNot.join(", ") : "");
    });
    return api.send("🧪 Test Cases:\n━━━━━━━━━━━━━━\n" + (list.length ? list.join("\n\n") : "No tests defined yet."));
  }

  if (action === "addtest") {
    const cmdName = args[1] ? args[1].replace("!", "").toLowerCase() : null;
    const rest    = args.slice(2).join(" ");
    if (!cmdName) return api.send("Usage: !selfheal addtest [cmdname] [must contain words separated by comma]");

    const checks = rest ? rest.split(",").map(function(s){ return s.trim(); }).filter(Boolean) : [];
    state.tests[cmdName] = { desc: "Custom test for " + cmdName, checks: checks, mustNot: [] };
    saveTests();
    return api.send("✅ Test added for !" + cmdName + "\nMust contain: " + (checks.length ? checks.join(", ") : "basic structure only"));
  }

  if (action === "removetest") {
    const cmdName = args[1] ? args[1].replace("!", "").toLowerCase() : null;
    if (!cmdName) return api.send("Usage: !selfheal removetest [cmdname]");
    delete state.tests[cmdName];
    saveTests();
    return api.send("🗑️ Test removed for !" + cmdName);
  }

  if (action === "on") {
    state.enabled = true;
    const count = attachInterceptors(function(msg){ api.send(msg); });
    return api.send("✅ SelfHeal enabled! Monitoring " + count + " commands.");
  }

  if (action === "off") {
    state.enabled = false;
    return api.send("🔴 SelfHeal disabled.");
  }

  if (action === "log") {
    if (!state.log.length) return api.send("📋 No events yet.");
    const recent = state.log.slice(-10).reverse();
    const lines  = recent.map(function(l) {
      const icon = l.type === "fix" ? "✅" : l.type === "fail" ? "❌" : "⚠️";
      const time = new Date(l.time).toLocaleTimeString();
      const att  = l.attempts ? " (" + l.attempts + " attempts)" : "";
      return icon + " [" + time + "] !" + l.cmd + att + " — " + (l.error || "").substring(0, 40);
    });
    return api.send("📋 SelfHeal Log:\n━━━━━━━━━━━━━━\n" + lines.join("\n"));
  }

  if (action === "fix") {
    const cmdName = args[1] ? args[1].replace("!", "").toLowerCase() : null;
    if (!cmdName) return api.send("Usage: !selfheal fix [command]");
    api.send("🔧 Fixing !" + cmdName + " with test loop...\n⏳ May take 1-3 minutes...");
    await healCommand(cmdName, "Manual fix requested", function(msg){ api.send(msg); });
    return;
  }

  if (action === "clear") {
    state.log = [];
    saveLog();
    return api.send("🔄 Log cleared!");
  }

  api.send(
    "🔧 SelfHeal v2 Commands\n━━━━━━━━━━━━━━\n" +
    "!selfheal status              — Status\n" +
    "!selfheal tests               — View test cases\n" +
    "!selfheal addtest [cmd] [words] — Add test\n" +
    "!selfheal removetest [cmd]    — Remove test\n" +
    "!selfheal fix [cmd]           — Manual fix\n" +
    "!selfheal log                 — Error log\n" +
    "!selfheal on/off              — Enable/Disable\n" +
    "!selfheal clear               — Clear log"
  );
};
