import { POINTS_PER_RANK, REALM_STATS } from "../constants.js";
import { getKingdom } from "../integrations/party.js";
import { rankCap, seatFilled, weeklyIncome } from "./rules.js";
import { addLog, getRealm, updateRealm } from "./state.js";

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
 * Put the realm where it would be had the module been running from the start.
 * data: { ranks: { stat: rank }, treasury }
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
}
