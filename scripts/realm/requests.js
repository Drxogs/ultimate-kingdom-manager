import { MODULE_ID } from "../constants.js";
import { acceptRequest, assignCard, canActForSeat, escalateCard, unassignCard, useFame, useFortune, useRoyalDecree } from "./resolve.js";
import { royalCharge, royalCourt, useFavour } from "./royal.js";
import { startProject } from "./projects.js";
import { repayDebt, tapTreasury } from "./treasury.js";
import { answerAudience } from "./audiences.js";
import { isLeader } from "./leader.js";
import { gmAction } from "./gm.js";
import { fundProposal, proposeProject, rejectProposal, voteProposal } from "./council.js";
import { chooseRankUp, startRankUp } from "./ranks.js";
import { foundCapital } from "./settlements.js";
import { resolveFlat } from "./flat.js";

const SOCKET = `module.${MODULE_ID}`;
const TIMEOUT = 15000;
const SLOW_TIMEOUT = 180000;
const SLOW = new Set(["tapTreasury", "gm"]);

const HANDLERS = {
  assign: assignCard,
  unassign: unassignCard,
  escalate: escalateCard,
  accept: acceptRequest,
  gm: gmAction,
  startRankUp,
  tapTreasury,
  answerAudience,
  proposeProject,
  voteProposal,
  fundProposal,
  rejectProposal,
  repayDebt,
  startProject: (payload) => startProject(payload, { canActForSeat }),
  chooseRankUp,
  foundCapital,
  useFortune,
  useFame,
  resolveFlat,
  royalDecree: useRoyalDecree,
  royalCourt,
  royalCharge,
  useFavour
};

const pending = new Map();

export function registerRequests() {
  game.socket.on(SOCKET, onMessage);
}

async function onMessage(message) {
  if (message.type === "request" && isLeader()) {
    const result = await handle(message.action, { ...message.payload, userId: message.userId });
    game.socket.emit(SOCKET, { type: "response", id: message.id, userId: message.userId, result });
    return;
  }
  if (message.type === "response" && message.userId === game.user.id) {
    pending.get(message.id)?.(message.result);
    pending.delete(message.id);
  }
}

async function handle(action, payload) {
  const handler = HANDLERS[action];
  if (!handler) return { ok: false, reason: "Unknown" };
  try {
    return await handler(payload);
  } catch (err) {
    console.error(`${MODULE_ID} |`, err);
    return { ok: false, reason: "Error" };
  }
}

function report(result, action) {
  if (result?.ok) {
    if (result.notice) ui.notifications.info(result.notice);
    if (action === "assign") ui.notifications.info(game.i18n.format("UKM.Request.Assigned", { days: result.days }));
    if (action === "proposeProject") ui.notifications.info(game.i18n.localize("UKM.Council.Proposed"));
    if (action === "startProject") ui.notifications.info(game.i18n.format("UKM.Project.Started", { cost: result.cost }));
    if (action === "startRankUp") ui.notifications.info(game.i18n.format("UKM.Rank.Started", { days: result.days }));
    return;
  }
  const key = `UKM.Request.Reason.${result?.reason ?? "Error"}`;
  ui.notifications.warn(game.i18n.has(key) ? game.i18n.format(key, result?.data ?? {}) : game.i18n.localize("UKM.Request.Reason.Error"));
}

/** Send a request to the GM, or run it here when this client is the GM. */
export async function sendRequest(action, payload) {
  if (isLeader()) {
    const result = await handle(action, { ...payload, userId: game.user.id });
    report(result, action);
    return result;
  }

  if (!game.users.activeGM) {
    ui.notifications.warn(game.i18n.localize("UKM.Request.NoGM"));
    return { ok: false, reason: "NoGM" };
  }

  const id = foundry.utils.randomID(12);
  const result = await new Promise((resolve) => {
    pending.set(id, resolve);
    game.socket.emit(SOCKET, { type: "request", id, userId: game.user.id, action, payload });
    setTimeout(() => {
      if (pending.delete(id)) resolve({ ok: false, reason: "Timeout" });
    }, SLOW.has(action) ? SLOW_TIMEOUT : TIMEOUT);
  });
  report(result, action);
  return result;
}
