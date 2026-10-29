import { env } from "./setup.mjs";
const R = "/home/claude/ukm-repo/scripts";
const { preloadData, getEvents } = await import(`${R}/content/data.js`);
await preloadData();
env.settings.set("seatAssignments", {});
const ok = (c, m) => console.log(c ? "ok  " : "FAIL", m);
const RY = await import(`${R}/realm/royal.js`);
const deck = await import(`${R}/realm/deck.js`);
const { getRealm, updateRealm } = await import(`${R}/realm/state.js`);
const { getKingdom, getPlayerCharacters } = await import(`${R}/integrations/party.js`);
const { applyEffects, EffectContext } = await import(`${R}/realm/effects.js`);

const kyra = { uuid: "Actor.kyra", name: "Kyra", type: "character", isOwner: true, testUserPermission: () => true, skills: {} };
env.party.members.push(kyra);
const oldFrom = globalThis.fromUuidSync;
globalThis.fromUuidSync = (u) => (u === kyra.uuid ? kyra : oldFrom(u));
const pcs = getPlayerCharacters();
ok(pcs.length >= 2, `party has ${pcs.length} characters`);
await getKingdom().update({ ruler: pcs[0].uuid });
ok(RY.rulerUuid() === pcs[0].uuid, "ruler set");

// Royal Court: -1 normally, -2 in anarchy.
await getKingdom().update({ "unrest.value": 5 });
ok(RY.courtCalm() === 1, "court calms by 1 out of anarchy");
await getKingdom().update({ "unrest.value": 25 });
ok(RY.courtCalm() === 2, "court calms by 2 in anarchy");

// Quell Unrest's dice double in anarchy.
const ctx = new EffectContext({ realm: getRealm(), card: null, event: null });
await applyEffects(ctx, [{ unrest: -3, anarchyTimes: 2 }]);
ok(ctx.unrest === -6, `calming effect doubled in anarchy (${ctx.unrest})`);

// Abdication.
ok(RY.canAbdicate(), "can step down in anarchy");
await updateRealm((r) => RY.grantFavour(r, { name: "Test favour", effects: [] }));
await getKingdom().update({ "resources.fame.value": 2 });
const heir = RY.heirs()[0];
let res = await RY.abdicate({ heirUuid: pcs[0].uuid, userId: "gm" });
ok(!res.ok && res.reason === "NoHeir", "the ruler can't crown themself");
res = await RY.abdicate({ heirUuid: heir.uuid, userId: "gm" });
ok(res.ok, `abdicate (${JSON.stringify(res)})`);
const k = getKingdom();
ok(k.unrest.value === 0, `Unrest to 0 (${k.unrest.value})`);
ok(RY.rulerUuid() === heir.uuid, "heir is ruler");
ok((k.resources?.fame?.value ?? 0) === 0, "Fame gone");
ok(RY.favours().length === 0 && RY.usesLeft("court") === 0, "favours and royal powers gone");
ok(!RY.heirs().some((a) => a.uuid === pcs[0].uuid), "the old ruler can't be crowned again");
ok(!RY.canAbdicate(), "no stepping down out of anarchy");
ok(env.messages.at(-1)?.content.includes("steps down"), "chat announces it");

// Pile-ups: at most 2 ongoing problems.
const ongoing = getEvents().filter((e) => e.kind === "problem" && e.continuous && e.placement?.type !== "settlement" && e.placement?.type !== "hex");
await updateRealm((r) => { for (const e of ongoing.slice(0, 2)) r.cards.push(deck.createCard(e)); });
ok(deck.ongoingProblems(getRealm()) === 2, "two ongoing problems open");
let extra = 0;
for (let i = 0; i < 30; i++) {
  await updateRealm((r) => { const drawn = deck.drawMonthlyEvents(r); extra += drawn.filter((c) => ongoing.some((e) => e.id === c.eventId) || getEvents().find((e) => e.id === c.eventId)?.continuous && getEvents().find((e) => e.id === c.eventId)?.kind === "problem").length; for (const c of drawn) c.status = "resolved"; });
}
ok(extra === 0, `no third ongoing problem drawn in 30 months (${extra})`);
