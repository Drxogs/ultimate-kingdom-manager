import { env } from "./setup.mjs";
const R = "/home/claude/ukm-repo/scripts";
const ok = (c, m) => console.log(c ? "ok  " : "FAIL", m);
const { preloadData, getEvent } = await import(`${R}/content/data.js`);
await preloadData();
const { getRealm, updateRealm } = await import(`${R}/realm/state.js`);
const S = await import(`${R}/realm/settlements.js`);
const RS = await import(`${R}/realm/resolve.js`);
const P = await import(`${R}/realm/projects.js`);
const { applyEffects, EffectContext } = await import(`${R}/realm/effects.js`);
const town = (tracks) => updateRealm((r) => { r.treasury = 500; r.cards = []; r.settlements = [{ id: "cap", name: "Capital", capital: true, type: "town", tracks: { homes: 1, food: 1, faith: 0, ...tracks }, pinnacles: [] }]; });
const card = (eventId, extra = {}) => ({ id: eventId, eventId, name: getEvent(eventId).name, kind: "problem", seat: "emissary", status: "open", stage: 0, target: { settlement: "Capital", settlementId: "cap" }, ...extra });
const mods = (c) => S.structureModifiers(getRealm(), c, "defense").filter((m) => m.slug.startsWith("ukm-special") || m.slug.startsWith("ukm-while"));

await town({});
ok(mods(card("plague")).some((m) => m.modifier === -2), "plague without Paved Streets: −2");
await town({ publicworks: 3 });
ok(mods(card("plague")).some((m) => m.modifier === 2) && !mods(card("plague")).some((m) => m.modifier < 0), "plague with Sewers and Lamps: +2, no penalty");
await town({ publicworks: 1 });
ok(mods(card("plague")).length === 0, "plague with Paved Streets: neither");

await town({});
ok(S.eventSpecials(getRealm(), card("boomtown")).degree === -1, "boomtown without Paved Streets: a step worse");
await town({ publicworks: 1 });
ok(S.eventSpecials(getRealm(), card("boomtown")).degree === 0, "boomtown with Paved Streets: normal");

await updateRealm((r) => { r.settlements = [1, 2, 3].map((i) => ({ id: `s${i}`, name: `S${i}`, type: "town", tracks: { homes: 1, faith: 2 }, pinnacles: [] })); });
ok(S.eventSpecials(getRealm(), card("undead-uprising", { target: {} })).dc === 2, "undead uprising: +1 DC per temple, at most +2");

await town({ faith: 2 });
ok(S.eventSpecials(getRealm(), card("local-disaster")).halveBpLoss, "local disaster with a temple halves BP losses");

// Plague while active: building in that settlement takes −2 unless it has sewers.
await town({});
await updateRealm((r) => { r.cards.push(card("plague")); });
const build = { id: "b", eventId: "project:develop-settlement", seat: "viceroy", stage: 0, target: { settlementId: "cap", settlement: "Capital" }, project: { track: { id: "food" } } };
ok(S.structureModifiers(getRealm(), build, "agriculture").some((m) => m.slug === "ukm-while-plague" && m.modifier === -2), "building during a plague: −2");

// Squatters stop new Homes there.
await town({ homes: 0 });
ok(!P.developmentQuote("cap", "homes").blocked, "Homes can be raised normally");
await updateRealm((r) => { r.cards = [card("squatters")]; });
const q = P.developmentQuote("cap", "homes");
ok(q.blocked === "Event" && q.event === getEvent("squatters").name, `squatters block Homes (${q.blocked})`);
ok(P.developmentQuote("cap", "faith").blocked !== "Event", "but not other tracks");

