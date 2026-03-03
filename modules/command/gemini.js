const { http } = require("../utils");

module.exports.config = {
    name: "gemini",
    author: "Sethdico",
    version: "8.1",
    category: "AI",
    description: "Gemini 3 Pro with multi-image support with fallback.",
    adminOnly: false,
    usePrefix: false,
    cooldown: 5,
};

module.exports.run = async function ({ event, args, api, reply }) {
    const prompt = args.join(" ").trim();
    const uid = event.sender.id;
    const cookie = process.env.GEMINI_COOKIE;

    const getImages = () => {
        const current = event.message?.attachments || [];
        const replied = event.message?.reply_to?.attachments || [];
        return [...current, ...replied]
            .filter(a => a.type === "image")
            .map(a => a.payload.url);
    };

    const images = getImages();

    if (!prompt && images.length === 0) return reply("What's on your mind?");
    if (!cookie) return reply("⚠️ Missing GEMINI_COOKIE in .env");

    if (api.sendTypingIndicator) api.sendTypingIndicator(true, uid);

    if (prompt.toLowerCase() === "clear" || prompt.toLowerCase() === "reset") {
        try {
            await http.post("https://yaya-q598.onrender.com/gemini", {
                senderid: uid,
                message: "clear",
                cookies: { "__Secure-1PSID": cookie.trim() }
            });
            if (api.sendTypingIndicator) api.sendTypingIndicator(false, uid);
            return reply("✨ Conversation history cleared.");
        } catch (e) {
            return reply("❌ Failed to clear history.");
        }
    }

    try {
        const res = await http.post("https://yaya-q598.onrender.com/gemini", {
            senderid: uid,
            message: prompt || "Describe this image",
            cookies: { "__Secure-1PSID": cookie.trim() },
            urls: images
        }, { timeout: 60000 });

        const data = res.data;

        if (data?.response) {
            const modelName = data.fallback ? "Gemini Flash" : "Gemini Pro";
            reply(`✨ **${modelName}**\n────────────────\n${data.response}`);
        } else {
            reply("⚠️ No response from Gemini.");
        }

    } catch (error) {
        reply("❌ Gemini server is currently busy or the cookie has expired.");
    } finally {
        if (api.sendTypingIndicator) api.sendTypingIndicator(false, uid);
    }
};
