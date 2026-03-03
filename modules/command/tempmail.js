const { http } = require("../utils");
const sessions = new Map();

// cleanup old sessions every 10 min
setInterval(() => {
    const now = Date.now();
    for (const [userId, session] of sessions.entries()) {
        if (session.createdAt && now - session.createdAt > 3600000) sessions.delete(userId);
    }
}, 600000);

module.exports.config = {
    name: "tempmail", 
    aliases: ["gen", "inbox", "read", "delete"], 
    author: "Sethdico", 
    version: "9.0", 
    category: "Utility", 
    description: "temp mail", 
    adminOnly: false, 
    usePrefix: false, 
    cooldown: 5,
};

module.exports.run = async function ({ event, args, reply, api }) {
    const id = event.sender.id;
    const token = process.env.APY_TOKEN;
    if (!token) return reply("missing api token");

    let action = args[0]?.toLowerCase();
    const text = (event.message?.text || "").toLowerCase();
    if (text.includes("generate")) action = "gen";
    if (text.includes("inbox")) action = "inbox";
    if (text.includes("delete")) action = "delete";

    const session = sessions.get(id);

    // read specific message
    if (action === "read") {
        const num = parseInt(args[1]) - 1;
        if (!session?.lastMessages?.[num]) return reply("message not found");
        const mail = session.lastMessages[num];
        const body = mail.body_text.substring(0, 600);
        return api.sendButton(`from: ${mail.from_name}\n\n${body}`, [{ title: "back", payload: "tempmail inbox" }], id);
    }

    // check inbox
    if (action === "inbox") {
        if (!session) return reply("generate an email first");
        try {
            const res = await http.get(`https://api.apyhub.com/boomlify/emails/messages/${session.id}`, { 
                headers: { 'apy-token': token }
            });
            const msgs = res.data.messages || [];
            
            if (!msgs.length) {
                return api.sendButton("inbox empty", [{ title: "refresh", payload: "tempmail inbox" }], id);
            }
            
            session.lastMessages = msgs;
            sessions.set(id, session);
            
            let list = "inbox\n\n";
            msgs.slice(0, 5).forEach((m, i) => {
                list += `${i + 1}. ${m.from_name || 'unknown'}\n   ${m.subject || 'no subject'}\n\n`;
            });
            list += "type: read [number]";
            
            const btns = [
                { title: "refresh", payload: "tempmail inbox" }, 
                { title: "delete", payload: "tempmail delete" }
            ];
            return api.sendButton(list, btns, id);
        } catch (e) { 
            return reply("email expired or error"); 
        }
    }

    // generate new email
    if (action === "gen") {
        try {
            const res = await http.post('https://api.apyhub.com/boomlify/emails/create', {}, { 
                headers: { 'apy-token': token }, 
                params: { time: "1hour" }
            });
            
            if (res.data.success) {
                const data = res.data.email;
                sessions.set(id, { 
                    email: data.address, 
                    id: data.id, 
                    lastMessages: [], 
                    createdAt: Date.now() 
                });
                
                const btns = [{ title: "inbox", payload: "tempmail inbox" }];
                await api.sendButton(`${data.address}\n\nexpires in 1 hour`, btns, id);
                return reply(data.address);
            }
        } catch (e) { 
            return reply("api limit hit, try later"); 
        }
    }

    // delete email
    if (action === "delete") {
        if (session) {
            try { 
                await http.delete(`https://api.apyhub.com/boomlify/emails/${session.id}`, { 
                    headers: { 'apy-token': token }
                }); 
            } catch (e) {}
            sessions.delete(id);
            return reply("deleted");
        }
        return reply("no active email");
    }

    // show status/menu
    if (session) {
        const msg = `active email\n${session.email}`;
        const btns = [
            { title: "inbox", payload: "tempmail inbox" }, 
            { title: "delete", payload: "tempmail delete" }
        ];
        return api.sendButton(msg, btns, id);
    } else {
        return api.sendButton("temp email\n\ncreate a disposable email", [{ title: "generate", payload: "tempmail gen" }], id);
    }
};
