const { http, parseAI } = require("../utils");
const API_URLS = require("../../config/apis");

module.exports.config = { 
    name: "webpilot", author: "Sethdico", version: "6.1", category: "AI", description: "Search the web.", adminOnly: false, usePrefix: false, cooldown: 5 
};

module.exports.run = async function ({ event, args, api, reply }) {
    const input = args.join(" ");
    if (!input) return reply("🌐 Usage: webpilot <query>");
    if (api.sendTypingIndicator) api.sendTypingIndicator(true, event.sender.id);

    try {
        const res = await http.get(API_URLS.webpilot, { 
            params: { question: input },
            timeout: 60000
        });
        const result = parseAI(res);
        api.sendMessage(`🌐 **WEBPILOT**\n────────────────\n${result || "No response."}`, event.sender.id);
    } catch (e) {
        reply("❌ Webpilot search failed.");
    } finally {
        if (api.sendTypingIndicator) api.sendTypingIndicator(false, event.sender.id);
    }
};
