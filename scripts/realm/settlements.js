import { MODULE_ID, RUINS } from "../constants.js";
import { getCardEvent } from "../content/data.js";
import { getKingdom } from "../integrations/party.js";
import { settlementHexes } from "./deck.js";
import { addLog, getRealm, newId, updateRealm } from "./state.js";
import { isLeader } from "./leader.js";
import { hasTenements, isCrimeCard } from "./troubles.js";
import {
  eventsBonus,
  foodNeed,
  hasPinnacle,
  kingdomPerks,
  missingNeeds,
  NONE,
  PINNACLE,
  sizeFor,
  stageDef,
  trackBonuses,
  trackStage
} from "./tracks.js";

/** Settlement sizes, from the Kingmaker rules. */
export const SETTLEMENT_INFO = {
  village: { minLevel: 1, consumption: 1 },
  town: { minLevel: 3, consumption: 2 },
  city: { minLevel: 9, consumption: 4 },
  metropolis: { minLevel: 15, consumption: 6 }
};

export const SETTLEMENT_ORDER = ["village", "town", "city", "metropolis"];

/* ---------- Settlements in the realm ---------- */

export function settlements(realm = getRealm()) {
  return realm.settlements ?? [];
}

export function capital(realm = getRealm()) {
  return settlements(realm).find((s) => s.capital) ?? null;
}

export function hasCapital(realm = getRealm()) {
  return !!capital(realm);
}

/**
 * A settlement's size, food need and how built-up it is, from its tracks (stage 3 of the redesign).
 * "stages" counts every stage standing, so a busier settlement counts as bigger for events.
 */
export function settlementState(settlement, realm = null) {
  const type = sizeFor(settlement);
  const info = SETTLEMENT_INFO[type] ?? SETTLEMENT_INFO.village;
  const list = realm ? settlements(realm) : settlements();
  const stages = Object.values(settlement.tracks ?? {}).reduce((sum, n) => sum + (Number.isInteger(n) && n >= 0 ? n + 1 : 0), 0) + (settlement.pinnacles?.length ?? 0) * 5;
  return {
    info,
    type,
    stages,
    level: info.minLevel,
    consumption: foodNeed(settlement, kingdomPerks(list).foodAll),
    missing: missingNeeds(settlement)
  };
}

/** Item bonuses a settlement gives each kingdom skill: each track's top stage, to that stage's skills. */
export function settlementBonuses(settlement) {
  return trackBonuses(settlement);
}

/** The settlement a card is about, if any. */
export function cardSettlement(card, realm = getRealm()) {
  const list = settlements(realm);
  if (card?.target?.settlementId) return list.find((s) => s.id === card.target.settlementId) ?? null;
  const name = card?.target?.settlement?.toLowerCase();
  return name ? list.find((s) => s.name.toLowerCase() === name) ?? null : null;
}

/** Item bonus from settlement tracks on a kingdom check: the card's settlement, or the best one in the realm. */
export function structureModifiers(realm, card, skill) {
  const here = cardSettlement(card, realm);
  const pool = here ? [here] : settlements(realm);
  let best = 0;
  let from = null;
  for (const s of pool) {
    let value = settlementBonuses(s)[skill] ?? 0;
    if (here && s === here) value = Math.max(value, eventsBonus(s));
    if (value > best) {
      best = value;
      from = s;
    }
  }
  const out = best ? [{ slug: `ukm-structures-${skill}`, label: game.i18n.format("UKM.Settlement.BonusLabel", { name: from.name }), modifier: best, type: "item" }] : [];
  // Tenements: crime checks there take −1 (dirty streets).
  if (here && hasTenements(here) && isCrimeCard(card)) out.push({ slug: "ukm-dirty-streets", label: game.i18n.localize("UKM.Trouble.DirtyStreets"), modifier: -1, type: "circumstance" });
  out.push(...eventSpecials(realm, card).modifiers);
  if (here && card?.project?.track) out.push(...whileActiveModifiers(realm, here));
  return out;
}

/* ---------- Events that care about a settlement's tracks ---------- */

const LIVE = ["open", "assigned", "rolled", "escalated"];

/** Whether the card's settlement (or, for a card not tied to one, any settlement) has a track at a stage or higher. */
export function hasTrackStage(realm, card, trackId, stage = 0) {
  const here = cardSettlement(card, realm);
  return (here ? [here] : settlements(realm)).some((s) => hasPinnacle(s, trackId) || trackStage(s, trackId) >= stage);
}

/**
 * A condition in the event data: { track, stage } is "has that track at that stage or higher",
 * { lacksTrack, stage } the opposite. Returns null for anything that isn't a track condition.
 */
export function trackCondition(realm, card, condition = {}) {
  if (condition.track) return hasTrackStage(realm, card, condition.track, condition.stage ?? 0);
  if (condition.lacksTrack) return !hasTrackStage(realm, card, condition.lacksTrack, condition.stage ?? 0);
  return null;
}

/**
 * An event's special rules for this card, from its "special" list: check modifiers (all checks, or one
 * stage's), a DC that rises with how many settlements have a track, a result one step better or worse,
 * and halved resource-dice losses.
 */
export function eventSpecials(realm, card) {
  const event = getCardEvent(card);
  const out = { modifiers: [], dc: 0, degree: 0, halveBpLoss: false };
  (event?.special ?? []).forEach((rule, i) => {
    if (rule.modPerTrack) {
      const { track, stage = 0, each = 1, max = Infinity } = rule.modPerTrack;
      const n = settlements(realm).filter((s) => hasPinnacle(s, track) || trackStage(s, track) >= stage).length;
      out.dc += Math.min(max, n * each);
      return;
    }
    if (!trackCondition(realm, card, rule.if)) return;
    for (const then of rule.then ?? []) {
      const mod = then.checkModifier ?? (then.stageModifier && (card.stage ?? 0) === then.stageModifier.stage ? then.stageModifier : null);
      if (mod) out.modifiers.push({ slug: `ukm-special-${event.id}-${i}`, label: event.name, modifier: mod.value, type: mod.type ?? "circumstance" });
      if (then.degree) out.degree += then.degree;
      if (then.halveBpDiceLoss) out.halveBpLoss = true;
    }
  });
  return out;
}

/** Ongoing events in a settlement that hold back building there (a plague without sewers, say). */
function whileActiveModifiers(realm, settlement) {
  const out = [];
  for (const other of realm.cards ?? []) {
    if (!LIVE.includes(other.status) || cardSettlement(other, realm) !== settlement) continue;
    const event = getCardEvent(other);
    for (const rule of event?.whileActive ?? []) {
      if (rule.if && !trackCondition(realm, other, rule.if)) continue;
      for (const then of rule.then ?? []) {
        if (then.settlementModifier?.selector === "build") out.push({ slug: `ukm-while-${event.id}`, label: event.name, modifier: then.settlementModifier.value, type: then.settlementModifier.type ?? "status" });
      }
    }
  }
  return out;
}

/** The event stopping a track from being raised in a settlement (squatters stop new Homes), if any. */
export function trackBlockedBy(realm, settlement, trackId) {
  for (const other of realm.cards ?? []) {
    if (!LIVE.includes(other.status) || cardSettlement(other, realm) !== settlement) continue;
    const event = getCardEvent(other);
    if ((event?.whileActive ?? []).some((rule) => rule.blockTrack === trackId)) return event.name;
  }
  return null;
}

/** Keep a settlement's size in step with its Homes. */
export function fitSize(settlement) {
  settlement.type = sizeFor(settlement);
  return settlement;
}

/** Map hex of a settlement, matched by the name the GM gave it on the Kingmaker map. */
export function settlementHex(settlement) {
  if (settlement.hexKey) return settlement.hexKey;
  const name = settlement.name.toLowerCase();
  return settlementHexes().find((h) => h.name?.toLowerCase() === name)?.key ?? null;
}

/** Settlements drawn on the map that the realm doesn't know about yet. */
export function unknownMapSettlements(realm = getRealm()) {
  const names = new Set(settlements(realm).map((s) => s.name.toLowerCase()));
  const keys = new Set(settlements(realm).map((s) => s.hexKey).filter(Boolean).map(String));
  return settlementHexes().filter((h) => h.name && !names.has(h.name.toLowerCase()) && !keys.has(String(h.key)));
}

export function newSettlement({ name, type = "village", capital = false, waterside = false, hexKey = null }) {
  // A settlement drawn on the map as a town or city starts with Homes to match.
  const homes = Math.max(0, SETTLEMENT_ORDER.indexOf(type));
  return {
    id: newId(),
    name: name.trim().slice(0, 60),
    type: SETTLEMENT_ORDER[homes] ?? "village",
    capital,
    waterside: !!waterside,
    hexKey,
    tracks: homes ? { homes } : {},
    pinnacles: [],
    founded: game.time.worldTime
  };
}

/**
 * A track reaches a new stage (or its pinnacle): the settlement grows, Homes may change its size,
 * and the stage's "when built" effects go into the outcome. ctx is the effects context, if any.
 */
export function applyTrackStage(realm, settlementId, trackId, stage, ctx = null, { free = false } = {}) {
  const settlement = settlements(realm).find((s) => s.id === settlementId);
  if (!settlement) return null;
  const before = sizeFor(settlement);
  settlement.tracks ??= {};
  settlement.pinnacles ??= [];
  if (stage === PINNACLE) {
    if (!settlement.pinnacles.includes(trackId)) settlement.pinnacles.push(trackId);
  } else if (stage <= NONE) {
    delete settlement.tracks[trackId];
  } else {
    settlement.tracks[trackId] = stage;
    settlement.pinnacles = settlement.pinnacles.filter((p) => p !== trackId);
  }
  fitSize(settlement);
  const def = stage === PINNACLE || stage >= 0 ? stageDef(trackId, stage) : null;
  if (ctx && def && !free) {
    if (def.onBuild?.unrest) ctx.unrest += def.onBuild.unrest;
    if (def.onBuild?.fame) ctx.fame += def.onBuild.fame;
    for (const [ruin, amount] of Object.entries(def.onBuild?.ruin ?? {})) if (RUINS.includes(ruin)) ctx.ruin[ruin] += amount;
    ctx.note(game.i18n.format("UKM.Track.Built", { stage: def.name, settlement: settlement.name }));
    if (def.description) ctx.note(`<em>${Handlebars.escapeExpression(def.description)}</em>`);
  }
  const after = sizeFor(settlement);
  if (after !== before) {
    const text = game.i18n.format("UKM.Settlement.Grew", { name: settlement.name, type: game.i18n.localize(`UKM.Settlement.Type.${after}`) });
    ctx?.note(text);
    addLog(realm, { type: "settlement-grew", text: `${settlement.name} (${game.i18n.localize(`UKM.Settlement.Type.${after}`)})` });
  }
  addLog(realm, { type: "track-stage", text: `${settlement.name}: ${def?.name ?? trackId}` });
  return settlement;
}

/* ---------- Founding ---------- */

/**
 * The party's first step: name the capital. It can be a settlement already on the map,
 * or a new village the GM then draws on the hex the party picked.
 * request: { name, mapHex, waterside, where, userId }
 */
export async function foundCapital(request) {
  const user = game.users.get(request.userId) ?? game.user;
  if (!canFoundCapital(user)) return { ok: false, reason: "NotYourSeat" };
  const realm = getRealm();
  if (hasCapital(realm)) return { ok: false, reason: "HasCapital" };
  const fromMap = request.mapHex ? settlementHexes().find((h) => h.key === String(request.mapHex)) : null;
  const name = (fromMap?.name ?? request.name ?? "").trim();
  if (!name) return { ok: false, reason: "NoName" };
  const where = String(request.where ?? "").trim().slice(0, 80);

  await updateRealm((r) => {
    r.settlements ??= [];
    let record = r.settlements.find((s) => s.name.toLowerCase() === name.toLowerCase());
    if (!record) {
      record = newSettlement({ name, type: fromMap?.type ?? "village", waterside: request.waterside, hexKey: fromMap?.key ?? null });
      r.settlements.push(record);
    }
    record.capital = true;
    if (request.waterside !== undefined && !fromMap) record.waterside = !!request.waterside;
    // The first village comes with its basic starters: huts, a campfire and a shrine (Realm Redesign).
    record.tracks ??= {};
    for (const trackId of ["homes", "food", "faith"]) if (trackStage(record, trackId) < 0) record.tracks[trackId] = 0;
    record.pinnacles ??= [];
    r.settlementsStarted = true;
    fitSize(record);
    if (!fromMap) {
      const place = where ? game.i18n.format("UKM.Project.PartyWhere", { where }) : game.i18n.localize("UKM.Project.PartyHex");
      r.gmTasks.push({ id: newId(), text: game.i18n.format("UKM.Settlement.CapitalTask", { name, where: place }), card: null, hexKey: null, created: game.time.worldTime, done: false });
    }
    addLog(r, { type: "capital", text: name });
  });
  const kingdom = getKingdom();
  if (kingdom) await kingdom.update({ capital: name });
  await ChatMessage.create({
    speaker: { alias: kingdom?.name || game.i18n.localize("UKM.Manager.Unnamed") },
    content: `<div class="ukm-chat"><h3>${game.i18n.format("UKM.Settlement.CapitalChatTitle", { name: Handlebars.escapeExpression(name) })}</h3><p>${game.i18n.localize("UKM.Settlement.CapitalChat")}</p></div>`
  });
  Hooks.callAll(`${MODULE_ID}.capitalFounded`, { name });
  return { ok: true };
}

/** Founding the capital is part of the GM's setup (Setup window or the Settlements tab). */
export function canFoundCapital(user) {
  return !!user?.isGM;
}

/** Settlements the GM drew on the map after the capital was set join the realm on their own. */
export async function adoptMapSettlements() {
  if (!isLeader()) return;
  const realm = getRealm();
  if (!hasCapital(realm)) return;
  const fresh = unknownMapSettlements(realm);
  if (!fresh.length) return;
  await updateRealm((r) => {
    for (const hex of fresh) {
      r.settlements.push(newSettlement({ name: hex.name, type: hex.type, hexKey: hex.key }));
      r.settlementsStarted = true;
      addLog(r, { type: "settlement", text: hex.name });
    }
  });
}

export const NAME_LIMIT = 40;

/** The GM renames a settlement (the capital from Setup). Cards that name it follow along. */
export async function renameSettlement(settlementId, newName) {
  const name = String(newName ?? "").trim().slice(0, NAME_LIMIT);
  if (!name) return { ok: false, reason: "NoName" };
  const realm = getRealm();
  const target = (realm.settlements ?? []).find((s) => s.id === settlementId);
  if (!target) return { ok: false, reason: "Unknown" };
  if (target.name === name) return { ok: true };
  if (realm.settlements.some((s) => s.id !== settlementId && s.name.toLowerCase() === name.toLowerCase())) return { ok: false, reason: "NameTaken" };
  const old = target.name;
  await updateRealm((r) => {
    const s = r.settlements.find((x) => x.id === settlementId);
    if (!s) return;
    // Remember its hex first, so the map's old label isn't mistaken for a new settlement.
    s.hexKey ??= settlementHex(s);
    s.name = name;
    for (const card of r.cards ?? []) if (card.target?.settlement === old) card.target.settlement = name;
    addLog(r, { type: "settlement-renamed", text: `${old} → ${name}` });
  });
  if (target.capital) await getKingdom()?.update({ capital: name });
  return { ok: true };
}
