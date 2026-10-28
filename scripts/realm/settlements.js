import { MODULE_ID, RUINS, SKILL_TO_STAT } from "../constants.js";
import { getKingdom } from "../integrations/party.js";
import { getSetting, SETTINGS } from "../settings.js";
import { settlementHexes } from "./deck.js";
import { addLog, getRealm, newId, updateRealm } from "./state.js";
import { isLeader } from "./leader.js";
import { hasTenements, isCrimeCard } from "./troubles.js";
import {
  eventsBonus,
  foodNeed,
  kingdomPerks,
  legacySlugs,
  missingNeeds,
  NONE,
  PINNACLE,
  sizeFor,
  stageDef,
  trackBonuses,
  trackStage,
  tracksFromBuildings
} from "./tracks.js";

/** Settlement sizes, from the Kingmaker rules. Lots are what the urban grid can hold. */
export const SETTLEMENT_INFO = {
  village: { minLevel: 1, lots: 4, consumption: 1, maxItem: 1, growAt: 4, next: "town" },
  town: { minLevel: 3, lots: 16, consumption: 2, maxItem: 1, growAt: 8, next: "city" },
  city: { minLevel: 9, lots: 36, consumption: 4, maxItem: 2, growAt: 18, next: "metropolis" },
  metropolis: { minLevel: 15, lots: 72, consumption: 6, maxItem: 3, growAt: null, next: null }
};

export const SETTLEMENT_ORDER = ["village", "town", "city", "metropolis"];

const QUELL_SKILLS = ["arts", "folklore", "intrigue", "magic", "politics", "warfare"];

/** Which kingdom skills each tabletop activity is rolled with. */
const ACTIVITIES = [
  [/creative solution/i, ["scholarship"]],
  [/supernatural solution|prognostication/i, ["magic"]],
  [/celebrate holiday/i, ["folklore"]],
  [/create a masterpiece|craft luxuries/i, ["arts"]],
  [/provide care/i, ["defense"]],
  [/demolish/i, ["engineering"]],
  [/build structure/i, ["engineering", "industry"]],
  [/establish work site/i, ["industry", "engineering"]],
  [/harvest crops/i, ["agriculture"]],
  [/gather livestock/i, ["wilderness"]],
  [/go fishing/i, ["boating"]],
  [/hire adventurers/i, ["exploration"]],
  [/trade commodities/i, ["industry"]],
  [/purchase commodities|establish trade agreement|capital investment|collect taxes|tap treasury/i, ["trade"]],
  [/clandestine business|infiltration/i, ["intrigue"]],
  [/improve lifestyle|new leadership/i, ["politics"]],
  [/send diplomatic envoy|request foreign aid/i, ["statecraft"]],
  [/pledge of fealty/i, ["statecraft"], true],
  [/(garrison|recover|recruit|deploy|outfit|train) army/i, ["warfare"]],
  [/repair reputation \(corruption\)/i, ["arts"]],
  [/repair reputation \(crime\)/i, ["trade"]],
  [/repair reputation \(decay\)/i, ["engineering"]],
  [/repair reputation \(strife\)/i, ["intrigue"]],
  [/quell unrest/i, QUELL_SKILLS, true],
  [/rest and relax/i, ["arts", "boating", "exploration", "scholarship", "trade", "wilderness"], true]
];

function skillWord(word) {
  const slug = word?.toLowerCase();
  return slug && SKILL_TO_STAT[slug] ? slug : null;
}

/** "+1 item bonus to Quell Unrest using Magic" → [{ value: 1, skills: ["magic"] }] */
export function parseItemBonus(text) {
  if (!text) return [];
  const out = [];
  for (const segment of text.split(/(?=\+\d)/)) {
    const value = Number(segment.match(/^\+(\d+)/)?.[1]);
    if (!value) continue;
    if (/resolve events/i.test(segment)) {
      out.push({ value, skills: [], events: true });
      continue;
    }
    const skills = new Set();
    for (const [pattern, list, narrows] of ACTIVITIES) {
      const match = segment.match(pattern);
      if (!match) continue;
      let picked = null;
      if (narrows) {
        const after = segment.slice(match.index + match[0].length, match.index + match[0].length + 24);
        const before = segment.slice(Math.max(0, match.index - 30), match.index);
        picked = skillWord(after.match(/^\s*using\s+(\w+)/i)?.[1]) ?? skillWord(before.match(/(\w+)\s+checks\s+made\s+to\s+$/i)?.[1]);
      }
      for (const skill of picked ? [picked] : list) skills.add(skill);
    }
    if (skills.size) out.push({ value, skills: [...skills] });
  }
  return out;
}

function textOf(node) {
  return (node?.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** Read one structure page of the imported Structures journal. */
export function parseStructureHtml(html) {
  const div = document.createElement("div");
  div.innerHTML = (html ?? "").replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1");
  const fields = {};
  for (const p of div.querySelectorAll("p")) {
    const labels = [...p.querySelectorAll("strong")];
    if (!labels.length) continue;
    const text = textOf(p);
    labels.forEach((label, i) => {
      const name = textOf(label);
      const start = text.indexOf(name) + name.length;
      const end = labels[i + 1] ? text.indexOf(textOf(labels[i + 1]), start) : text.length;
      fields[name.toLowerCase()] = text.slice(start, end).replace(/;\s*$/, "").trim();
    });
  }
  const header = textOf(div.querySelector("header")) || textOf(div);
  const traits = [...div.querySelectorAll("ul li")].slice(0, 8).map((li) => textOf(li).toLowerCase());
  const found = header.match(/(?:Structure|Building)\s+(\d+)/i)?.[1];
  const lots = Number(fields.lots);
  const ruinText = fields.ruin ?? "";
  let ruin = null;
  if (/choice/i.test(ruinText)) ruin = { choice: Number(ruinText.match(/\d+/)?.[0] ?? 1) };
  else {
    const named = RUINS.find((r) => new RegExp(r, "i").test(ruinText));
    if (named) ruin = { [named]: Number(ruinText.match(/\d+/)?.[0] ?? 1) };
  }
  const effects = fields.effects ?? fields.effect ?? "";
  const consumption = /(reduce|reduces)[^.]*Consumption by (\d+)/i.exec(effects);
  return {
    level: found === undefined ? null : Number(found),
    costText: fields.cost ?? null,
    skill: (fields.construction ?? "").match(/^([A-Za-z]+)/)?.[1]?.toLowerCase() ?? null,
    lots: Number.isFinite(lots) ? lots : 0,
    infrastructure: traits.includes("infrastructure"),
    residential: traits.includes("residential"),
    edifice: traits.includes("edifice"),
    famous: traits.includes("famous") || traits.includes("infamous"),
    bonuses: parseItemBonus(fields["item bonus"]),
    bonusText: fields["item bonus"] ?? "",
    ruin,
    upgradeFrom: fields["upgrade from"] ?? null,
    unrest: Number(/reduce Unrest by (\d+)/i.exec(effects)?.[1] ?? 0),
    consumption: consumption ? Number(consumption[2]) : 0,
    needsWater: !!consumption && /water/i.test(effects),
    capitalOnly: /only be built in your capital/i.test(effects)
  };
}

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
 * Buildings of the module's own, not in the Kingmaker book. The capital gets a Founders' Hall for free:
 * it houses the first settlers (counts as a home) and its stores cut the settlement's food need by 1.
 */
export const FOUNDERS_HALL = "founders-hall";
const BUILTIN_STRUCTURES = [
  {
    slug: FOUNDERS_HALL,
    name: "Founders' Hall",
    level: 0,
    lots: 1,
    residential: true,
    edifice: true,
    capitalOnly: true,
    consumption: 1,
    bonuses: [],
    builtin: true
  }
];

export function catalogEntry(slug) {
  return BUILTIN_STRUCTURES.find((s) => s.slug === slug) ?? (getSetting(SETTINGS.structureCatalog) ?? []).find((s) => s.slug === slug) ?? null;
}

function buildingInfo(building) {
  return { ...building, ...(catalogEntry(building.slug) ?? {}) };
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
    buildings: [],
    stages,
    lots: stages,
    capacity: Infinity,
    level: { village: 1, town: 3, city: 9, metropolis: 15 }[type],
    overcrowded: false,
    consumption: foodNeed(settlement, kingdomPerks(list).foodAll),
    missing: missingNeeds(settlement)
  };
}

/** Size comes from Homes now; nothing grows on its own. Kept for older callers. */
export function canGrow() {
  return null;
}

export function roomFor() {
  return Infinity;
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

/** Item bonus from buildings on a kingdom check: the card's settlement, or the best one in the realm. */
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
  return out;
}

/** Old building names the realm's tracks stand for, for events that ask "does the kingdom have a ...". */
export function builtSlugs(realm) {
  return legacySlugs(settlements(realm));
}

export function refreshDerived(realm) {
  if (settlements(realm).length || realm.settlementsStarted) realm.structures = builtSlugs(realm);
}

/** Keep a settlement's size in step with its Homes. */
export function fitSize(settlement) {
  settlement.type = sizeFor(settlement);
  return settlement;
}

export function growIfReady() {
  return [];
}

export async function growSettlements() {}

/**
 * Run once when the GM's window starts. Settlements from before tracks (with buildings) get tracks
 * that match their buildings and size; the buildings are kept aside, unused, as "legacyBuildings".
 */
export async function repairSettlements() {
  if (!isLeader()) return;
  const realm = getRealm();
  const stale = settlements(realm).some((s) => !s.tracks || s.type !== sizeFor(s));
  if (!stale) return;
  const level = getKingdom()?.level ?? 1;
  await updateRealm((r) => {
    for (const s of settlements(r)) {
      if (!s.tracks) {
        s.tracks = tracksFromBuildings(s, level);
        if (s.buildings?.length) s.legacyBuildings = s.buildings;
        s.buildings = [];
        s.pinnacles ??= [];
        addLog(r, { type: "settlement-tracks", text: s.name });
      }
      s.type = sizeFor(s);
    }
    if (settlements(r).length) r.settlementsStarted = true;
    refreshDerived(r);
  });
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
    buildings: [],
    tracks: homes ? { homes } : {},
    pinnacles: [],
    founded: game.time.worldTime
  };
}

/**
 * A building project started before tracks finished: count it as the track stage it matches.
 * (New work is done with "Develop a settlement".)
 */
export function addBuilding(realm, settlementId, structure, ctx = null) {
  const settlement = settlements(realm).find((s) => s.id === settlementId);
  if (!settlement) return null;
  const raised = tracksFromBuildings({ type: "village", buildings: [{ slug: structure.slug }] });
  settlement.tracks ??= {};
  for (const [trackId, stage] of Object.entries(raised)) {
    if (trackId === "homes" && stage === 0 && trackStage(settlement, "homes") >= 0) continue;
    if (stage > trackStage(settlement, trackId)) settlement.tracks[trackId] = stage;
  }
  fitSize(settlement);
  ctx?.note(game.i18n.format("UKM.Track.FromBuilding", { name: structure.name, settlement: settlement.name }));
  refreshDerived(realm);
  return settlement;
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
  refreshDerived(realm);
  return settlement;
}

export function removeBuilding(realm, settlementId, index) {
  const settlement = settlements(realm).find((s) => s.id === settlementId);
  if (!settlement?.buildings?.[index]) return;
  settlement.buildings.splice(index, 1);
  refreshDerived(realm);
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
    refreshDerived(r);
  });
  await syncKingdomSettlements();
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
  await syncKingdomSettlements();
}

/**
 * Settlements used to be copied onto the PF2e kingdom sheet so its Consumption matched. The kingdom's
 * numbers are this module's own now (food is added up from the Settlements tab), so there's nothing to copy.
 */
export async function syncKingdomSettlements() {}

/** Overcrowded settlements each add 1 Unrest a month. */
export function overcrowdedCount(realm) {
  return settlements(realm).filter((s) => settlementState(s).overcrowded).length;
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
