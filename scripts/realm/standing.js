import { RUINS, RUIN_ABILITY } from "../constants.js";
import { getFame, getKingdom, getUnrest } from "../integrations/party.js";
import { addLog, newId, updateRealm } from "./state.js";
import { isLeader } from "./leader.js";

const { DialogV2 } = foundry.applications.api;

export const ANARCHY_AT = 20;
const TROUBLE_AT = 10;

const loc = (key, data) => (data ? game.i18n.format(`UKM.Standing.${key}`, data) : game.i18n.localize(`UKM.Standing.${key}`));

function speaker() {
  return { alias: getKingdom()?.name || game.i18n.localize("UKM.Manager.Unnamed") };
}

export function inAnarchy() {
  return getUnrest() >= ANARCHY_AT;
}

/**
 * The book's last resort: spend every Fame point to stop a Ruin penalty or anarchy.
 * The GM is asked, since the whole party has to agree.
 */
async function offerFame(text) {
  const fame = getFame().value;
  if (fame < 1) return false;
  return DialogV2.confirm({
    window: { title: loc("FameTitle") },
    content: `<p>${text}</p><p>${loc("FameAsk", { fame })}</p>`,
    rejectClose: false
  });
}

/**
 * Look over a kingdom update before it's written: if it would raise a Ruin penalty or tip
 * the realm into anarchy, offer to spend all Fame to stop it. Returns the (possibly changed) update.
 */
export async function guardWithFame(update) {
  const kingdom = getKingdom();
  if (!kingdom || !isLeader()) return update;
  let spent = false;
  for (const ruin of RUINS) {
    const ability = RUIN_ABILITY[ruin];
    const key = `abilities.${ability}.penalty`;
    if (!(key in update) || update[key] >= (kingdom.abilities?.[ability]?.penalty ?? 0)) continue;
    const label = game.i18n.localize(`UKM.Ruin.${ruin}`);
    if (spent || !(await offerFame(loc("FameRuin", { ruin: label })))) continue;
    const max = kingdom.abilities?.[ability]?.ruin?.max ?? 10;
    update[key] = kingdom.abilities?.[ability]?.penalty ?? 0;
    update[`abilities.${ability}.ruin.value`] = max - 1;
    spent = true;
  }
  const unrest = update["unrest.value"];
  if (!spent && unrest >= ANARCHY_AT && getUnrest() < ANARCHY_AT && (await offerFame(loc("FameAnarchy")))) {
    update["unrest.value"] = ANARCHY_AT - 1;
    spent = true;
  }
  if (spent) {
    update["resources.fame.value"] = 0;
    await ChatMessage.create({ speaker: speaker(), content: `<div class="ukm-chat"><h3>${loc("FameSpentTitle")}</h3><p>${loc("FameSpent")}</p></div>` });
  }
  return update;
}

/** Set Unrest, going through the Fame safeguard. */
export async function setUnrest(value) {
  const kingdom = getKingdom();
  if (!kingdom) return;
  const before = getUnrest();
  const update = await guardWithFame({ "unrest.value": Math.max(0, value) });
  await kingdom.update(update);
  await announceAnarchy(before);
}

export async function announceAnarchy(before) {
  const now = getUnrest();
  if (before < ANARCHY_AT && now >= ANARCHY_AT) {
    await ChatMessage.create({ speaker: speaker(), content: `<div class="ukm-chat"><h3>${loc("AnarchyTitle")}</h3><p>${loc("Anarchy")}</p></div>` });
  } else if (before >= ANARCHY_AT && now < ANARCHY_AT) {
    await ChatMessage.create({ speaker: speaker(), content: `<div class="ukm-chat"><h3>${loc("OrderTitle")}</h3><p>${loc("Order")}</p></div>` });
  }
}

/**
 * The start of each month: +1 Fame, and if Unrest is 10 or more the realm suffers:
 * 1d10 Ruin spread over the four Ruins, and a DC 11 flat check or a hex is lost.
 */
export async function monthlyStanding() {
  const kingdom = getKingdom();
  if (!kingdom || !isLeader()) return;
  const fame = getFame();
  if (fame.value < fame.max) {
    await kingdom.update({ "resources.fame.value": fame.value + 1 });
  }

  const unrest = getUnrest();
  if (unrest < TROUBLE_AT) return;
  const roll = await new Roll("1d10").evaluate();
  const flat = await new Roll("1d20").evaluate();
  const spread = Object.fromEntries(RUINS.map((r) => [r, 0]));
  const order = RUINS.slice().sort((a, b) => (kingdom.abilities?.[RUIN_ABILITY[a]]?.ruin?.value ?? 0) - (kingdom.abilities?.[RUIN_ABILITY[b]]?.ruin?.value ?? 0));
  for (let i = 0; i < roll.total; i++) spread[order[i % order.length]] += 1;

  const update = {};
  for (const ruin of RUINS) {
    if (!spread[ruin]) continue;
    const ability = RUIN_ABILITY[ruin];
    const data = kingdom.abilities?.[ability] ?? {};
    const max = data.ruin?.max ?? 10;
    let value = (data.ruin?.value ?? 0) + spread[ruin];
    let penalty = data.penalty ?? 0;
    while (value >= max) {
      value -= max;
      penalty -= 1;
    }
    update[`abilities.${ability}.ruin.value`] = value;
    if (penalty !== (data.penalty ?? 0)) update[`abilities.${ability}.penalty`] = penalty;
  }
  await kingdom.update(await guardWithFame(update));

  const lostHex = flat.total < 11;
  const parts = RUINS.filter((r) => spread[r]).map((r) => `${game.i18n.localize(`UKM.Ruin.${r}`)} +${spread[r]}`).join(", ");
  await updateRealm((realm) => {
    addLog(realm, { type: "unrest-trouble", text: parts });
    if (lostHex) {
      realm.gmTasks.push({ id: newId(), text: loc("LoseHexTask"), card: null, hexKey: null, created: game.time.worldTime, done: false });
    }
  });
  await ChatMessage.create({
    speaker: speaker(),
    content: `<div class="ukm-chat"><h3>${loc("TroubleTitle", { unrest })}</h3><p>${loc("Trouble", { ruin: parts })}</p><p>${lostHex ? loc("HexLost", { roll: flat.total }) : loc("HexHeld", { roll: flat.total })}</p></div>`
  });
}
