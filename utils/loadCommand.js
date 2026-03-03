const fs     = require("fs");
const path   = require("path");
const logger = require("../utils/log");

module.exports = function loadCommands() {
  const commands  = new Map();
  const cmdFolder = path.join(__dirname, "../modules/commands");

  if (!fs.existsSync(cmdFolder)) return commands;

  const files = fs.readdirSync(cmdFolder).filter(f => f.endsWith(".js"));

  for (const file of files) {
    try {
      const cmd = require(path.join(cmdFolder, file));
      if (!cmd.config || !cmd.config.name || typeof cmd.run !== "function") continue;
      commands.set(cmd.config.name.toLowerCase(), cmd);
      logger.log(`Loaded: ${cmd.config.name}`, "SUCCESS");
    } catch (err) {
      logger.log(`Failed to load ${file}: ${err.message}`, "ERROR");
    }
  }

  logger.log(`Total commands: ${commands.size}`, "SYSTEM");
  return commands;
};
