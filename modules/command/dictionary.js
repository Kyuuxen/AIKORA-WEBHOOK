const { http } = require("../utils");

module.exports.config = {
    name: "dict", 
    aliases: ["dictionary", "define"],
    author: "Sethdico", 
    version: "15.0", 
    category: "Utility", 
    description: "dictionary with slang support", 
    adminOnly: false, 
    usePrefix: false, 
    cooldown: 3,
};

module.exports.run = async function ({ event, args, api, reply }) {
    const isSlang = args[0]?.toLowerCase() === "slang";
    const query = isSlang ? args.slice(1).join(" ") : args.join(" ");

    if (!query) return reply("usage:\ndict <word> - formal\ndict slang <word> - urban");

    // urban dictionary (slang)
    if (isSlang) {
        try {
            const res = await http.get(`https://api.urbandictionary.com/v0/define?term=${encodeURIComponent(query)}`);
            const list = res.data.list;
            if (!list || list.length === 0) return reply(`no slang for "${query}"`);

            const entry = list[0];
            const def = entry.definition.replace(/[\[\]]/g, "");
            const ex = entry.example.replace(/[\[\]]/g, "");

            const msg = `${query}\n\n${def}\n\nexample: ${ex}`;
            const btns = [{ type: "postback", title: "formal def", payload: `dict ${query}` }];
            return api.sendButton(msg, btns, event.sender.id);
        } catch (e) {
            return reply("urban dict is down");
        }
    }

    // try merriam-webster first
    const apiKey = process.env.DICT_API_KEY;
    
    if (apiKey) {
        try {
            const res = await http.get(`https://www.dictionaryapi.com/api/v3/references/collegiate/json/${encodeURIComponent(query)}?key=${apiKey}`);
            const data = res.data;

            if (!data || data.length === 0) throw new Error("empty");
            if (typeof data[0] === 'string') throw new Error("suggestions");

            const entry = data[0];
            const def = entry.shortdef ? entry.shortdef.join("\n• ") : "no definition";
            const type = entry.fl || ""; 
            const pronunciation = entry.hwi?.prs?.[0]?.mw || ""; 

            let msg = `${entry.hwi?.hw?.replace(/\*/g, "") || query} ${type ? `(${type})` : ''}\n`;
            if (pronunciation) msg += `/${pronunciation}/\n`;
            msg += `\n• ${def}`;

            const btns = [{ type: "postback", title: "slang def", payload: `dict slang ${query}` }];
            await api.sendButton(msg, btns, event.sender.id);

            // audio
            if (entry.hwi?.prs?.[0]?.sound?.audio) {
                const audioName = entry.hwi.prs[0].sound.audio;
                let subdir = audioName[0];
                if (!isNaN(subdir) || !/^[a-zA-Z]/.test(subdir)) subdir = "number";
                else if (audioName.startsWith("bix")) subdir = "bix";
                else if (audioName.startsWith("gg")) subdir = "gg";

                const audioUrl = `https://media.merriam-webster.com/audio/prons/en/us/mp3/${subdir}/${audioName}.mp3`;
                await api.sendAttachment("audio", audioUrl, event.sender.id);
            }
            return;

        } catch (e) {
            // fallback to free dict
        }
    }

    // free dictionary fallback
    try {
        const res = await http.get(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(query)}`);
        const data = res.data[0];

        const def = data.meanings[0].definitions[0].definition;
        const phonetics = data.phonetics.find(p => p.text)?.text || "";
        const audioUrl = data.phonetics.find(p => p.audio)?.audio || "";

        let msg = `${data.word}`;
        if (phonetics) msg += ` /${phonetics}/`;
        msg += `\n\n${def}`;

        const btns = [{ type: "postback", title: "slang def", payload: `dict slang ${query}` }];
        await api.sendButton(msg, btns, event.sender.id);

        if (audioUrl) await api.sendAttachment("audio", audioUrl, event.sender.id);

    } catch (e) {
        return reply(`couldn't find "${query}"`);
    }
};
