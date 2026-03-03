const { http } = require("../utils");

module.exports.config = {
    name: "wolfram", 
    author: "Sethdico", 
    version: "9.2", 
    category: "Utility", 
    description: "wolfram alpha search", 
    adminOnly: false, 
    usePrefix: false, 
    cooldown: 5,
};

module.exports.run = async function ({ event, args, api, reply }) {
    const input = args.join(" ");
    const id = event.sender.id;
    
    if (!input) return reply("usage: wolfram <query>");
    if (api.sendTypingIndicator) api.sendTypingIndicator(true, id).catch(()=>{});

    try {
        const res = await http.get(`https://api.wolframalpha.com/v2/query`, {
            params: { 
                appid: process.env.WOLFRAM_APP_ID, 
                input: input, 
                output: "json", 
                format: "plaintext,image" 
            },
            timeout: 60000
        });

        const data = res.data.queryresult;
        
        if (!data.success || data.error) return reply("wolfram found nothing");

        let msg = "";
        let images = [];

        if (data.pods) {
            data.pods.forEach(pod => {
                let podContent = "";
                
                pod.subpods?.forEach(sub => {
                    if (sub.plaintext) {
                        podContent += sub.plaintext + "\n";
                    }
                    if (sub.img?.src && sub.img.height > 20) {
                        images.push(sub.img.src);
                    }
                });

                if (podContent.trim()) {
                    msg += `ðŸ“ **${pod.title}**\n${podContent.trim()}\n\n`;
                }
            });
        }

        if (!msg) return reply("no clear text results found");

        await api.sendMessage(msg.trim(), id);

        const imgsToSend = images.filter(img => !img.includes("d=1")).slice(0, 3);
        
        for (const img of imgsToSend) {
            await api.sendAttachment("image", img, id).catch(()=>{});
        }

    } catch (e) {
        reply("wolfram unavailable");
    } finally {
        if (api.sendTypingIndicator) api.sendTypingIndicator(false, id).catch(()=>{});
    }
};
