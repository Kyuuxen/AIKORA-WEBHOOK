module.exports.config = {
  name: "help",
  description: "Shows all commands",
  usage: "!help [command]",
  category: "utility",
};

module.exports.run = async function ({ api, event, args }) {
  const { senderId, commands, PREFIX } = api;

  if (args.length > 0) {
    const target = commands.get(args[0].toLowerCase());
    if (!target) return api.send(`❌ Command "${args[0]}" not found.`);
    const c = target.config;
    return api.send(
      `📖 ${c.name.toUpperCase()}\n` +
      `📝 ${c.description}\n` +
      `🔧 Usage: ${c.usage}\n` +
      `📂 Category: ${c.category}`
    );
  }

  const categories = {};
  for (const [, cmd] of commands) {
    const cat = cmd.config.category || "misc";
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(cmd.config.name);
  }

  let msg = `🤖 AIKORA — Command List\nPrefix: ${PREFIX}\n\n`;
  for (const [cat, cmds] of Object.entries(categories)) {
    msg += `📂 ${cat.toUpperCase()}\n`;
    msg += cmds.map(c => `  • ${PREFIX}${c}`).join("\n") + "\n\n";
  }
  msg += `Type ${PREFIX}help [command] for details.`;

  api.send(msg);
};
