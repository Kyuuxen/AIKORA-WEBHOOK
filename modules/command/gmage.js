const axios = require("axios");

module.exports.config = {
    name: "gmage",
    author: "Sethdico",
    version: "1.0",
    category: "Media",
    description: "google image search",
    adminOnly: false,
    usePrefix: false,
    cooldown: 10,
};

module.exports.run = async function ({ event, args, api, reply }) {
    const query = args.join(" ");
    if (!query) return reply("search what?");

    try {
        const res = await axios.get("https://api-library-kohi.onrender.com/api/gmage", {
            params: { q: query }
        });

        const images = res.data.data;
        if (!images || images.length === 0) return reply("no images found.");

        const cards = images.slice(0, 10).map(url => ({
            title: query,
            image_url: url,
            buttons: [{ type: "web_url", url: url, title: "view" }]
        }));

        await api.sendCarousel(cards, event.sender.id);
    } catch (e) {
        reply("google image search failed.");
    }
};
