const { http } = require("../utils");

module.exports.config = {
    name: "copilot",
    author: "Sethdico",
    version: "8.1",
    category: "AI",
    description: "Microsoft Copilot with Sources & Carousel",
    adminOnly: false,
    usePrefix: false,
    cooldown: 5,
};

module.exports.run = async function ({ event, args, api, reply }) {
    const uid = event.sender.id;
    let model = "default";
    let prompt = args.join(" ");

    if (args[0]?.startsWith("-")) {
        const flag = args[0].slice(1).toLowerCase();
        if (flag === "think") {
            model = "think-deeper";
            prompt = args.slice(1).join(" ");
        } else if (flag === "gpt5") {
            model = "gpt-5";
            prompt = args.slice(1).join(" ");
        }
    }

    if (!prompt) return reply("ask me anything. you can use -think or -gpt5 flags.");
    if (api.sendTypingIndicator) api.sendTypingIndicator(true, uid);

    try {
        const response = await http.get("https://api-library-kohi.onrender.com/api/copilot", {
            params: { prompt: prompt, model: model, user: uid }
        });

        const result = response.data.data;
        if (!result || !result.text) return reply("i couldn't get an answer.");

        await api.sendMessage(`🚀 **Copilot**\n────────────────\n${result.text}`, uid);

        if (result.citations && result.citations.length > 0) {
            const cards = result.citations.slice(0, 10).map(source => {
                let siteName = "visit source";
                try { siteName = new URL(source.url).hostname.replace("www.", ""); } catch (e) {}
                return {
                    title: source.title.length > 80 ? source.title.substring(0, 77) + "..." : source.title,
                    subtitle: siteName,
                    image_url: source.icon || "https://upload.wikimedia.org/wikipedia/commons/thumb/2/2a/Microsoft_365_Copilot_Icon.svg/1024px-Microsoft_365_Copilot_Icon.svg.png",
                    buttons: [{ type: "web_url", url: source.url, title: "read more" }]
                };
            });
            await api.sendCarousel(cards, uid);
        }
    } catch (error) {
        reply("copilot is having some issues right now.");
    } finally {
        if (api.sendTypingIndicator) api.sendTypingIndicator(false, uid);
    }
};
