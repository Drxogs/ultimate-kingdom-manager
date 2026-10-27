import { DEGREES, MODULE_ID } from "../constants.js";
import { getEvent } from "../content/data.js";
import { getControlDC, getKingdom } from "../integrations/party.js";
import { getSetting, SETTINGS } from "../settings.js";
import { createCard } from "./deck.js";
import { commitKingdomChanges, EffectContext, rollAmount } from "./effects.js";
import { canActForSeat } from "./resolve.js";
import { weeklyIncome } from "./rules.js";
import { addLog, getRealm, updateRealm } from "./state.js";
import { UkmDialog } from "../apps/dialog.js";


/** Core Rulebook, Party Treasure by Level: currency per additional PC. */
const TAP_LIMIT = [0, 10, 18, 30, 50, 80, 125, 180, 250, 350, 500, 700, 1000, 1500, 2250, 3250, 5000, 7500, 12000, 20000, 35000];

const SCANDAL_CHANCE = 0.25;

export function tapLimit() {
  const level = Math.clamp(getKingdom()?.level ?? 1, 1, 20);
  return TAP_LIMIT[level];
}

/** Drawing the full limit costs a month of the kingdom's base income. */
export function tapCostBP(gold) {
  const monthly = weeklyIncome(getRealm()).base * 4;
  return Math.max(1, Math.round((gold / tapLimit()) * monthly));
}

export function tapMode() {
  return getSetting(SETTINGS.tapTreasury);
}

function speaker() {
  return { alias: getKingdom()?.name || game.i18n.localize("UKM.Manager.Unnamed") };
}

async function giveGold(actor, gp) {
  if (!gp) return true;
  if (typeof actor?.inventory?.addCoins === "function") {
    await actor.inventory.addCoins({ gp });
    return true;
  }
  return false;
}

async function takeGold(actor, gp) {
  if (typeof actor?.inventory?.removeCoins === "function") return actor.inventory.removeCoins({ gp });
  return false;
}

/**
 * Pull gold out of the kingdom for a PC. The only way BP ever becomes gold,
 * and it leaves a debt, Corruption, Unrest and a public record.
 */
export async function tapTreasury({ actorUuid, userId }) {
  const mode = tapMode();
  if (mode === "disabled") return { ok: false, reason: "TapDisabled" };
  const user = game.users.get(userId) ?? game.user;
  if (!canActForSeat(user, "treasurer")) return { ok: false, reason: "NotYourSeat" };
  const actor = fromUuidSync(actorUuid);
  if (!actor || (!user.isGM && !actor.testUserPermission(user, "OWNER"))) return { ok: false, reason: "NotYourCharacter" };

  const limit = tapLimit();
  const cost = tapCostBP(limit);
  const realm = getRealm();
  if (realm.treasury < cost) return { ok: false, reason: "TooPoor", data: { cost } };

  if (mode === "approval" && !user.isGM) {
    const approved = await UkmDialog.confirm({
      window: { title: game.i18n.localize("UKM.Tap.Title") },
      content: `<p>${game.i18n.format("UKM.Tap.ApprovalAsk", { user: user.name, actor: actor.name, gold: limit, cost })}</p>`,
      rejectClose: false
    });
    if (!approved) return { ok: false, reason: "TapDenied" };
  }

  const kingdom = getKingdom();
  const statistic = kingdom?.skills?.trade;
  if (!statistic) return { ok: false, reason: "Error" };
  const inDebt = realm.debt.amount > 0;
  const roll = await statistic.roll({
    dc: { value: getControlDC() },
    skipDialog: true,
    label: game.i18n.format("UKM.Tap.RollLabel", { actor: actor.name }),
    extraRollOptions: ["ukm:tap-treasury"]
  });
  if (!roll) return { ok: false, reason: "Error" };
  const degree = Math.max(0, roll.degreeOfSuccess - (inDebt ? 2 : 0));
  const degreeName = DEGREES[degree];
  const gold = degree >= 2 ? limit : degree === 1 ? Math.floor(limit / 2) : 0;

  const ctx = new EffectContext({ realm: null, card: null, event: null });
  let scandal = false;
  await updateRealm(async (r) => {
    ctx.realm = r;
    if (gold > 0) {
      r.treasury -= tapCostBP(gold);
      r.debt.amount += gold;
      r.debt.draws += 1;
      r.debt.history ??= [];
      r.debt.history.push({ actor: actor.name, gold, time: game.time.worldTime });
      ctx.unrest += 1;
      ctx.ruin.corruption += 1;
      if (inDebt && Math.random() < SCANDAL_CHANCE && getEvent("public-scandal")) {
        const card = createCard(getEvent("public-scandal"));
        card.name = `${card.name} (${actor.name})`;
        r.cards.push(card);
        scandal = true;
      }
    } else if (degree === 0) {
      ctx.unrest += await rollAmount("1d4");
    }
    addLog(r, { type: "tap", text: actor.name, amount: gold });
  });
  await commitKingdomChanges(ctx);
  const delivered = await giveGold(actor, gold);

  const lines = [
    game.i18n.format("UKM.Tap.Result", { actor: actor.name, gold, degree: game.i18n.localize(`UKM.Degree.${degreeName}`) }),
    gold ? game.i18n.format("UKM.Tap.Consequences", { cost: tapCostBP(gold) }) : "",
    inDebt ? game.i18n.localize("UKM.Tap.WorseInDebt") : "",
    scandal ? game.i18n.localize("UKM.Tap.Scandal") : "",
    gold && !delivered ? game.i18n.localize("UKM.Tap.GiveByHand") : ""
  ].filter(Boolean);
  await ChatMessage.create({
    speaker: speaker(),
    content: `<div class="ukm-chat"><h3>${game.i18n.localize("UKM.Tap.Title")}</h3>${lines.map((l) => `<p>${l}</p>`).join("")}</div>`
  });
  Hooks.callAll(`${MODULE_ID}.tapTreasury`, { actor, gold });
  return { ok: true, gold };
}

/** Pay gold back into the treasury. Clearing the debt lifts its penalties. */
export async function repayDebt({ actorUuid, amount, userId }) {
  const user = game.users.get(userId) ?? game.user;
  const actor = fromUuidSync(actorUuid);
  if (!actor || (!user.isGM && !actor.testUserPermission(user, "OWNER"))) return { ok: false, reason: "NotYourCharacter" };
  const owed = getRealm().debt.amount;
  const gp = Math.min(Math.max(0, Math.floor(Number(amount) || 0)), owed);
  if (!gp) return { ok: false, reason: "NothingOwed" };
  const paid = await takeGold(actor, gp);
  if (!paid) return { ok: false, reason: "NotEnoughGold" };
  let cleared = false;
  await updateRealm((r) => {
    r.debt.amount = Math.max(0, r.debt.amount - gp);
    cleared = r.debt.amount === 0;
    if (cleared) r.debt.draws = 0;
    addLog(r, { type: "repay", text: actor.name, amount: gp });
  });
  await ChatMessage.create({
    speaker: speaker(),
    content: `<div class="ukm-chat"><p>${game.i18n.format(cleared ? "UKM.Tap.Cleared" : "UKM.Tap.Repaid", { actor: actor.name, gold: gp, left: getRealm().debt.amount })}</p></div>`
  });
  return { ok: true, gold: gp };
}
