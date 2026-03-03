const axios = require("axios");

module.exports.config = { name: "chess", description: "Play chess vs Patricia AI engine", usage: "!chess [start|move|board|resign|help]", category: "Games" };

// Board symbols
const PIECES = {
  wK:"♔",wQ:"♕",wR:"♖",wB:"♗",wN:"♘",wP:"♙",
  bK:"♚",bQ:"♛",bR:"♜",bB:"♝",bN:"♞",bP:"♟",empty:"·"
};

// Initial board setup
function newBoard() {
  const b = Array(8).fill(null).map(() => Array(8).fill(null));
  const order = ["R","N","B","Q","K","B","N","R"];
  for (let i = 0; i < 8; i++) {
    b[0][i] = "b" + order[i];
    b[1][i] = "bP";
    b[6][i] = "wP";
    b[7][i] = "w" + order[i];
  }
  return b;
}

// Render board as text with coordinates and notation list
function renderBoard(board, moves, perspective) {
  const files = ["a","b","c","d","e","f","g","h"];
  const rows = perspective === "black"
    ? [0,1,2,3,4,5,6,7]
    : [7,6,5,4,3,2,1,0];
  const cols = perspective === "black"
    ? [7,6,5,4,3,2,1,0]
    : [0,1,2,3,4,5,6,7];

  let out = "  " + cols.map(c => files[c]).join(" ") + "\n";
  for (const r of rows) {
    let row = (r + 1) + " ";
    for (const c of cols) {
      const p = board[r][c];
      row += (p ? PIECES[p] : PIECES.empty) + " ";
    }
    // Add move notation on the right (last 4 moves)
    const moveIdx = rows.indexOf(r);
    if (moves.length > 0 && moveIdx < 4) {
      const mIdx = moves.length - 1 - (3 - moveIdx);
      if (mIdx >= 0 && moves[mIdx]) {
        const mNum = Math.floor(mIdx / 2) + 1;
        const side = mIdx % 2 === 0 ? "W" : "B";
        row += "  " + mNum + "." + side + " " + moves[mIdx];
      }
    }
    out += row.trimEnd() + "\n";
  }
  return out;
}

// Parse algebraic notation e.g. e2e4 or e4
function parseMove(moveStr, board, isWhite) {
  moveStr = moveStr.toLowerCase().replace(/[+#x]/g, "");
  // Long algebraic: e2e4
  if (/^[a-h][1-8][a-h][1-8]$/.test(moveStr)) {
    const fc = moveStr.charCodeAt(0) - 97;
    const fr = parseInt(moveStr[1]) - 1;
    const tc = moveStr.charCodeAt(2) - 97;
    const tr = parseInt(moveStr[3]) - 1;
    return { fr, fc, tr, tc };
  }
  return null;
}

// Basic move validation (simplified)
function isValidMove(board, move, isWhite) {
  const { fr, fc, tr, tc } = move;
  if (fr < 0 || fr > 7 || fc < 0 || fc > 7 || tr < 0 || tr > 7 || tc < 0 || tc > 7) return false;
  const piece = board[fr][fc];
  if (!piece) return false;
  if (isWhite && piece[0] !== "w") return false;
  if (!isWhite && piece[0] !== "b") return false;
  const target = board[tr][tc];
  if (target && target[0] === piece[0]) return false; // can't capture own piece
  return true;
}

// Apply move to board
function applyMove(board, move) {
  const newBoard = board.map(r => [...r]);
  const piece = newBoard[move.fr][move.fc];
  newBoard[move.tr][move.tc] = piece;
  newBoard[move.fr][move.fc] = null;
  // Pawn promotion
  if (piece === "wP" && move.tr === 7) newBoard[move.tr][move.tc] = "wQ";
  if (piece === "bP" && move.tr === 0) newBoard[move.tr][move.tc] = "bQ";
  return newBoard;
}

// Patricia AI — aggressive engine using stockfish-like API
async function patriciaMove(board, moves, uid) {
  try {
    // Use chess API to get best move
    const fen = boardToFen(board, false, moves.length);
    const res = await axios.get("https://stockfish.online/api/s/v2.php", {
      params: { fen, depth: 12 }, timeout: 10000
    });
    const bestmove = res.data?.bestmove;
    if (bestmove) {
      const mv = bestmove.replace("bestmove ", "").split(" ")[0];
      return mv;
    }
  } catch {}

  // Fallback: ask AI for aggressive move
  try {
    const boardStr = renderBoard(board, moves, "white");
    const res = await axios.get("https://api-library-kohi.onrender.com/api/copilot", {
      params: {
        prompt: "You are Patricia, an aggressive chess AI. Given this board, reply with ONLY one move in long algebraic notation (e.g. e7e5, d8h4). Choose the most aggressive attacking move for black.\n\nBoard:\n" + boardStr + "\nMoves so far: " + moves.join(" ") + "\n\nReply with ONLY the move notation, nothing else.",
        model: "default", user: "patricia_" + uid
      }, timeout: 20000
    });
    const text = res.data?.data?.text || "";
    const match = text.match(/[a-h][1-8][a-h][1-8]/);
    return match ? match[0] : null;
  } catch {}
  return null;
}

// Simple FEN generator
function boardToFen(board, isWhiteTurn, moveCount) {
  const pieceMap = { wK:"K",wQ:"Q",wR:"R",wB:"B",wN:"N",wP:"P",bK:"k",bQ:"q",bR:"r",bB:"b",bN:"n",bP:"p" };
  let fen = "";
  for (let r = 7; r >= 0; r--) {
    let empty = 0;
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (!p) { empty++; }
      else { if (empty) { fen += empty; empty = 0; } fen += pieceMap[p] || ""; }
    }
    if (empty) fen += empty;
    if (r > 0) fen += "/";
  }
  fen += " " + (isWhiteTurn ? "w" : "b") + " KQkq - 0 " + (Math.floor(moveCount / 2) + 1);
  return fen;
}

// Check if king is captured (simplified game over check)
function isGameOver(board) {
  let wK = false, bK = false;
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    if (board[r][c] === "wK") wK = true;
    if (board[r][c] === "bK") bK = true;
  }
  if (!wK) return "black";
  if (!bK) return "white";
  return null;
}

if (!global.chessGames) global.chessGames = new Map();

module.exports.run = async function ({ api, args, event }) {
  const uid    = event.senderId;
  const action = args[0]?.toLowerCase();

  // ── HELP ──────────────────────────────────────────────────────────────────
  if (!action || action === "help") {
    return api.send(
      "♟️ Chess vs Patricia AI\n" +
      "━━━━━━━━━━━━━━\n" +
      "!chess start     — New game (you=White)\n" +
      "!chess board     — Show current board\n" +
      "!chess move e2e4 — Make your move\n" +
      "!chess resign    — Resign the game\n" +
      "!chess help      — Show this help\n\n" +
      "Move format: e2e4 (from-square to-square)\n" +
      "Example: !chess move e2e4\n\n" +
      "♟️ Patricia is an aggressive AI engine — good luck!"
    );
  }

  // ── START ─────────────────────────────────────────────────────────────────
  if (action === "start") {
    const board = newBoard();
    global.chessGames.set(uid, {
      board,
      moves:     [],
      turn:      "white",
      startTime: Date.now(),
    });
    return api.send(
      "♟️ NEW GAME — You vs Patricia AI\n" +
      "━━━━━━━━━━━━━━\n" +
      "You play as ♔ WHITE\n" +
      "Patricia plays as ♚ BLACK (aggressive)\n\n" +
      renderBoard(board, [], "white") + "\n" +
      "Your turn! Make a move:\n" +
      "!chess move e2e4\n\n" +
      "Move format: [from][to] e.g. e2e4, d1h5, g1f3"
    );
  }

  const game = global.chessGames.get(uid);

  // ── BOARD ─────────────────────────────────────────────────────────────────
  if (action === "board") {
    if (!game) return api.send("No active game!\nType !chess start to begin.");
    return api.send(
      "♟️ Current Board\n" +
      "━━━━━━━━━━━━━━\n" +
      renderBoard(game.board, game.moves, "white") + "\n" +
      "Turn: " + (game.turn === "white" ? "♔ Your turn (White)" : "♚ Patricia (Black)") + "\n" +
      "Moves: " + game.moves.length + "\n\n" +
      "!chess move e2e4"
    );
  }

  // ── RESIGN ────────────────────────────────────────────────────────────────
  if (action === "resign") {
    if (!game) return api.send("No active game!");
    global.chessGames.delete(uid);
    return api.send(
      "🏳️ You resigned!\n\n" +
      "Patricia wins! Better luck next time.\n\n" +
      "Game lasted " + game.moves.length + " moves.\n" +
      "Type !chess start for a new game!"
    );
  }

  // ── MOVE ──────────────────────────────────────────────────────────────────
  if (action === "move") {
    if (!game) return api.send("No active game!\nType !chess start to begin.");
    if (game.turn !== "white") return api.send("⏳ Wait for Patricia to move...");

    const moveStr = args[1]?.toLowerCase();
    if (!moveStr) return api.send("Please provide a move!\nExample: !chess move e2e4");

    const move = parseMove(moveStr, game.board, true);
    if (!move) return api.send(
      "❌ Invalid move format!\n\n" +
      "Use long algebraic notation: !chess move e2e4\n" +
      "Format: [from square][to square]\n" +
      "Examples: e2e4, d1h5, g1f3, b1c3"
    );

    if (!isValidMove(game.board, move, true)) return api.send(
      "❌ Illegal move: " + moveStr + "\n\n" +
      "Make sure:\n" +
      "• You're moving a white piece\n" +
      "• The destination is valid\n" +
      "• You're not capturing your own piece\n\n" +
      "Try: !chess board to see the board"
    );

    // Apply player move
    game.board = applyMove(game.board, move);
    game.moves.push(moveStr);
    game.turn = "black";

    // Check game over after player move
    const afterPlayer = isGameOver(game.board);
    if (afterPlayer === "white") {
      global.chessGames.delete(uid);
      return api.send(
        "♔ YOU WIN! Congratulations!\n\n" +
        renderBoard(game.board, game.moves, "white") + "\n" +
        "You captured Patricia's king in " + game.moves.length + " moves!"
      );
    }

    api.send(
      "✅ Your move: " + moveStr + "\n" +
      "⏳ Patricia is thinking...\n\n" +
      renderBoard(game.board, game.moves, "white")
    );

    // Patricia's move
    try {
      const patriciaStr = await patriciaMove(game.board, game.moves, uid);

      if (!patriciaStr) {
        game.turn = "white";
        return api.send("⚠️ Patricia couldn't find a move. Your turn again!\n!chess board");
      }

      const pMove = parseMove(patriciaStr, game.board, false);
      if (!pMove || !isValidMove(game.board, pMove, false)) {
        game.turn = "white";
        return api.send("⚠️ Patricia made an invalid move. Your turn!\n!chess board");
      }

      game.board = applyMove(game.board, pMove);
      game.moves.push(patriciaStr);
      game.turn = "white";

      // Check game over after Patricia's move
      const afterPatricia = isGameOver(game.board);
      if (afterPatricia === "black") {
        global.chessGames.delete(uid);
        return api.send(
          "♚ PATRICIA WINS!\n\n" +
          renderBoard(game.board, game.moves, "white") + "\n\n" +
          "Patricia captured your king in " + game.moves.length + " moves!\n" +
          "Type !chess start to try again!"
        );
      }

      api.send(
        "♚ Patricia played: " + patriciaStr + "\n" +
        "━━━━━━━━━━━━━━\n" +
        renderBoard(game.board, game.moves, "white") + "\n" +
        "Moves: " + game.moves.length + " | Your turn ♔\n\n" +
        "!chess move [your move]\n" +
        "!chess resign — give up"
      );
    } catch (err) {
      game.turn = "white";
      api.send("⚠️ Patricia is unavailable. Your turn!\n!chess board");
    }
    return;
  }

  api.send("Unknown action. Type !chess help");
};
