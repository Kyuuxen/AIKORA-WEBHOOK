const axios = require("axios");

module.exports.config = {
    name: "alldl",
    aliases: ["dl", "download"],
    author: "Sethdico",
    version: "1.0",
    category: "Media",
    description: "All in One Downloader. Download videos from YouTube, Facebook, Instagram, TikTok, and Twitter/X.",
    adminOnly: false,
    usePrefix: false,
    cooldown: 10,
};

module.exports.run = async function ({ event, args, api, reply }) {
    const url = args[0];
    if (!url) return reply("send a link.");

    if (api.sendTypingIndicator) api.sendTypingIndicator(true, event.sender.id);

    try {
        const res = await axios.get("https://api-library-kohi.onrender.com/api/alldl", {
            params: { url: url }
        });

        const videoUrl = res.data.data.videoUrl;
        const platform = res.data.data.platform;

        if (videoUrl) {
            await api.sendAttachment("video", videoUrl, event.sender.id);
        } else {
            reply("couldn't get the video link.");
        }
    } catch (e) {
        reply("download failed. link might be private or broken.");
    } finally {
        if (api.sendTypingIndicator) api.sendTypingIndicator(false, event.sender.id);
    }
};
