import { MODULE_ID } from "../constants.js";

const CHANNEL = `module.${MODULE_ID}`;
const HEARTBEAT = 30000;
const EXPIRES = 300000;
const SETTLE = 1500;

const me = { id: foundry.utils.randomID(16), start: 0 };
const peers = new Map();
let settled = null;

function announce(type) {
  game.socket.emit(CHANNEL, { type, id: me.id, start: me.start, userId: game.user.id });
}

/**
 * The same GM can have the world open in more than one tab or browser. Only
 * the oldest of those windows runs the kingdom, so nothing happens twice.
 */
export function startLeader() {
  me.start = Date.now();
  game.socket.on(CHANNEL, (message) => {
    if (!["leader-hello", "leader-here", "leader-bye"].includes(message?.type)) return;
    if (message.type === "leader-bye") peers.delete(message.id);
    else peers.set(message.id, { ...message, seen: Date.now() });
    if (message.type === "leader-hello") announce("leader-here");
  });
  announce("leader-hello");
  setInterval(() => announce("leader-here"), HEARTBEAT);
  window.addEventListener("beforeunload", () => announce("leader-bye"));
  settled = new Promise((resolve) => setTimeout(resolve, SETTLE));
  return settled;
}

export function leaderSettled() {
  return settled ?? Promise.resolve();
}

export function isLeader() {
  if (!game.user.isActiveGM) return false;
  const now = Date.now();
  for (const [id, peer] of peers) {
    if (now - peer.seen > EXPIRES) {
      peers.delete(id);
      continue;
    }
    if (peer.userId !== game.user.id) continue;
    if (peer.start < me.start || (peer.start === me.start && peer.id < me.id)) return false;
  }
  return true;
}
