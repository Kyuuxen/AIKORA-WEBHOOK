const axios = require("axios");

module.exports.config = {
  name:        "admin",
  description: "Connect directly to admin for live chat",
  usage:       "!admin — Start live chat with admin",
  category:    "Utility",
};

// ── Session state (always reference global directly) ──────────────────────────
if (!global.adminChatSessions) {
  global.adminChatSessions = {
    userToAdmin: new Map(),
    adminToUser: new Map(),
  };
}

// Always use getter so relay() always gets fresh global state
function getSessions() {
  return global.adminChatSessions;
}

// ── Get admin IDs ─────────────────────────────────────────────────────────────
function getAdmins() {
  return (process.env.ADMIN_IDS || process.env.ADMIN_ID || "")
    .split(",")
    .map(function(id) { return id.trim(); })
    .filter(Boolean);
}

function isAdmin(uid) {
  return getAdmins().includes(uid);
}

// ── Send message via Graph API ────────────────────────────────────────────────
async function sendTo(recipientId, text) {
  const token = process.env.PAGE_ACCESS_TOKEN;
  try {
    await axios.post(
      "https://graph.facebook.com/v19.0/me/messages",
      {
        recipient: { id: recipientId },
        message:   { text: text },
        messaging_type: "RESPONSE",
      },
      {
        headers: { "Content-Type": "application/json" },
        params:  { access_token: token },
        timeout: 10000,
      }
    );
  } catch(e) {
    console.error("[Admin] sendTo failed:", e.message);
  }
}

// ── Format time ───────────────────────────────────────────────────────────────
function elapsed(startTime) {
  const secs = Math.floor((Date.now() - startTime) / 1000);
  if (secs < 60) return secs + "s";
  return Math.floor(secs / 60) + "m " + (secs % 60) + "s";
}

// ── Command ───────────────────────────────────────────────────────────────────
module.exports.run = async function ({ api, args, event }) {
  const uid    = event.senderId;
  const admins = getAdmins();

  if (admins.length === 0) {
    return api.send("❌ No admin configured. Set ADMIN_IDS in environment.");
  }

  const action = (args[0] || "").toLowerCase();

  // ── ADMIN COMMANDS ──────────────────────────────────────────────────────────
  if (isAdmin(uid)) {

    // !admin end — admin ends current session
    if (action === "end" || action === "stop" || action === "close") {
      const userId = getSessions().adminToUser.get(uid);
      if (!userId) return api.send("ℹ️ You have no active live chat session.");

      getSessions().adminToUser.delete(uid);
      getSessions().userToAdmin.delete(userId);

      await sendTo(userId,
        "━━━━━━━━━━━━━━\n" +
        "📴 Admin has ended the live chat.\n" +
        "Thank you for reaching out! Type !admin to start again.\n" +
        "━━━━━━━━━━━━━━"
      );
      return api.send(
        "━━━━━━━━━━━━━━\n" +
        "📴 Live chat ended.\n" +
        "User has been notified.\n" +
        "━━━━━━━━━━━━━━"
      );
    }

    // !admin sessions — admin sees active sessions
    if (action === "sessions" || action === "list") {
      if (getSessions().userToAdmin.size === 0) {
        return api.send("📋 No active live chat sessions.");
      }
      let msg = "📋 Active Sessions:\n━━━━━━━━━━━━━━\n";
      getSessions().userToAdmin.forEach(function(data, userId) {
        msg += "👤 User: " + userId + "\n";
        msg += "⏱️ Duration: " + elapsed(data.startTime) + "\n\n";
      });
      return api.send(msg);
    }

    // Admin has no active session and no special command
    if (!getSessions().adminToUser.has(uid)) {
      return api.send(
        "ℹ️ No active live chat session.\n\n" +
        "When a user starts !admin, you will be connected automatically.\n\n" +
        "Commands:\n" +
        "!admin end      — End current session\n" +
        "!admin sessions — View all active sessions"
      );
    }
  }

  // ── USER: stop/end ──────────────────────────────────────────────────────────
  if (action === "end" || action === "stop" || action === "close") {
    const session = getSessions().userToAdmin.get(uid);
    if (!session) return api.send("ℹ️ You have no active live chat session.");

    getSessions().userToAdmin.delete(uid);
    getSessions().adminToUser.delete(session.adminId);

    await sendTo(session.adminId,
      "━━━━━━━━━━━━━━\n" +
      "📴 User has ended the live chat.\n" +
      "Duration: " + elapsed(session.startTime) + "\n" +
      "━━━━━━━━━━━━━━"
    );
    return api.send(
      "━━━━━━━━━━━━━━\n" +
      "📴 Live chat ended.\n" +
      "Thanks for chatting! Type !admin to start again anytime.\n" +
      "━━━━━━━━━━━━━━"
    );
  }

  // ── USER: start session ─────────────────────────────────────────────────────
  if (getSessions().userToAdmin.has(uid)) {
    return api.send(
      "💬 You are already in a live chat session!\n\n" +
      "Just type your message to chat with admin.\n" +
      "Type !admin end to stop."
    );
  }

  // Find available admin (not already chatting)
  let availableAdmin = null;
  for (let i = 0; i < admins.length; i++) {
    if (!getSessions().adminToUser.has(admins[i])) {
      availableAdmin = admins[i];
      break;
    }
  }

  if (!availableAdmin) {
    return api.send(
      "⏳ Admin is currently busy with another chat.\n\n" +
      "Please try again in a few minutes!"
    );
  }

  // Create session
  getSessions().userToAdmin.set(uid, {
    adminId:   availableAdmin,
    startTime: Date.now(),
  });
  getSessions().adminToUser.set(availableAdmin, uid);

  // Notify admin
  await sendTo(availableAdmin,
    "━━━━━━━━━━━━━━\n" +
    "🔔 New Live Chat!\n" +
    "User ID: " + uid + "\n" +
    "Just reply normally to chat with them.\n" +
    "Type !admin end to stop.\n" +
    "━━━━━━━━━━━━━━"
  );

  // Confirm to user
  return api.send(
    "━━━━━━━━━━━━━━\n" +
    "✅ Connected to Admin!\n\n" +
    "💬 You can now chat directly.\n" +
    "Just type your message!\n\n" +
    "Type !admin end to stop.\n" +
    "━━━━━━━━━━━━━━"
  );
};

// ── Relay function called directly by index.js ───────────────────────────────
module.exports.relay = async function (uid, text) {
  const prefix   = process.env.PREFIX || "!";
  const s        = getSessions();
  const admins   = getAdmins();

  // Ignore commands
  if (text.startsWith(prefix)) return false;

  // Debug log every relay call
  console.log("[Admin] relay() called — uid:" + uid + " isAdmin:" + isAdmin(uid) +
    " inAdminMap:" + s.adminToUser.has(uid) +
    " inUserMap:"  + s.userToAdmin.has(uid) +
    " sessions:"   + s.userToAdmin.size);

  // ── Admin sending to user ─────────────────────────────────────────────────
  if (isAdmin(uid) && s.adminToUser.has(uid)) {
    const userId = s.adminToUser.get(uid);
    await sendTo(userId, "👨‍💼 Admin: " + text);
    console.log("[Admin] Admin → User " + userId + ": " + text.substring(0, 50));
    return true;
  }

  // ── User sending to admin ─────────────────────────────────────────────────
  if (s.userToAdmin.has(uid)) {
    const session = s.userToAdmin.get(uid);
    await sendTo(session.adminId, "👤 User: " + text);
    console.log("[Admin] User " + uid + " → Admin " + session.adminId + ": " + text.substring(0, 50));
    return true;
  }

  return false;
};

// ── handleMessage still needed for downloader auto-detect etc ─────────────────
module.exports.handleMessage = async function ({ api, event }) {};
