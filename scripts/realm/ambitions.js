import { MODULE_ID, SEATS } from "../constants.js";
import { getAmbition } from "../content/data.js";
import { isKingmakerActive, summarizeRealm } from "../integrations/kingmaker.js";
import { getFame, getKingdom } from "../integrations/party.js";
import { applyEffects, commitKingdomChanges, describeEffect, EffectContext } from "./effects.js";
import { weeklyIncome } from "./rules.js";
import { convertWasted } from "./bonuses.js";
import { addLog, getRealm, updateRealm } from "./state.js";
import { isLeader } from "./leader.js";

/** Where a seat stands against one goal: { value, target }. */
function measure(goal, seat, realm) {
  switch (goal.type) {
    case "successes":
      return { value: realm.seatRecord?.[seat] ?? 0, target: goal.n };
    case "rank":
      return { value: realm.stats[goal.stat]?.rank ?? 0, target: goal.n };
    case "structures":
      return { value: (realm.structures ?? []).length, target: goal.n };
    case "trade":
      return { value: realm.tradeAgreements.length, target: goal.n };
    case "projects":
      return { value: (goal.types ?? []).reduce((sum, t) => sum + (realm.projectRecord?.[t] ?? 0), 0), target: goal.n };
    case "hexes":
      return { value: isKingmakerActive() ? summarizeRealm().size : getKingdom()?.size ?? 0, target: goal.n };
    case "income": {
      const income = weeklyIncome(realm);
      return { value: Math.round((income.total / Math.max(income.base, 1)) * 10) / 10, target: goal.n };
    }
    case "fame":
      return { value: getFame().value ?? 0, target: goal.n };
    default:
      return { value: 0, target: goal.n ?? 1 };
  }
}

export function goalText(goal) {
  const data = { n: goal.n, stat: goal.stat ? game.i18n.localize(`UKM.Stat.${goal.stat}`) : "" };
  return game.i18n.format(`UKM.Ambition.Goal.${goal.type}`, data);
}

/** Every seat's ambition, its current tier and progress, for display. */
export function ambitionsView(realm = getRealm()) {
  return SEATS.map((seat) => {
    const ambition = getAmbition(seat);
    if (!ambition) return null;
    const reached = realm.ambitions?.[seat] ?? 0;
    const tier = ambition.tiers[reached] ?? null;
    const progress = tier ? measure(tier.goal, seat, realm) : null;
    return {
      seat,
      seatLabel: game.i18n.localize(`UKM.Seat.${seat}`),
      title: ambition.title,
      reached,
      total: ambition.tiers.length,
      complete: !tier,
      goal: tier ? goalText(tier.goal) : null,
      value: progress?.value ?? 0,
      target: progress?.target ?? 0,
      percent: progress ? Math.min(100, Math.round((progress.value / Math.max(progress.target, 1)) * 100)) : 100,
      reward: tier ? convertWasted(tier.reward, realm).effects.map(describeEffect).join(", ") : null
    };
  }).filter(Boolean);
}

/** Award any ambition tiers that have been met. Runs on the GM's clock. */
export async function checkAmbitions() {
  if (!isLeader()) return;
  const realm = getRealm();
  const due = [];
  for (const seat of SEATS) {
    const ambition = getAmbition(seat);
    const reached = realm.ambitions?.[seat] ?? 0;
    const tier = ambition?.tiers?.[reached];
    if (!tier) continue;
    const { value, target } = measure(tier.goal, seat, realm);
    if (value >= target) due.push({ seat, tierIndex: reached, tier, ambition });
  }
  for (const item of due) {
    let ctx = null;
    await updateRealm(async (r) => {
      r.ambitions ??= {};
      if ((r.ambitions[item.seat] ?? 0) !== item.tierIndex) return;
      r.ambitions[item.seat] = item.tierIndex + 1;
      ctx = new EffectContext({ realm: r, card: null, event: null });
      const reward = convertWasted(item.tier.reward, r);
      await applyEffects(ctx, reward.effects);
      if (reward.converted) ctx.note(game.i18n.localize("UKM.Bonus.Converted"));
      addLog(r, { type: "ambition", seat: item.seat, text: `${item.ambition.title} ${item.tierIndex + 1}` });
    });
    if (!ctx) continue;
    await commitKingdomChanges(ctx);
    const holderUuid = getKingdom()?.leadership?.[item.seat]?.uuid;
    const holder = holderUuid ? fromUuidSync(holderUuid)?.name : null;
    await ChatMessage.create({
      speaker: { alias: getKingdom()?.name || game.i18n.localize("UKM.Manager.Unnamed") },
      content: `<div class="ukm-chat"><h3>${game.i18n.format("UKM.Ambition.Reached", { title: item.ambition.title, tier: item.tierIndex + 1, total: item.ambition.tiers.length })}</h3><p>${game.i18n.format(
        "UKM.Ambition.ReachedBy",
        { seat: game.i18n.localize(`UKM.Seat.${item.seat}`), holder: holder ?? "", goal: goalText(item.tier.goal) }
      )}</p><ul>${ctx.lines.map((l) => `<li>${l}</li>`).join("")}</ul></div>`
    });
    Hooks.callAll(`${MODULE_ID}.ambition`, { seat: item.seat, tier: item.tierIndex + 1 });
  }
}
