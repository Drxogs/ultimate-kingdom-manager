import { env } from "./setup.mjs";
const R = "/home/claude/ukm-repo/scripts";
const { preloadData } = await import(`${R}/content/data.js`);
await preloadData();
const ok = (c, m) => console.log(c ? "ok  " : "FAIL", m);
const { getKingdom, getControlDC, getRuin } = await import(`${R}/integrations/party.js`);
const { getRealm, updateRealm } = await import(`${R}/realm/state.js`);
const K = await import(`${R}/realm/kingdom.js`);

// The kingdom comes from our realm data, not the PF2e sheet.
const k = getKingdom();
ok(k.active && k.level === 3 && k.name === "Testland", "kingdom read from realm data");
ok(k.size === 3 && k.nationType === "territory", `size from claimed hexes (${k.size})`);
ok(getControlDC() === 18, `Control DC level 3 territory = 18 (${getControlDC()})`);

// Rank bonus table (Rules v1).
ok([0, 1, 2, 3, 4, 7, 8, 10].map((r) => K.rankCheckBonus(r, 1)).join() === "5,5,7,7,9,9,11,11", "advisor bonus by rank at level 1");
ok([1, 5, 10, 17].map((l) => K.rankCheckBonus(0, l)).join() === "5,6,7,8", "advisor attribute grows with level");
await updateRealm((r) => { r.stats.relations.rank = 3; });
const pol = getKingdom().skills.politics;
ok(pol.mod === 3 + 7 - 1, `politics = level 3 + expert 4 + attribute 3 + unrest -1 (${pol.mod})`);

// Unrest penalty steps.
ok([0, 1, 4, 5, 9, 10, 14, 15, 30].map(K.unrestPenalty).join() === "0,-1,-1,-2,-2,-3,-3,-4,-4", "unrest penalty steps");

// Ruin: penalty lands on the right skills, and the threshold rises by 2.
await getKingdom().update({ "abilities.economy.ruin.value": 0, "abilities.economy.penalty": -1 });
const after = getRealm().kingdom.abilities.economy;
ok(after.penalty === -1 && after.ruin.max === 12, `crime penalty -1, threshold 10 -> 12 (${after.ruin.max})`);
ok(getKingdom().skills.trade.mod === getKingdom().skills.politics.mod - 2 - 1, "crime hurts Trade, not Politics");
ok(getRuin().crime.penalty === -1, "getRuin reads it back");

// Effects path: +15 Crime rolls over at the new threshold.
const { EffectContext, commitKingdomChanges } = await import(`${R}/realm/effects.js`);
const ctx = new EffectContext({ realm: getRealm(), card: null, event: null });
ctx.ruin.crime = 13;
ctx.unrest = 3;
await commitKingdomChanges(ctx);
const crime = getRealm().kingdom.abilities.economy;
ok(crime.penalty === -2 && crime.ruin.value === 1 && crime.ruin.max === 14, `13 crime past a 12 threshold: penalty -2, value 1, threshold 14 (${JSON.stringify(crime)})`);
ok(getRealm().kingdom.unrest.value === 5, `unrest +3 (${getRealm().kingdom.unrest.value})`);

// Updates made while the realm is being changed land in that change.
await updateRealm(async (r) => {
  await getKingdom().update({ "resources.fame.value": 2 });
  r.treasury = 77;
});
ok(getRealm().kingdom.resources.fame.value === 2 && getRealm().treasury === 77, "kingdom update inside a realm change isn't lost");

// Food: adds up the Settlements tab.
await updateRealm((r) => {
  r.settlements = [
    { id: "a", name: "Monkeyton", type: "town", capital: true, buildings: [] },
    { id: "b", name: "Tatzlford", type: "village", buildings: [{ slug: "founders-hall", name: "Founders' Hall", lots: 1 }] }
  ];
});
ok(getKingdom().consumption.value === 2 + 0, `food need town 2 + village 1 - hall 1 (${getKingdom().consumption.value})`);

// A roll posts our own chat card and returns a degree.
globalThis.__ukmTestDegree = undefined;
const res = await getKingdom().skills.politics.roll({ dc: { value: 15 }, modifiers: [{ label: "Advisor", modifier: 1, type: "status" }], label: "Test check" });
const card = env.messages.at(-1).content;
ok(/Test check/.test(card) && /Advisor \+1/.test(card) && /DC 15/.test(card), "chat card shows label, modifiers and DC");
ok(Number.isInteger(res.degreeOfSuccess), `degree ${res.degreeOfSuccess} (total ${res.total})`);
ok(K.degreeOf(25, 15, 5) === 3 && K.degreeOf(14, 15, 20) === 2 && K.degreeOf(16, 15, 1) === 1 && K.degreeOf(4, 15, 3) === 0, "degrees with natural 20 and 1");

// Setup founds the kingdom: a fresh realm isn't active until then.
await updateRealm((r) => { r.kingdom.active = false; r.kingdom.name = ""; });
ok(!getKingdom().active, "inactive before Setup");
await getKingdom().update({ name: "Monkeyland", active: true, "leadership.ruler.uuid": "Actor.wes" });
ok(getKingdom().active && getKingdom().name === "Monkeyland" && getKingdom().leadership.ruler.uuid === "Actor.wes", "Setup's save activates and names it");
