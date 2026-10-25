import { MISSED_PROBLEM_POINTS, MODULE_ID, SKILL_TO_STAT } from "../constants.js";
import { getEvent } from "../content/data.js";
import { getKingdom, isKingdomActive } from "../integrations/party.js";
import { getSetting, setSetting, SETTINGS } from "../settings.js";
import { drawMonthlyEvents } from "./deck.js";
import { weeklyFoodShortfall, weeklyIncome } from "./rules.js";
import { addLog, getRealm, updateRealm } from "./state.js";
import { monthKey, weekNumber } from "./time.js";
import { syncPins } from "./pins.js";

const MAX_CATCH_UP_WEEKS = 26;

let running = false;

export function registerClock() {
  Hooks.on("updateWorldTime", () => tick());
}

/** Bring the realm up to the current world time. Safe to call at any moment. */
export async function tick() {
  if (running || !game.user.isActiveGM || !isKingdomActive()) return;
  running = true;
  try {
    const clock = getSetting(SETTINGS.clock) ?? {};
    const week = weekNumber();
    const month = monthKey();

    if (clock.week === undefined || clock.month === undefined) {
      await setSetting(SETTINGS.clock, { week, month });
      return;
    }

    const weeks = Math.min(Math.max(0, week - clock.week), MAX_CATCH_UP_WEEKS);
    const newMonth = month !== clock.month;
    if (!weeks && !newMonth) {
      if (hasExpiring(getRealm())) {
        await updateRealm((realm) => expireCards(realm));
        await syncPins();
      }
      return;
    }

    let drawn = [];
    let unrest = 0;
    await updateRealm((realm) => {
      for (let i = 0; i < weeks; i++) unrest += runWeek(realm);
      expireCards(realm);
      if (newMonth) drawn = drawMonthlyEvents(realm);
    });
    await setSetting(SETTINGS.clock, { week, month });
    if (unrest) await addUnrest(unrest);
    await syncPins();

    if (newMonth) Hooks.callAll(`${MODULE_ID}.newMonth`, { month, drawn });
  } finally {
    running = false;
  }
}

async function addUnrest(amount) {
  const kingdom = getKingdom();
  if (!kingdom) return;
  await kingdom.update({ "unrest.value": Math.max(0, (kingdom.unrest?.value ?? 0) + amount) });
}

/** One week of upkeep. Returns Unrest gained from food the treasury couldn't cover. */
function runWeek(realm) {
  let unrest = 0;
  const income = weeklyIncome(realm);
  const foodCost = Math.round(weeklyFoodShortfall(realm) * 0.5);
  realm.treasury += income.total;
  addLog(realm, { type: "income", amount: income.total });

  if (foodCost > 0) {
    if (realm.treasury >= foodCost) {
      realm.treasury -= foodCost;
      addLog(realm, { type: "food", amount: -foodCost });
    } else {
      realm.treasury = 0;
      unrest += 1;
      addLog(realm, { type: "food-shortfall" });
    }
  }

  realm.incomeAdjustments = realm.incomeAdjustments
    .map((a) => ({ ...a, weeks: a.weeks - 1 }))
    .filter((a) => a.weeks > 0);
  realm.consumptionAdjustments = realm.consumptionAdjustments
    .map((c) => ({ ...c, weeks: c.weeks - 1 }))
    .filter((c) => c.weeks > 0);
  return unrest;
}

function isExpiring(card, now) {
  if (!["open", "assigned"].includes(card.status) || card.deadline > now) return false;
  return !(card.status === "assigned" && card.workUntil && card.workUntil <= card.deadline);
}

function hasExpiring(realm) {
  const now = game.time.worldTime;
  return realm.cards.some((card) => isExpiring(card, now));
}

function expireCards(realm) {
  const now = game.time.worldTime;
  for (const card of realm.cards) {
    if (!isExpiring(card, now)) continue;

    const event = getEvent(card.eventId);
    card.status = "expired";
    card.resolvedAt = now;
    if (card.kind === "problem") {
      card.outcome = "failure";
      card.pendingEffects = true;
      const stat = SKILL_TO_STAT[(event?.skill ?? [])[0]];
      if (stat) realm.stats[stat].points = Math.max(0, realm.stats[stat].points + MISSED_PROBLEM_POINTS);
    }
    addLog(realm, { type: "card-expired", card: card.id, seat: card.seat, text: card.name, kind: card.kind });
  }
}
