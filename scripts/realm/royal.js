import { MODULE_ID } from "../constants.js";
import { getKingdom, getUnrest } from "../integrations/party.js";
import { applyEffects, commitKingdomChanges, describeEffect, EffectContext } from "./effects.js";
import { addLog, getRealm, newId, updateRealm } from "./state.js";
import { setUnrest } from "./standing.js";
import { monthKey, secondsPerDay } from "./time.js";
import { kingdomPerks } from "./tracks.js";

/*
 * The ruler is a title, not a seat: the GM names one player character king or queen in Setup.
 * The ruler has three powers, each usable once a month, and may hold one-use favours that cards
 * hand out. Any user who owns the ruler's character can use them; so can the GM.
 */

export const ROYAL_POWERS = ["decree", "court", "charge"];

const loc = (key, data) => (data ? game.i18n.format(`UKM.Royal.${key}`, data) : game.i18n.localize(`UKM.Royal.${key}`));
const esc = (s) => Handlebars.escapeExpression(s ?? "");

export function rulerUuid(realm = getRealm()) {
  return realm.kingdom?.ruler ?? null;
}

export function rulerActor(realm = getRealm()) {
  const uuid = rulerUuid(realm);
  return uuid ? fromUuidSync(uuid) : null;
}

export function rulerName(realm = getRealm()) {
  return rulerActor(realm)?.name ?? null;
}

/** The ruler's player (anyone who owns the ruler's character). */
export function isRuler(user = game.user, realm = getRealm()) {
  const actor = rulerActor(realm);
  return !!actor && !!user && actor.testUserPermission?.(user, "OWNER") === true;
}

export function canUseRoyal(user = game.user, realm = getRealm()) {
  return !!user?.isGM || isRuler(user, realm);
}

/** Uses of each power a month. (A Palace will add one in stage 3.) */
/** Each power once a month; a Palace adds one more. */
export function usesPerMonth(realm = getRealm()) {
  return 1 + kingdomPerks(realm.settlements ?? []).royalExtra;
}

export function usesLeft(power, realm = getRealm()) {
  const state = realm.royal;
  const used = state?.month === monthKey() ? state.used?.[power] ?? 0 : 0;
  return Math.max(0, usesPerMonth(realm) - used);
}

/** Inside a realm change: spend a use, or return false if there's none left this month. */
export function spendUse(realm, power) {
  realm.royal ??= { month: null, used: {}, favours: [] };
  if (realm.royal.month !== monthKey()) {
    realm.royal.month = monthKey();
    realm.royal.used = {};
  }
  if (usesLeft(power, realm) < 1) return false;
  realm.royal.used[power] = (realm.royal.used[power] ?? 0) + 1;
  return true;
}

export function favours(realm = getRealm()) {
  return realm.royal?.favours ?? [];
}

/** Inside a realm change: give the ruler a one-use favour (from a card's outcome). */
export function grantFavour(realm, favour, from = "") {
  realm.royal ??= { month: null, used: {}, favours: [] };
  const record = { id: newId(), name: favour.name ?? loc("Favour"), text: favour.text ?? "", effects: favour.effects ?? [], from, granted: game.time.worldTime };
  realm.royal.favours.push(record);
  return record;
}

function speaker() {
  return { alias: getKingdom()?.name || game.i18n.localize("UKM.Manager.Unnamed") };
}

async function announce(title, text, lines = []) {
  const list = lines.length ? `<ul>${lines.map((l) => `<li>${l}</li>`).join("")}</ul>` : "";
  await ChatMessage.create({ speaker: speaker(), content: `<div class="ukm-chat ukm-royal"><h3><i class="fa-solid fa-crown"></i> ${esc(title)}</h3><p>${esc(text)}</p>${list}</div>` });
}

function who(userId) {
  return game.users.get(userId) ?? game.user;
}

/** Royal Court: the ruler holds court in the capital and the realm calms down (−1 Unrest). */
export async function royalCourt({ userId }) {
  const user = who(userId);
  if (!canUseRoyal(user)) return { ok: false, reason: "NotRuler" };
  if (!rulerUuid()) return { ok: false, reason: "NoRuler" };
  let spent = false;
  await updateRealm((realm) => {
    spent = spendUse(realm, "court");
    if (spent) addLog(realm, { type: "royal", text: loc("CourtName") });
  });
  if (!spent) return { ok: false, reason: "NoRoyalUse" };
  await setUnrest(getUnrest() - 1);
  await announce(loc("CourtName"), loc("CourtChat", { ruler: rulerName() ?? "" }));
  return { ok: true };
}

/** Royal Charge: the ruler urges a project on; it finishes a week sooner. */
export async function royalCharge({ cardId, userId }) {
  const user = who(userId);
  if (!canUseRoyal(user)) return { ok: false, reason: "NotRuler" };
  const card = getRealm().cards.find((c) => c.id === cardId);
  if (!card || card.kind !== "project" || card.status !== "assigned" || !card.workUntil) return { ok: false, reason: "NotWorking" };
  let spent = false;
  await updateRealm((realm) => {
    const target = realm.cards.find((c) => c.id === cardId);
    if (!target?.workUntil) return;
    spent = spendUse(realm, "charge");
    if (!spent) return;
    target.workUntil = Math.max(game.time.worldTime, target.workUntil - 7 * secondsPerDay());
    addLog(realm, { type: "royal", text: `${loc("ChargeName")}: ${target.name}` });
  });
  if (!spent) return { ok: false, reason: "NoRoyalUse" };
  await announce(loc("ChargeName"), loc("ChargeChat", { ruler: rulerName() ?? "", project: card.name }));
  // If that brought it due, it finishes now rather than at the next tick.
  const { resolveDue } = await import("./resolve.js");
  await resolveDue();
  return { ok: true };
}

/** Spend one of the ruler's favours. */
export async function useFavour({ favourId, userId }) {
  const user = who(userId);
  if (!canUseRoyal(user)) return { ok: false, reason: "NotRuler" };
  let ctx = null;
  let used = null;
  await updateRealm(async (realm) => {
    const list = realm.royal?.favours ?? [];
    used = list.find((f) => f.id === favourId);
    if (!used) return;
    realm.royal.favours = list.filter((f) => f.id !== favourId);
    ctx = new EffectContext({ realm, card: null, event: null });
    await applyEffects(ctx, used.effects ?? []);
    for (const task of ctx.gmTasks) realm.gmTasks.push(task);
    addLog(realm, { type: "royal", text: `${loc("FavourUsed")}: ${used.name}` });
  });
  if (!ctx || !used) return { ok: false, reason: "NoFavour" };
  await commitKingdomChanges(ctx);
  await announce(used.name, loc("FavourChat", { ruler: rulerName() ?? "" }), ctx.lines);
  Hooks.callAll(`${MODULE_ID}.refresh`);
  return { ok: true };
}

/** What a favour will do, for its button's tooltip. */
export function favourPreview(favour) {
  const effects = (favour.effects ?? []).map((e) => describeEffect(e)).filter(Boolean).join("; ");
  return [favour.text, effects].filter(Boolean).join(" ");
}
