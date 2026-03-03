const { http } = require("../utils");

module.exports.config = {
    name: "google",
    author: "Sethdico",
    version: "3.0",
    category: "Utility",
    description: "google search with carousel",
    adminOnly: false,
    usePrefix: false,
    cooldown: 5,
};

module.exports.run = async function ({ event, args, api }) {
    const query = args.join(" ");
    const id = event.sender.id;
    
    if (!query) return api.sendMessage("usage: google <search term>", id);

    const apiKey = process.env.GOOGLE_API_KEY; 
    const cx = process.env.GOOGLE_CX; 

    if (api.sendTypingIndicator) api.sendTypingIndicator(true, id).catch(()=>{});

    try {
        const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}&q=${encodeURIComponent(query)}`;
        const res = await http.get(url);
        const items = res.data.items;

        if (!items || items.length === 0) {
            return api.sendMessage(`no results for "${query}"`, id);
        }

        const elements = items.slice(0, 5).map(item => {
            const title = item.title.length > 80 
              ? item.title.substring(0, 77) + "..." 
              : item.title;
            
            const snippet = (item.snippet || "no description").replace(/\n/g, " ");
            const subtitle = snippet.length > 80 
              ? snippet.substring(0, 77) + "..." 
              : snippet;
            
            const screenshot = `https://image.thum.io/get/width/500/crop/400/noanimate/${item.link}`;

            return {
                title: title,
                subtitle: subtitle,
                image_url: screenshot,
                buttons: [{ type: "web_url", url: item.link, title: "visit" }]
            };
        });

        await api.sendCarousel(elements, id);
    } catch (e) {
        api.sendMessage("google search failed", id);
    } finally {
        if (api.sendTypingIndicator) api.sendTypingIndicator(false, id).catch(()=>{});
    }
};
