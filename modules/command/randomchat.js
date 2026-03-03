module.exports.config = {
  name: "randomchat",
  description: "Chat with a random stranger anonymously — Omegle style!",
  usage: "!randomchat [start | stop | next | status]",
  category: "Fun",
};

// ── Global state (shared across all users) ────────────────────────────────────
if (!global.rcState) {
  global.rcState = {
    waiting:  null,          // userId waiting for a partner
    pairs:    new Map(),     // userId => partnerId
    stats:    { total: 0, active: 0 },
    sendFn:   null,          // set by index.js
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function getParter(uid) { return global.rcState.pairs.get(uid) || null; }
function isConnected(uid) { return global.rcState.pairs.has(uid); }
function isWaiting(uid) { return global.rcState.waiting === uid; }

function connect(uid1, uid2) {
  global.rcState.pairs.set(uid1, uid2);
  global.rcState.pairs.set(uid2, uid1);
  global.rcState.stats.total++;
  global.rcState.stats.active++;
  if (global.rcState.waiting === uid1 || global.rcState.waiting === uid2) {
    global.rcState.waiting = null;
  }
}

function disconnect(uid) {
  const partner = getParter(uid);
  global.rcState.pairs.delete(uid);
  if (partner) {
    global.rcState.pairs.delete(partner);
    global.rcState.stats.active = Math.max(0, global.rcState.stats.active - 1);
  }
  if (global.rcState.waiting === uid) global.rcState.waiting = null;
  return partner;
}

async function send(uid, msg) {
  if (global.rcState.sendFn) await global.rcState.sendFn(uid, msg);
}

// ── Command handler ───────────────────────────────────────────────────────────
module.exports.run = async function ({ api, args, event }) {
  const uid    = event.senderId;
  const action = args[0]?.toLowerCase();

  // Register send function so randomchat can message users outside commands
  global.rcState.sendFn = api.send;

  // ── START ──────────────────────────────────────────────────────────────────
  if (!action || action === "start") {
    if (isConnected(uid)) {
      return api.send(
        "⚠️ You're already in a chat!\n\n" +
        "• Send messages normally to chat\n" +
        "• !randomchat next — find new stranger\n" +
        "• !randomchat stop — end chat"
      );
    }

    if (isWaiting(uid)) {
      return api.send("⏳ Still looking for a stranger... Please wait!");
    }

    // Check if someone is waiting
    const waitingUser = global.rcState.waiting;

    if (waitingUser && waitingUser !== uid) {
      // Match found!
      connect(uid, waitingUser);

      await send(waitingUser,
        "🎉 Stranger connected!\n" +
        "━━━━━━━━━━━━━━\n" +
        "Say hi! You're now chatting anonymously.\n" +
        "• !randomchat next — find new stranger\n" +
        "• !randomchat stop — end chat"
      );

      return api.send(
        "🎉 Stranger connected!\n" +
        "━━━━━━━━━━━━━━\n" +
        "Say hi! You're now chatting anonymously.\n" +
        "• !randomchat next — find new stranger\n" +
        "• !randomchat stop — end chat"
      );
    }

    // No one waiting — add to queue
    global.rcState.waiting = uid;
    return api.send(
      "🔍 Looking for a stranger...\n" +
      "━━━━━━━━━━━━━━\n" +
      "⏳ Waiting for someone to connect.\n\n" +
      "Type !randomchat stop to cancel."
    );
  }

  // ── STOP ───────────────────────────────────────────────────────────────────
  if (action === "stop") {
    if (!isConnected(uid) && !isWaiting(uid)) {
      return api.send("⚠️ You're not in a chat. Type !randomchat start to begin!");
    }

    if (isWaiting(uid)) {
      global.rcState.waiting = null;
      return api.send("🛑 Search cancelled. Type !randomchat start to try again.");
    }

    const partner = disconnect(uid);

    if (partner) {
      await send(partner,
        "👋 Stranger has disconnected.\n\n" +
        "Type !randomchat start to find a new stranger!"
      );
    }

    return api.send(
      "👋 Chat ended.\n\n" +
      "Type !randomchat start to find a new stranger!"
    );
  }

  // ── NEXT ───────────────────────────────────────────────────────────────────
  if (action === "next") {
    // Disconnect from current partner
    if (isConnected(uid)) {
      const partner = disconnect(uid);
      if (partner) {
        await send(partner,
          "👋 Stranger skipped to next chat.\n\n" +
          "Type !randomchat start to find a new stranger!"
        );
      }
    }

    if (isWaiting(uid)) {
      global.rcState.waiting = null;
    }

    // Now search for a new partner
    const waitingUser = global.rcState.waiting;

    if (waitingUser && waitingUser !== uid) {
      connect(uid, waitingUser);

      await send(waitingUser,
        "🎉 Stranger connected!\n" +
        "━━━━━━━━━━━━━━\n" +
        "Say hi! You're now chatting anonymously.\n" +
        "• !randomchat next — skip\n" +
        "• !randomchat stop — end"
      );

      return api.send(
        "🎉 New stranger connected!\n" +
        "━━━━━━━━━━━━━━\n" +
        "Say hi! You're now chatting anonymously.\n" +
        "• !randomchat next — skip\n" +
        "• !randomchat stop — end"
      );
    }

    // No one waiting
    global.rcState.waiting = uid;
    return api.send(
      "🔍 Looking for a new stranger...\n" +
      "⏳ Waiting for someone to connect.\n\n" +
      "Type !randomchat stop to cancel."
    );
  }

  // ── STATUS ─────────────────────────────────────────────────────────────────
  if (action === "status") {
    const stats = global.rcState.stats;
    const myStatus = isConnected(uid)
      ? "💬 In a chat"
      : isWaiting(uid)
      ? "⏳ Waiting for stranger"
      : "💤 Not in a chat";

    return api.send(
      "📊 Random Chat Status\n" +
      "━━━━━━━━━━━━━━\n" +
      `Your status: ${myStatus}\n` +
      `Active chats: ${stats.active}\n` +
      `Total chats today: ${stats.total}\n` +
      `Waiting: ${global.rcState.waiting ? "1 person" : "nobody"}\n\n` +
      "Commands:\n" +
      "!randomchat start — find a stranger\n" +
      "!randomchat stop  — end chat\n" +
      "!randomchat next  — skip to next"
    );
  }

  // ── Unknown ────────────────────────────────────────────────────────────────
  api.send(
    "💬 Random Chat — Omegle Style\n" +
    "━━━━━━━━━━━━━━\n" +
    "!randomchat start  — Find a stranger\n" +
    "!randomchat stop   — End current chat\n" +
    "!randomchat next   — Skip to next stranger\n" +
    "!randomchat status — Show stats"
  );
};

// ── Export relay function — called by index.js for non-command messages ───────
module.exports.relay = async function (senderId, text) {
  if (!global.rcState) return false;
  if (!isConnected(senderId)) return false;

  const partner = getParter(senderId);
  if (!partner) return false;

  // Forward message to partner anonymously
  await send(partner, "👤 Stranger: " + text);
  return true; // tells index.js message was handled
};
