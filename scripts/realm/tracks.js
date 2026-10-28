import { KINGDOM_SKILLS, REALM_STATS, RUINS } from "../constants.js";
import { getTrack, getTrackData, getTracks } from "../content/data.js";

/*
 * Settlement tracks (Realm Redesign, stage 3). A settlement grows along twelve tracks (Homes, Food,
 * Faith...). Each track goes starter → +1 → +2 → +3, and a metropolis can crown a +3 track with its
 * pinnacle (one of each per kingdom). A settlement stores { tracks: { homes: 0, faith: 1, ... },
 * pinnacles: ["monastery"] }; a track it hasn't started is missing (−1).
 *
 * - Homes sets the settlement's size: Huts = village, Tenements = town, Neighborhoods = city,
 *   Boroughs = metropolis, and each step also needs the kingdom's level (3, 9, 15).
 * - Every other track can go one stage past Homes (a village +1, a town +2, a city +3).
 * - A stage gives its number as an item bonus to that stage's skills, on checks in that settlement.
 * - Stages may also cut food, add BP a week, add realm-stat points a week, cut project costs,
 *   change Unrest, Ruin or Fame when built or each month (see data/tracks.json).
 */

export const NONE = -1;
export const PINNACLE = 4;
export const SIZES = ["village", "town", "city", "metropolis"];
/** Kingdom level each Homes stage needs (Huts, Tenements, Neighborhoods, Boroughs). */
const HOMES_LEVEL = [1, 3, 9, 15];

export function trackStage(settlement, trackId) {
  const value = settlement?.tracks?.[trackId];
  return Number.isInteger(value) ? value : NONE;
}

export function hasPinnacle(settlement, trackId) {
  return (settlement?.pinnacles ?? []).includes(trackId);
}

/** The size Homes gives a settlement. */
export function sizeFor(settlement) {
  return SIZES[Math.max(0, trackStage(settlement, "homes"))];
}

/** How far a track can go in this settlement right now. */
export function stageLimit(settlement, trackId, kingdomLevel) {
  if (trackId === "homes") {
    let limit = 0;
    for (let stage = 1; stage <= 3; stage++) if (kingdomLevel >= HOMES_LEVEL[stage]) limit = stage;
    return limit;
  }
  return Math.min(3, Math.max(0, trackStage(settlement, "homes")) + 1);
}

/** Pinnacles already standing anywhere in the kingdom. */
export function builtPinnacles(settlementList) {
  return new Set(settlementList.flatMap((s) => s.pinnacles ?? []));
}

/** Cost and time of a stage (0–3), or of a pinnacle (4). */
export function stageCost(stage) {
  const data = getTrackData();
  if (stage === PINNACLE) return data.pinnacleCost ?? { bp: 120, days: 28 };
  return data.costs?.[stage] ?? { bp: 10, days: 7 };
}

/** The data for one stage (0–3) or the pinnacle (4). */
export function stageDef(trackId, stage) {
  const track = getTrack(trackId);
  if (!track) return null;
  return stage === PINNACLE ? track.pinnacle ?? null : track.stages?.[stage] ?? null;
}

/**
 * What can be built next on a track in a settlement: { stage, def, cost, days } or a reason it can't.
 * `others` is every settlement in the kingdom (for the one-of-each pinnacle rule).
 */
export function nextStep(settlement, trackId, { kingdomLevel = 1, others = [], working = false } = {}) {
  const track = getTrack(trackId);
  if (!track) return { blocked: "Unknown" };
  if (working) return { blocked: "Working" };
  const current = trackStage(settlement, trackId);
  if (current >= 3) {
    if (!track.pinnacle || hasPinnacle(settlement, trackId)) return { blocked: "Done" };
    if (sizeFor(settlement) !== "metropolis") return { blocked: "NeedsMetropolis", stage: PINNACLE, def: track.pinnacle };
    if (builtPinnacles(others).has(trackId)) return { blocked: "PinnacleTaken", stage: PINNACLE, def: track.pinnacle };
    if (track.pinnacle.waterside && !settlement.waterside) return { blocked: "NeedsWater", stage: PINNACLE, def: track.pinnacle };
    return { stage: PINNACLE, def: track.pinnacle, ...stageCost(PINNACLE) };
  }
  const stage = current + 1;
  const def = track.stages[stage];
  if (stage > stageLimit(settlement, trackId, kingdomLevel)) {
    return { blocked: trackId === "homes" ? "NeedsLevel" : "NeedsHomes", stage, def, level: HOMES_LEVEL[stage] };
  }
  if (def.capitalOnly && !settlement.capital) return { blocked: "CapitalOnly", stage, def };
  return { stage, def, ...stageCost(stage) };
}

/** Every stage standing in a settlement (and its pinnacles), as { trackId, stage, def }. */
export function standing(settlement) {
  const out = [];
  for (const track of getTracks()) {
    const current = trackStage(settlement, track.id);
    for (let stage = 0; stage <= current; stage++) out.push({ trackId: track.id, stage, def: track.stages[stage] });
    if (hasPinnacle(settlement, track.id) && track.pinnacle) out.push({ trackId: track.id, stage: PINNACLE, def: track.pinnacle });
  }
  return out;
}

/** Only the top stage of each track counts for bonuses that don't add up (skills, events). */
function topStages(settlement) {
  return getTracks()
    .map((track) => ({ track, stage: trackStage(settlement, track.id) }))
    .filter(({ stage }) => stage >= 1)
    .map(({ track, stage }) => ({ trackId: track.id, stage, def: track.stages[stage] }));
}

/** Item bonuses a settlement's tracks give each skill: a stage's number, to that stage's skills. */
export function trackBonuses(settlement) {
  const out = {};
  for (const { stage, def } of topStages(settlement)) {
    for (const skill of def.skills ?? []) if (KINGDOM_SKILLS.includes(skill)) out[skill] = Math.max(out[skill] ?? 0, stage);
  }
  return out;
}

/** Bonus to every event check in this settlement (Walls). */
export function eventsBonus(settlement) {
  return Math.max(0, ...topStages(settlement).map(({ def }) => def.eventsHere ?? 0));
}

/** Food the settlement's tracks save (Food, Public Works...). Uses the top stage of each track. */
export function foodSaved(settlement) {
  return topStages(settlement).reduce((sum, { def }) => sum + (def.food ?? 0), 0);
}

/** Percent off projects in this settlement. */
export function discountHere(settlement) {
  return Math.max(0, ...topStages(settlement).map(({ def }) => def.discount ?? 0));
}

/** Kingdom-wide perks from every settlement: income, weekly stat points, monthly calm, discounts, food. */
export function kingdomPerks(settlementList) {
  const perks = { income: 0, points: {}, monthly: { unrest: 0, ruin: Object.fromEntries(RUINS.map((r) => [r, 0])) }, discountAll: 0, foodAll: 0, royalExtra: 0 };
  const add = (def) => {
    perks.income += def.income ?? 0;
    for (const [stat, n] of Object.entries(def.points ?? {})) if (REALM_STATS[stat]) perks.points[stat] = (perks.points[stat] ?? 0) + n;
    perks.monthly.unrest += def.monthly?.unrest ?? 0;
    for (const [ruin, n] of Object.entries(def.monthly?.ruin ?? {})) if (RUINS.includes(ruin)) perks.monthly.ruin[ruin] += n;
    perks.discountAll = Math.max(perks.discountAll, def.discountAll ?? 0);
    perks.foodAll += def.foodAll ?? 0;
    perks.royalExtra = Math.max(perks.royalExtra, def.royalExtra ?? 0);
  };
  for (const s of settlementList) {
    for (const { def } of topStages(s)) add(def);
    for (const trackId of s.pinnacles ?? []) {
      const def = getTrack(trackId)?.pinnacle;
      if (def) add(def);
    }
  }
  return perks;
}

/** Food a settlement needs a week, by size. */
const NEED = { village: 1, town: 2, city: 4, metropolis: 6 };

export function foodNeed(settlement, foodAll = 0) {
  return Math.max(0, (NEED[sizeFor(settlement)] ?? 1) - foodSaved(settlement) - foodAll);
}

/** What a settlement of its size is expected to have (tracks.json "needs"), and which of those it lacks. */
export function missingNeeds(settlement) {
  const expected = getTrackData().needs?.[sizeFor(settlement)] ?? {};
  return Object.entries(expected)
    .filter(([trackId, min]) => trackStage(settlement, trackId) < min)
    .map(([trackId, min]) => ({ trackId, min }));
}

/**
 * Old-style building names for events and goals that still ask "does the kingdom have a ...?"
 * (Plague checks for a Sewer System, Local Disaster for a Cemetery...).
 */
const LEGACY = [
  ["publicworks", 1, ["dump", "paved-streets"]],
  ["publicworks", 3, ["sewer-system", "magical-streetlamps"]],
  ["faith", 0, ["shrine"]],
  ["faith", 2, ["temple", "cemetery"]],
  ["faith", 3, ["cathedral"]],
  ["learning", 1, ["library"]],
  ["learning", 2, ["academy", "museum"]],
  ["learning", 3, ["university"]],
  ["homes", 2, ["mansion"]],
  ["homes", 3, ["noble-villa"]],
  ["food", 2, ["tavern-popular"]],
  ["food", 3, ["inn"]],
  ["watch", 2, ["jail"]],
  ["walls", 1, ["wall-wooden"]],
  ["walls", 2, ["wall-stone"]],
  ["army", 1, ["barracks"]],
  ["army", 2, ["garrison"]],
  ["commerce", 1, ["marketplace"]],
  ["commerce", 3, ["bank"]],
  ["governance", 2, ["town-hall"]],
  ["governance", 3, ["palace"]],
  ["performance", 2, ["theater"]],
  ["industry", 3, ["smithy"]]
];

export function legacySlugs(settlementList) {
  const out = new Set();
  for (const s of settlementList) for (const [trackId, stage, slugs] of LEGACY) if (trackStage(s, trackId) >= stage) slugs.forEach((x) => out.add(x));
  return [...out];
}

/**
 * Settlements from before tracks had buildings. Turn each building into the track stage that
 * matches it best, and the old size into Homes. Approximate on purpose.
 */
const FROM_BUILDING = {
  "founders-hall": [["homes", 0], ["food", 0]],
  tenement: [["homes", 1]], houses: [["homes", 0]], mansion: [["homes", 2]], "noble-villa": [["homes", 3]], orphanage: [["homes", 1]],
  shrine: [["faith", 0]], temple: [["faith", 2]], cathedral: [["faith", 3]], cemetery: [["faith", 1]],
  "festival-hall": [["performance", 1]], theater: [["performance", 2]], "opera-house": [["performance", 3]], arena: [["performance", 3]],
  "general-store": [["commerce", 0]], marketplace: [["commerce", 1]], "luxury-store": [["commerce", 2]], bank: [["commerce", 3]], mint: [["commerce", 3]],
  "trade-shop": [["industry", 1]], lumberyard: [["industry", 1]], stonemason: [["industry", 1]], foundry: [["industry", 2]], smithy: [["industry", 2]], "construction-yard": [["industry", 3]], guildhall: [["industry", 3]],
  "town-hall": [["governance", 2]], castle: [["governance", 2]], palace: [["governance", 3]], embassy: [["governance", 2]],
  jail: [["watch", 2]], "thieves-guild": [["watch", 0]],
  "wall-wooden": [["walls", 1]], "wall-stone": [["walls", 2]], watchtower: [["walls", 1]], keep: [["walls", 3]],
  barracks: [["army", 1]], garrison: [["army", 2]], "military-academy": [["army", 3]],
  library: [["learning", 1]], academy: [["learning", 2]], university: [["learning", 3]], "arcanists-tower": [["learning", 1]], "magic-shop": [["learning", 2]],
  "paved-streets": [["publicworks", 1]], dump: [["publicworks", 0]], "sewer-system": [["publicworks", 3]], "magical-streetlamps": [["publicworks", 2]], bridge: [["publicworks", 1]],
  "tavern-dive": [["food", 1]], "tavern-popular": [["food", 2]], "tavern-luxury": [["food", 3]], "tavern-world-class": [["food", 3]], inn: [["food", 3]],
  mill: [["food", 1]], granary: [["food", 1]], stockyard: [["food", 1]], pier: [["commerce", 0]], waterfront: [["commerce", 2]]
};
const HOMES_FROM_SIZE = { village: 0, town: 1, city: 2, metropolis: 3 };

export function tracksFromBuildings(settlement, kingdomLevel = 20) {
  const tracks = {};
  const raise = (id, stage) => {
    tracks[id] = Math.max(tracks[id] ?? NONE, stage);
  };
  raise("homes", HOMES_FROM_SIZE[settlement.type] ?? 0);
  for (const b of settlement.buildings ?? []) for (const [id, stage] of FROM_BUILDING[b.slug] ?? []) raise(id, stage);
  // Keep within what the settlement's size allows.
  const homes = Math.min(tracks.homes, stageLimit({ tracks }, "homes", kingdomLevel));
  tracks.homes = homes;
  for (const id of Object.keys(tracks)) if (id !== "homes") tracks[id] = Math.min(tracks[id], Math.min(3, Math.max(0, homes) + 1));
  return tracks;
}
