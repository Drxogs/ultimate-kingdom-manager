import { MODULE_ID, SEATS } from "../constants.js";
import { getProject } from "../content/data.js";
import { getKingdom } from "../integrations/party.js";
import { isHexProject, projectQuote, projectTargets, signatureForSeat, startProject, buildableStructures } from "./projects.js";
import { canActForSeat } from "./resolve.js";
import { addLog, getRealm, newId, updateRealm } from "./state.js";
import { secondsPerDay } from "./time.js";
import { isLeader } from "./leader.js";
import { settlements } from "./settlements.js";

const KEEP_DAYS = 60;

export function proposals(realm = getRealm()) {
  return realm.council?.proposals ?? [];
}

/** Put a project before the council instead of paying for it straight away. */
export async function proposeProject(request) {
  const user = game.users.get(request.userId) ?? game.user;
  const def = getProject(request.type);
  if (!def) return { ok: false, reason: "Unknown" };
  const seatDef = def.signature ? signatureForSeat(def.seat) : def;
  if (!seatDef?.seat || !canActForSeat(user, seatDef.seat)) return { ok: false, reason: "NotYourSeat" };
  const targets = projectTargets(seatDef);
  const target =
    seatDef.target === "settlement"
      ? targets.find((t) => t.settlementId === request.settlementId)
      : isHexProject(seatDef)
        ? targets[0]
        : targets.find((t) => t.hexKey === (request.hexKey ?? null));
  if (!target) return { ok: false, reason: "NoTarget" };
  const settlement = target.settlementId ? settlements().find((s) => s.id === target.settlementId) : null;
  const structure = request.structure ? buildableStructures(settlement).find((s) => s.key === request.structure) : null;
  const quote = projectQuote(seatDef, target, structure);
  const where = String(request.where ?? "").trim().slice(0, 80);
  const settlementName = String(request.settlementName ?? "").trim().slice(0, 60);
  const label = structure ? `${structure.name}, ${target.settlement}` : settlementName || where || target.label;

  await updateRealm((realm) => {
    realm.council ??= { proposals: [] };
    realm.council.proposals.push({
      id: newId(),
      request: { type: request.type, hexKey: request.hexKey ?? null, structure: request.structure ?? null, camp: request.camp ?? null, where, settlementId: request.settlementId ?? null, settlementName, waterside: !!request.waterside },
      name: label ? `${seatDef.name}: ${label}` : seatDef.name,
      seat: seatDef.seat,
      cost: quote.cost,
      days: quote.days,
      by: user.id,
      byName: user.character?.name ?? user.name,
      votes: { [user.id]: 1 },
      created: game.time.worldTime,
      status: "open"
    });
    addLog(realm, { type: "proposal", seat: seatDef.seat, text: label ? `${seatDef.name}: ${label}` : seatDef.name });
  });
  return { ok: true };
}

export async function voteProposal({ proposalId, vote, userId }) {
  const user = game.users.get(userId);
  if (!user) return { ok: false, reason: "Unknown" };
  await updateRealm((realm) => {
    const p = realm.council?.proposals?.find((x) => x.id === proposalId && x.status === "open");
    if (!p) return;
    if (p.votes[user.id] === vote) delete p.votes[user.id];
    else p.votes[user.id] = vote > 0 ? 1 : -1;
  });
  return { ok: true };
}

function canDecide(user) {
  return user.isGM || canActForSeat(user, "ruler");
}

/** The Ruler funds a proposal: it starts as if its seat had started it. */
export async function fundProposal({ proposalId, userId }) {
  const user = game.users.get(userId) ?? game.user;
  if (!canDecide(user)) return { ok: false, reason: "NotRuler" };
  const p = proposals().find((x) => x.id === proposalId && x.status === "open");
  if (!p) return { ok: false, reason: "Unknown" };
  const result = await startProject({ ...p.request, userId: p.by }, { canActForSeat: () => true });
  if (!result.ok) return result;
  await settle(proposalId, "funded");
  return result;
}

export async function rejectProposal({ proposalId, userId }) {
  const user = game.users.get(userId) ?? game.user;
  const p = proposals().find((x) => x.id === proposalId && x.status === "open");
  if (!p) return { ok: false, reason: "Unknown" };
  if (!canDecide(user) && p.by !== user.id) return { ok: false, reason: "NotRuler" };
  await settle(proposalId, p.by === user.id && !canDecide(user) ? "withdrawn" : "rejected");
  return { ok: true };
}

async function settle(proposalId, status) {
  await updateRealm((realm) => {
    const p = realm.council?.proposals?.find((x) => x.id === proposalId);
    if (!p) return;
    p.status = status;
    p.settled = game.time.worldTime;
    const cutoff = game.time.worldTime - KEEP_DAYS * secondsPerDay();
    realm.council.proposals = realm.council.proposals.filter((x) => x.status === "open" || (x.settled ?? 0) > cutoff);
    addLog(realm, { type: `proposal-${status}`, seat: p.seat, text: p.name });
  });
}

/** At the turn of the month, remind the table what's waiting on the council. */
export async function announceCouncil() {
  if (!isLeader()) return;
  const open = proposals().filter((p) => p.status === "open");
  const kingdom = getKingdom();
  const list = open.map((p) => `<li>${Handlebars.escapeExpression(p.name)} — ${p.cost} BP</li>`).join("");
  await ChatMessage.create({
    speaker: { alias: kingdom?.name || game.i18n.localize("UKM.Manager.Unnamed") },
    content: `<div class="ukm-chat"><h3>${game.i18n.localize("UKM.Council.MeetsTitle")}</h3><p>${game.i18n.format(open.length ? "UKM.Council.MeetsWaiting" : "UKM.Council.MeetsEmpty", {
      count: open.length,
      bp: getRealm().treasury
    })}</p>${list ? `<ul>${list}</ul>` : ""}</div>`
  });
  Hooks.callAll(`${MODULE_ID}.councilMeets`, open);
}
