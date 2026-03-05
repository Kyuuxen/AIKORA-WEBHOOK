const axios = require("axios");

module.exports.config = {
  name: "me",
  description: "Check recent earthquakes in the Philippines",
  usage: "!me [optional: number of results]",
  category: "general",
};

module.exports.run = async function ({ api, args, event }) {
  const senderId = event.senderId;
  const input = args.join(" ").trim();

  // Default to showing 3 results if no input
  let limit = 3;
  if (input) {
    const num = parseInt(input);
    if (isNaN(num) || num <= 0) {
      return api.send("⚠️ Please provide a valid positive number for results.");
    }
    limit = num;
  }

  try {
    const url =
      "https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=2026-03-01&endtime=2026-03-05&minlatitude=4&maxlatitude=21&minlongitude=116&maxlongitude=127";
    const res = await axios.get(url);

    if (!res.data || !res.data.features || res.data.features.length === 0) {
      return api.send("✅ No recent earthquakes detected in the Philippines.");
    }

    const quakes = res.data.features.slice(0, limit);
    let message = "🌏 Recent Earthquakes in the Philippines:\n\n";

    quakes.forEach((q, i) => {
      const mag = q.properties.mag || "N/A";
      const place = q.properties.place || "Unknown location";
      const time = new Date(q.properties.time).toLocaleString("en-PH", {
        timeZone: "Asia/Manila",
      });
      message += `#${i + 1} ➡️ Magnitude: ${mag}\n📍 Location: ${place}\n🕒 Time: ${time}\n\n`;
    });

    api.send(message.trim());
  } catch (err) {
    api.send("❌ Something went wrong. Please try again.");
  }
};
