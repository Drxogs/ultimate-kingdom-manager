import { POINTS_PER_RANK, REALM_STATS, SKILL_ABILITY } from "../constants.js";
import { getKingdom } from "../integrations/party.js";
import { rankCap, seatFilled, weeklyIncome } from "./rules.js";
import { addLog, getRealm, updateRealm } from "./state.js";

const ABILITY_LEVELS = [5, 10, 15, 20];

/** Where each realm stat would sit for a kingdom of this level that's been run well from the start. */
export function suggestedRanks(level, realm = getRealm()) {
  const cap = rankCap(level);
  const founding = new Set(realm.founding?.stats ?? []);
  return Object.fromEntries(
    Object.entries(REALM_STATS).map(([stat, def]) => {
      let rank;
      if (founding.has(stat)) rank = cap;
      else if (seatFilled(def.seat).filled) rank = cap - 1;
      else rank = cap - 2;
      return [stat, Math.max(0, Math.min(cap, rank))];
    })
  );
}

export function suggestedTreasury(realm = getRealm()) {
  return Math.max(realm.treasury, Math.round(weeklyIncome(realm).base * 4));
}

/**
 * Skills the realm leans on: one from each filled seat first, then their second skills,
 * then the empty seats'.
 */
function skillPriority() {
  const filled = Object.values(REALM_STATS).filter((def) => seatFilled(def.seat).filled);
  const empty = Object.values(REALM_STATS).filter((def) => !seatFilled(def.seat).filled);
  return [...filled.map((d) => d.skills[0]), ...filled.map((d) => d.skills[1]), ...empty.flatMap((d) => d.skills)];
}

function maxRankAt(level) {
  if (level >= 15) return 4;
  if (level >= 7) return 3;
  return 2;
}

/**
 * A plain kingdom skill plan for a given level: four trained skills at founding (besides the
 * government's), then one increase at 3rd level and every odd level after, raising those four
 * evenly as far as the level allows. Never lowers anything already on the sheet.
 */
export function skillPlan(level, kingdom = getKingdom()) {
  const order = skillPriority();
  const government = new Set(kingdom?.build?.government?.skills ?? []);
  const ranks = Object.fromEntries(order.map((s) => [s, government.has(s) ? 1 : 0]));
  const core = order.filter((s) => !government.has(s)).slice(0, 4);
  for (const skill of core) ranks[skill] = 1;
  for (let at = 3; at <= level; at += 2) {
    const cap = maxRankAt(at);
    const pool = core.filter((s) => ranks[s] < cap);
    const candidates = pool.length ? pool : order.filter((s) => ranks[s] < cap);
    if (!candidates.length) continue;
    const lowest = Math.min(...candidates.map((s) => ranks[s]));
    ranks[candidates.find((s) => ranks[s] === lowest)] += 1;
  }
  const current = kingdom?.build?.skills ?? {};
  return order.map((skill) => {
    const now = current[skill]?.rank ?? 0;
    const planned = Math.max(now, ranks[skill]);
    return { skill, now, planned, changed: planned > now };
  });
}

/** Ability boosts for kingdom levels already reached that were never chosen. */
export function boostPlan(level, kingdom = getKingdom()) {
  const focus = skillPriority().slice(0, 4);
  const weight = {};
  for (const skill of focus) {
    const ability = SKILL_ABILITY[skill];
    weight[ability] = (weight[ability] ?? 0) + 1;
  }
  const abilities = ["culture", "economy", "loyalty", "stability"].sort((a, b) => (weight[b] ?? 0) - (weight[a] ?? 0));
  const out = [];
  for (const at of ABILITY_LEVELS) {
    if (at > level) continue;
    const chosen = kingdom?.build?.boosts?.[at] ?? [];
    if (chosen.length >= 2) continue;
    out.push({ level: at, boosts: abilities.slice(0, 2) });
  }
  return out;
}

/**
 * Put the realm where it would be had the module been running from the start.
 * data: { ranks: { stat: rank }, treasury, skills: bool, boosts: bool }
 */
export async function applyStartingPoint(data) {
  const kingdom = getKingdom();
  const level = kingdom?.level ?? 1;
  const cap = rankCap(level);
  await updateRealm((realm) => {
    for (const [stat, value] of Object.entries(data.ranks ?? {})) {
      if (!realm.stats[stat]) continue;
      const rank = Math.max(0, Math.min(cap, Math.floor(Number(value) || 0)));
      realm.stats[stat] = { points: Math.max(realm.stats[stat].points, rank * POINTS_PER_RANK), rank };
    }
    if (Number.isFinite(Number(data.treasury))) realm.treasury = Math.max(0, Math.round(Number(data.treasury)));
    realm.startingPoint = { level, time: game.time.worldTime };
    addLog(realm, { type: "starting-point", text: String(level) });
  });
  if (!kingdom) return;
  const update = {};
  if (data.skills) {
    for (const row of skillPlan(level, kingdom)) if (row.changed) update[`build.skills.${row.skill}.rank`] = row.planned;
  }
  if (data.boosts) {
    for (const row of boostPlan(level, kingdom)) update[`build.boosts.${row.level}`] = row.boosts;
  }
  if (Object.keys(update).length) await kingdom.update(update);
}
