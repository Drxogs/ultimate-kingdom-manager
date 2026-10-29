import { env } from "./setup.mjs";
const R = "/home/claude/ukm-repo/scripts";
const { preloadData } = await import(`${R}/content/data.js`);
await preloadData();
env.settings.set("seatAssignments", {});
const ok = (c, m) => console.log(c ? "ok  " : "FAIL", m);
const { getRealm, updateRealm } = await import(`${R}/realm/state.js`);
const { getKingdom } = await import(`${R}/integrations/party.js`);
const RY = await import(`${R}/realm/royal.js`);
const RS = await import(`${R}/realm/resolve.js`);
const C = await import(`${R}/constants.js`);
const { EffectContext, applyEffects } = await import(`${R}/realm/effects.js`);

ok(C.SEATS.length === 6 && !C.SEATS.includes("ruler") && !C.SEATS.includes("warden"), "six seats, no Ruler or Warden seat");
ok(C.REALM_STATS.relations.skills.join() === "politics,intrigue,statecraft" && C.REALM_STATS.arcane.skills.includes("engineering"), "stats carry the new skills");
ok(C.selectorReaches(["loyalty"], "statecraft") && C.selectorReaches(["stability"], "wilderness") && !C.selectorReaches(["loyalty"], "warfare"), "old stat names in bonuses reach the new stat's skills");

// No ruler: no powers.
let r = await RY.royalCourt({ userId: "gm" });
ok(!r.ok && r.reason === "NoRuler", "no ruler, no court");

await getKingdom().update({ ruler: "Actor.wes" });
ok(RY.rulerName() === "Wes" && RY.canUseRoyal(game.users.get("gm")), "ruler set in kingdom data");

// Royal Court: −1 Unrest, once a month.
const before = getRealm().kingdom.unrest.value;
r = await RY.royalCourt({ userId: "gm" });
ok(r.ok && getRealm().kingdom.unrest.value === before - 1, `court lowers Unrest (${before} -> ${getRealm().kingdom.unrest.value})`);
r = await RY.royalCourt({ userId: "gm" });
ok(!r.ok && r.reason === "NoRoyalUse", "court only once a month");
env.advance(31);
ok(RY.usesLeft("court") === 1, "new month, court ready again");

// Royal Charge: a working project finishes a week sooner.
const now = game.time.worldTime;
await updateRealm((realm) => {
  realm.cards.push({ id: "proj1", kind: "project", eventId: "project:claim-hex", name: "Claim a hex", seat: "viceroy", status: "assigned", workUntil: now + 10 * 86400, deadline: now + 999 * 86400, assignee: { type: "advisor", skill: "exploration", name: "x" }, project: { type: "claim-hex" }, target: {} });
});
r = await RY.royalCharge({ cardId: "proj1", userId: "gm" });
const left = (getRealm().cards.find((c) => c.id === "proj1").workUntil - now) / 86400;
ok(r.ok && left === 3, `charge takes a week off (${left} days left)`);

// Royal Decree: reroll a waiting result and keep the better.
await updateRealm((realm) => {
  realm.cards.push({ id: "c1", kind: "problem", eventId: "boomtown", name: "Test card", seat: "treasurer", status: "rolled", deadline: now + 9e6, assignee: { type: "advisor", skill: "trade", name: "x" }, target: {}, pendingRoll: { degree: 1, skill: "trade", stat: "economy", personal: false, total: 10, dc: 15, rolledAt: now } });
});
globalThis.__ukmTestDegree = 3;
r = await RS.useRoyalDecree({ cardId: "c1", userId: "gm" });
const pr = getRealm().cards.find((c) => c.id === "c1").pendingRoll;
ok(r.ok && pr.degree === 3 && pr.decreeUsed, "decree: better result kept");
await updateRealm((realm) => { realm.royal.used = {}; const c = realm.cards.find((x) => x.id === "c1"); c.pendingRoll.decreeUsed = false; c.pendingRoll.degree = 2; });
globalThis.__ukmTestDegree = 0;
await RS.useRoyalDecree({ cardId: "c1", userId: "gm" });
ok(getRealm().cards.find((c) => c.id === "c1").pendingRoll.degree === 2, "decree: worse reroll is ignored");
globalThis.__ukmTestDegree = 2;

// Favours: a card grants one, the ruler spends it.
await updateRealm(async (realm) => {
  const ctx = new EffectContext({ realm, card: { name: "The Guild's Thanks" }, event: null });
  await applyEffects(ctx, [{ favour: { name: "Favour of the Guilds", text: "The guilds owe the crown.", effects: [{ bp: 5 }] } }]);
});
const fav = RY.favours()[0];
ok(fav?.name === "Favour of the Guilds" && fav.from === "The Guild's Thanks", "a card's favour goes to the ruler");
const bp = getRealm().treasury;
r = await RY.useFavour({ favourId: fav.id, userId: "gm" });
ok(r.ok && getRealm().treasury === bp + 5 && RY.favours().length === 0, "using it applies its effects and spends it");

// A player who doesn't own the ruler can't use the powers.
const stranger = { id: "p2", isGM: false };
game.users.push(stranger);
const actor = fromUuidSync("Actor.wes");
const keep = actor.testUserPermission;
actor.testUserPermission = (u) => u.isGM;
r = await RY.royalCourt({ userId: "p2" });
ok(!r.ok && r.reason === "NotRuler", "only the ruler's player");
actor.testUserPermission = keep;
