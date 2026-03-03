const db = require("../core/database");
const crypto = require("crypto");

const loadReminders = () => {
    db.getActiveReminders((list) => {
        list.forEach(r => {
            const delay = new Date(r.fireAt).getTime() - Date.now();
            
            if (delay > 0 && delay < 2147483647) {
                setTimeout(async () => {
                    if (!global.api) {
                        console.log(`[remind] skipped reminder ${r.id} - api not ready`);
                        return; 
                    }

                    try {
                        await global.api.sendMessage(` **REMINDER**\n"${r.message}"`, r.userId);
                        await db.deleteReminder(r.id);
                    } catch (e) {
                        console.error(`[remind] failed to send: ${e.message}`);
                    }
                }, delay);
            }
        });
    });
};

module.exports.config = { 
    name: "remind", author: "Sethdico", version: "2.8", category: "Utility", description: "set a reminder", adminOnly: false, usePrefix: false, cooldown: 3 
};

module.exports.run = async ({ event, args, api, reply }) => {
    const senderID = event.sender.id;
    const input = args.join(" ");

    if (args[0] === "list") {
        const list = await new Promise(resolve => db.getActiveReminders(resolve));
        const userList = list.filter(r => r.userId === senderID);
        return reply(userList.length ? userList.map((r,i)=>`${i+1}. ${r.message}`).join("\n") : " no active reminders.");
    }

    if (args[0] === "cancel") {
        const num = parseInt(args[1]);
        if (!num) return reply("usage: remind cancel <number>");
        const list = await new Promise(resolve => db.getActiveReminders(resolve));
        const toCancel = list.filter(r => r.userId === senderID)[num - 1];
        if (toCancel) {
            await db.deleteReminder(toCancel.id);
            return reply(" reminder cancelled");
        }
        return reply(" reminder not found");
    }

    const match = input.match(/^(\d+)([smhd])\s+(.+)$/);
    if (!match) return reply("usage: remind 10m <msg>");
    
    const units = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
    const delay = parseInt(match[1]) * units[match[2]];

    if (delay > 2147483647) return reply(" max reminder: 24 days");

    const reminder = {
        id: crypto.randomBytes(8).toString('hex'),
        userId: senderID,
        message: match[3],
        fireAt: Date.now() + delay
    };

    await db.addReminder(reminder);
    
    setTimeout(async () => {
        if (api) {
            api.sendMessage(` **REMINDER**\n"${reminder.message}"`, senderID);
            await db.deleteReminder(reminder.id);
        }
    }, delay);

    reply(`reminder set for ${match[1]}${match[2]}.`);
};

loadReminders();
