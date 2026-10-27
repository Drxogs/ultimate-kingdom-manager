import { ATTITUDES, DIE_AVERAGE, HIRED_ADVISOR, POINTS_PER_RANK, REALM_STATS, ROUTINE_ADVISOR_BONUS, ROUTINE_POINTS } from "../constants.js";
import { getCompanion, getCompanions } from "../content/data.js";
import { getSetting, SETTINGS } from "../settings.js";
import { getKingdom, getResourceDie } from "../integrations/party.js";
import { summarizeRealm, isKingmakerActive } from "../integrations/kingmaker.js";

export function rankCap(kingdomLevel) {
  return Math.ceil(Math.clamp(kingdomLevel, 1, 20) / 2);
}

export function rankBonus(rank) {
  if (rank >= 6) return 3;
  if (rank >= 3) return 2;
  if (rank >= 1) return 1;
  return 0;
}

/** Whether a stat has banked enough points for its next rank, and the cap allows it. */
export function canRankUp(stat, kingdomLevel) {
  const nextRank = stat.rank + 1;
  return nextRank <= rankCap(kingdomLevel) && stat.points >= nextRank * POINTS_PER_RANK;
}

export function statProgress(stat) {
  const floor = stat.rank * POINTS_PER_RANK;
  const ceiling = (stat.rank + 1) * POINTS_PER_RANK;
  const value = Math.floor(Math.clamp(stat.points, floor, ceiling) - floor);
  return { value, max: POINTS_PER_RANK, percent: Math.round((value / POINTS_PER_RANK) * 100) };
}

export function dieAverage(faces = getResourceDie()) {
  return DIE_AVERAGE[faces] ?? 2.5;
}

/** One resource die in BP at the kingdom's current size. */
export function resourceDieValue() {
  return dieAverage(getResourceDie());
}

/**
 * Weekly treasury income. The base is the PF2e monthly resource roll at its
 * average, paid out over four weeks.
 */
export function weeklyIncome(realm) {
  const kingdom = getKingdom();
  const level = kingdom?.level ?? 1;
  const faces = getResourceDie();
  const base = ((level + 4) * dieAverage(faces)) / 4;

  let worksites = 0;
  if (isKingmakerActive()) {
    const summary = summarizeRealm();
    for (const site of Object.values(summary.workSites)) {
      worksites += (site.total - site.onResource) * 0.5 + site.onResource * 1;
    }
  }

  const economyRank = realm.stats.economy?.rank ?? 0;
  const ranks = Object.keys(REALM_STATS).reduce(
    (sum, key) => sum + Math.min(realm.stats[key]?.rank ?? 0, economyRank),
    0
  );

  const trade = realm.tradeAgreements.reduce((sum, t) => sum + (t.weekly ?? 0), 0);
  const adjustments = realm.incomeAdjustments.reduce((sum, a) => sum + a.perWeek, 0);
  const debtFactor = realm.debt.amount > 0 ? 0.75 : 1;

  const gross = (base + worksites + ranks + trade) * debtFactor;
  const total = Math.max(0, Math.round(gross + adjustments));
  return { base, worksites, ranks, trade, adjustments, debtFactor, total };
}

/** Food upkeep for one week, in BP owed after farms. */
export function weeklyFoodShortfall(realm) {
  const kingdom = getKingdom();
  const consumption = kingdom?.consumption?.value ?? 0;
  const farms = isKingmakerActive() ? summarizeRealm().farmlands : 0;
  const extra = realm.consumptionAdjustments.reduce((sum, c) => sum + (c.skip ? 0 : c.amount), 0);
  const skip = realm.consumptionAdjustments.some((c) => c.skip);
  if (skip) return 0;
  return Math.max(0, consumption + extra - farms);
}

/** Work time for an event card, in days. */
export function cardWorkDays(levelModifier) {
  return Math.max(3, 5 + 2 * (levelModifier ?? 0));
}

export function companionAttitude(id) {
  return getSetting(SETTINGS.companionAttitudes)?.[id] ?? "friendly";
}

/** At least this attitude? */
export function attitudeAtLeast(id, wanted) {
  return ATTITUDES.indexOf(companionAttitude(id)) >= ATTITUDES.indexOf(wanted);
}

export function isHired(seat) {
  return getSetting(SETTINGS.seatAssignments)?.[seat]?.companion === HIRED_ADVISOR;
}

/** The companion advising a seat, as long as they're still willing to. */
export function seatCompanionId(seat) {
  const id = rawSeatCompanionId(seat);
  if (!id || id === HIRED_ADVISOR) return null;
  return attitudeAtLeast(id, "indifferent") ? id : null;
}

/** Whether a companion can advise a seat: only the seats they're suited to. */
export function suitsSeat(companionId, seat) {
  return !!getCompanion(companionId)?.seats?.includes(seat);
}

/** The companion placed in a seat, whatever their mood. A companion put in a seat they don't suit doesn't count. */
export function rawSeatCompanionId(seat) {
  const chosen = getSetting(SETTINGS.seatAssignments)?.[seat]?.companion;
  if (chosen === HIRED_ADVISOR) return chosen;
  if (chosen) return suitsSeat(chosen, seat) ? chosen : null;
  const uuid = getKingdom()?.leadership?.[seat]?.uuid;
  const name = uuid ? fromUuidSync(uuid)?.name?.toLowerCase() : null;
  if (!name) return null;
  const id =
    getCompanions().find((c) => {
      const n = c.name.toLowerCase();
      return name === n || name.startsWith(`${n} `) || name.startsWith(`${n},`) || name.startsWith(`${n} (`);
    })?.id ?? null;
  return id && suitsSeat(id, seat) ? id : null;
}

/** Whether someone sits in a seat, and whether it's a companion in a role they're suited to. */
export function seatFilled(seat) {
  const leader = getKingdom()?.leadership?.[seat];
  const companionId = seatCompanionId(seat);
  const companion = companionId ? getCompanion(companionId) : null;
  return {
    filled: !!leader?.uuid || !!companion || isHired(seat),
    suited: !!companion?.seats?.includes(seat)
  };
}

/**
 * Weekly progress from everyday life in the realm. A stat two or more ranks
 * behind what the kingdom's level allows grows faster, so a kingdom founded
 * late or a desk left alone for a while can catch up.
 */
export function routinePoints(realm, statKey, kingdomLevel) {
  const def = REALM_STATS[statKey];
  const stat = realm.stats[statKey];
  if (!def || !stat) return 0;
  const seat = seatFilled(def.seat);
  if (!seat.filled) return 0;
  const behind = rankCap(kingdomLevel) - stat.rank;
  const catchUp = 1 + Math.max(0, behind - 1);
  return (ROUTINE_POINTS + (seat.suited ? ROUTINE_ADVISOR_BONUS : 0)) * catchUp;
}

/** A stat can bank a full rank past its cap, ready for when the kingdom's level rises. */
export function pointCeiling(kingdomLevel) {
  return (rankCap(kingdomLevel) + 1) * POINTS_PER_RANK;
}

export function addStatPoints(realm, statKey, amount, kingdomLevel) {
  const stat = realm.stats[statKey];
  if (!stat || !amount) return;
  stat.points = Math.clamp(stat.points + amount, 0, Math.max(stat.points, pointCeiling(kingdomLevel)));
}
