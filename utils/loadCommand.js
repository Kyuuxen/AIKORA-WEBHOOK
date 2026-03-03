const fs = require("fs");
const path = require("path");

module.exports = function loadCommands() {
  const commands = new Map();
  const cmdFolder = path.join(__dirname, "../modules/commands");
  if (!fs.existsSync(cmdFolder)) return commands;
  const files = fs.readdirSync(cmdFolder).filter(f => f.endsWith(".js"));
  for (const file of files) {
    try {
      const cmd = require(path.join(cmdFolder, file));
      if (!cmd.config || !cmd.config.name || typeof cmd.run !== "function") continue;
      commands.set(cmd.config.name.toLowerCase(), cmd);
      console.log(`[SUCCESS] Loaded: ${cmd.config.name}`);
    } catch (err) {
      console.log(`[ERROR] Failed to load ${file}: ${err.message}`);
    }
  }
  console.log(`[SYSTEM] Total commands: ${commands.size}`);
  return commands;
};
