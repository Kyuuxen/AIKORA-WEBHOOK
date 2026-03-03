const axios = require("axios");

module.exports.config = {
    name: "pinterest",
    aliases: ["pin"],
    author: "Sethdico",
    version: "1.0",
    category: "Media",
    description: "Search Pinterest images (Max 20)",
    adminOnly: false,
    usePrefix: false,
    cooldown: 10,
};

module.exports.run = async function ({ event, args, api, reply }) {
    const senderID = event.sender.id;
    
    let count = 5;
    let query = args.join(" ");

    if (args.length > 1 && !isNaN(args[args.length - 1])) {
        const num = parseInt(args[args.length - 1]);
        if (num > 0) {
            count = num;
            query = args.slice(0, -1).join(" ");
        }
    }

    if (!query) return reply("Usage: pinterest <search> [count]");
    if (count > 20) count = 20; 

    reply(`Searching for top ${count} images of "${query}"...`);

    try {
        const res = await axios.get("https://api-library-kohi.onrender.com/api/pinterest", {
            params: { query: query, count: count }
        });

        const images = res.data.data;

        if (!images || images.length === 0) {
            return reply("No images found.");
        }

        for (let i = 0; i < images.length; i++) {
            if (i >= count) break;

            await api.sendAttachment("image", images[i], senderID);
            
            if (i < count - 1) {
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }

    } catch (e) {
        reply("Pinterest API is currently unavailable.");
        console.error(e);
    }
};
