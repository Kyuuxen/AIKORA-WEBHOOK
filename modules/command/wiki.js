const { http } = require("../utils");

module.exports.config = {
    name: "wiki",
    author: "Sethdico",
    version: "7.0",
    category: "Utility",
    description: "wikipedia search",
    adminOnly: false,
    usePrefix: false,
    cooldown: 5,
};

module.exports.run = async function ({ event, args, api, reply }) {
    const query = args.join(" ").trim();
    const id = event.sender.id;

    if (!query) {
        const btns = [
            { type: "postback", title: "today in history", payload: "wiki today" },
            { type: "postback", title: "random", payload: "wiki random" }
        ];
        return api.sendButton("search wiki or pick a mode", btns, id);
    }

    // history mode
    if (query.toLowerCase() === "today") {
        const now = new Date();
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');
        
        try {
            const res = await http.get(`https://en.wikipedia.org/api/rest_v1/feed/onthisday/selected/${mm}/${dd}`);
            const events = res.data.selected;
            const e = events[Math.floor(Math.random() * events.length)];
            const msg = `${mm}/${dd}\n\n${e.year}: ${e.text}`;
            return api.sendButton(msg, [{ type: "postback", title: "another", payload: "wiki today" }], id);
        } catch (e) {
            return reply("history unavailable rn");
        }
    }

    // random mode
    if (query.toLowerCase() === "random") {
        try {
            const res = await http.get(`https://en.wikipedia.org/api/rest_v1/page/random/summary`);
            const data = res.data;
            const btns = [
                { type: "web_url", url: data.content_urls.desktop.page, title: "read more" },
                { type: "postback", title: "another", payload: "wiki random" }
            ];
            if (data.originalimage?.source) await api.sendAttachment("image", data.originalimage.source, id);
            return api.sendButton(`${data.title}\n\n${data.extract}`, btns, id);
        } catch (e) {
            return reply("random failed");
        }
    }

    // normal search
    try {
        const res = await http.get(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`);
        const data = res.data;

        if (data.type === "disambiguation") {
            return reply(`"${data.title}" is too broad, be more specific`);
        }

        const btns = [
            { type: "web_url", url: data.content_urls.desktop.page, title: "full article" },
            { type: "postback", title: "random", payload: "wiki random" }
        ];

        if (data.originalimage?.source) {
            await api.sendAttachment("image", data.originalimage.source, id);
        }

        return api.sendButton(`${data.title}\n\n${data.extract}`, btns, id);

    } catch (e) {
        reply(`nothing found for "${query}"`);
    }
};
