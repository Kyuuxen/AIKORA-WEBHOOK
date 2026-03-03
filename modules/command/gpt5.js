const { http } = require("../utils");

module.exports.config = {
    name: "gpt5",
    author: "Sethdico",
    version: "2.1",
    category: "AI",
    description: "ChatGPT-5.2 conversational and real-time info",
    adminOnly: false,
    usePrefix: false,
    cooldown: 5,
};

module.exports.run = async function ({ event, args, api, reply }) {
    const prompt = args.join(" ");
    const uid = event.sender.id;

    if (!prompt) return reply("yo, what's on your mind?");
    if (api.sendTypingIndicator) api.sendTypingIndicator(true, uid);

    try {
        const res = await http.get("https://api-library-kohi.onrender.com/api/pollination-ai", {
            params: { prompt: prompt, model: "openai-large", user: uid }
        });

        const answer = res.data.data;
        reply(`🧠 **GPT-5.2**\n────────────────\n${answer || "got no response."}`);

    } catch (e) {
        reply("server is busy right now.");
    } finally {
        if (api.sendTypingIndicator) api.sendTypingIndicator(false, uid);
    }
};
