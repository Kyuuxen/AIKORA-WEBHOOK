const axios = require("axios");

module.exports.config = {
    name: "dalle",
    author: "Sethdico",
    version: "1.0",
    category: "Media",
    description: "Generate images using OpenDalle",
    adminOnly: false,
    usePrefix: false,
    cooldown: 10,
};

module.exports.run = async function ({ event, args, api, reply }) {
    const prompt = args.join(" ");
    const uid = event.sender.id;

    if (!prompt) return reply("draw what?");

    if (api.sendTypingIndicator) api.sendTypingIndicator(true, uid);

    try {
        reply("generating...");

        const res = await axios.get("https://api-library-kohi.onrender.com/api/opendalle", {
            params: { prompt: prompt }
        });

        const imageUrl = res.data.data || res.data.url || res.data;

        if (imageUrl) {
            await api.sendAttachment("image", imageUrl, uid);
        } else {
            reply("got nothing back.");
        }

    } catch (e) {
        reply("failed to generate.");
    } finally {
        if (api.sendTypingIndicator) api.sendTypingIndicator(false, uid);
    }
};
