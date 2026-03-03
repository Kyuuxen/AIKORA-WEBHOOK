module.exports.config = {
  name: "randomchat",
  description: "Chat with a random stranger anonymously — Omegle style!",
  usage: "!randomchat [start | stop | next | status]",
  category: "Fun",
};

if (!global.rcState) {
  global.rcState = {
    waiting: null,
    pairs:   new Map(),
    stats:   { total: 0, active: 0 },
  };
}

async function send(uid, msg) {
  if (global.sendMessage) await global.sendMessage(uid, msg);
}

function getPartner(uid)  { return global.rcState.pairs.get(uid) || null; }
function isConnected(uid) { return global.rcState.pairs.has(uid); }
function isWaiting(uid)   { return global.rcState.waiting === uid; }

function connect(uid1, uid2) {
  global.rcState.pairs.set(uid1, uid2);
  global.rcState.pairs.set(uid2, uid1);
  global.rcState.stats.total++;
  global.rcState.stats.active++;
  global.rcState.waiting = null;
}

function disconnect(uid) {
  const partner = getPartner(uid);
  global.rcState.pairs.delete(uid);
  if (partner) {
    global.rcState.pairs.delete(partner);
    global.rcState.stats.active = Math.max(0, global.rcState.stats.active - 1);
  }
  if (global.rcState.waiting === uid) global.rcState.waiting = null;
  return partner;
}

module.exports.run = async function ({ api, args, event }) {
  const uid    = event.senderId;
  const action = args[0]?.toLowerCase();

  if (!action || action === "start") {
    if (isConnected(uid)) {
      return api.send(
        "You are already in a chat!\n\n" +
        "Send any message to chat with the stranger.\n" +
        "!randomchat next - find new stranger\n" +
        "!randomchat stop - end chat"
      );
    }
    if (isWaiting(uid)) {
      return api.send("Still searching... Please wait!\nType !randomchat stop to cancel.");
    }

    const waitingUser = global.rcState.waiting;
    if (waitingUser && waitingUser !== uid) {
      connect(uid, waitingUser);
      await send(waitingUser,
        "You are now connected to a stranger!\n" +
        "Say hi! Chat is completely anonymous.\n\n" +
        "!randomchat next - skip stranger\n" +
        "!randomchat stop - end chat"
      );
      return api.send(
        "You are now connected to a stranger!\n" +
        "Say hi! Chat is completely anonymous.\n\n" +
        "!randomchat next - skip stranger\n" +
        "!randomchat stop - end chat"
      );
    }

    global.rcState.waiting = uid;
    return api.send(
      "Looking for a stranger...\n" +
      "Waiting for someone to connect.\n\n" +
      "Type !randomchat stop to cancel."
    );
  }

  if (action === "stop") {
    if (!isConnected(uid) && !isWaiting(uid)) {
      return api.send("You are not in a chat.\nType !randomchat start to find a stranger!");
    }
    if (isWaiting(uid)) {
      global.rcState.waiting = null;
      return api.send("Search cancelled.\nType !randomchat start to try again.");
    }
    const partner = disconnect(uid);
    if (partner) {
      await send(partner,
        "Stranger has disconnected.\n\n" +
        "Type !randomchat start to find a new stranger!"
      );
    }
    return api.send("Chat ended.\n\nType !randomchat start to find a new stranger!");
  }

  if (action === "next") {
    if (isConnected(uid)) {
      const partner = disconnect(uid);
      if (partner) {
        await send(partner,
          "Stranger skipped to next chat.\n\n" +
          "Type !randomchat start to find a new stranger!"
        );
      }
    }
    if (isWaiting(uid)) global.rcState.waiting = null;

    const waitingUser = global.rcState.waiting;
    if (waitingUser && waitingUser !== uid) {
      connect(uid, waitingUser);
      await send(waitingUser,
        "You are now connected to a stranger!\n" +
        "Say hi! Chat is completely anonymous.\n\n" +
        "!randomchat next - skip\n" +
        "!randomchat stop - end"
      );
      return api.send(
        "New stranger connected!\n" +
        "Say hi! Chat is completely anonymous.\n\n" +
        "!randomchat next - skip\n" +
        "!randomchat stop - end"
      );
    }

    global.rcState.waiting = uid;
    return api.send("Looking for a new stranger...\nType !randomchat stop to cancel.");
  }

  if (action === "status") {
    const stats    = global.rcState.stats;
    const myStatus = isConnected(uid) ? "Chatting with a stranger"
      : isWaiting(uid) ? "Waiting for a stranger"
      : "Not in a chat";
    return api.send(
      "Random Chat Status\n" +
      "Your status: " + myStatus + "\n" +
      "Active chats: " + stats.active + "\n" +
      "Total matched: " + stats.total + "\n" +
      "In queue: " + (global.rcState.waiting ? "1 person" : "nobody") + "\n\n" +
      "!randomchat start - Find stranger\n" +
      "!randomchat stop  - End chat\n" +
      "!randomchat next  - Skip stranger"
    );
  }

  api.send(
    "Random Chat - Omegle Style\n\n" +
    "!randomchat start  - Find a stranger\n" +
    "!randomchat stop   - End current chat\n" +
    "!randomchat next   - Skip to next\n" +
    "!randomchat status - Show stats"
  );
};

module.exports.relay = async function (senderId, text) {
  if (!global.rcState) return false;
  if (!isConnected(senderId)) return false;
  const partner = getPartner(senderId);
  if (!partner) return false;
  await send(partner, "Stranger: " + text);
  return true;
};
