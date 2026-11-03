import { env } from "./setup.mjs";
const R = "/home/claude/ukm-repo/scripts";
const { preloadData } = await import(`${R}/content/data.js`);
await preloadData();
env.settings.set("seatAssignments", {});
const ok = (c, m) => console.log(c ? "ok  " : "FAIL", m);
const { applyEffects, commitKingdomChanges, EffectContext } = await import(`${R}/realm/effects.js`);
const { resolveFlat } = await import(`${R}/realm/flat.js`);
const { getRealm, updateRealm } = await import(`${R}/realm/state.js`);
const { getKingdom } = await import(`${R}/integrations/party.js`);

await getKingdom().update({ "unrest.value": 10 });
let ctx;
await updateRealm(async (realm) => { ctx = new EffectContext({ realm, card: null, event: null, source: "Quell Unrest" }); await applyEffects(ctx, [{ unrest: "-1d4" }]); });
await commitKingdomChanges(ctx);
const flat = getRealm().pendingFlats.at(-1);
ok(flat?.dice?.formula === "1d4" && getKingdom().unrest.value === 10, "Unrest −1d4 waits for a roll; nothing changes yet");
ok(env.messages.at(-1)?.content.includes("Roll 1d4"), "chat has a Roll 1d4 button");
let r = await resolveFlat({ id: flat.id, total: 3 });
ok(r.ok && getKingdom().unrest.value === 7, `rolled 3: Unrest 10 → ${getKingdom().unrest.value}`);
r = await resolveFlat({ id: flat.id, total: 3 });
ok(!r.ok, "can't be rolled twice");

// In anarchy, Quell Unrest's ×2 still applies when the roll comes in.
await getKingdom().update({ "unrest.value": 25 });
await updateRealm(async (realm) => { ctx = new EffectContext({ realm, card: null, event: null }); await applyEffects(ctx, [{ unrest: "-1d4", anarchyTimes: 2 }]); });
await commitKingdomChanges(ctx);
await resolveFlat({ id: getRealm().pendingFlats.at(-1).id, total: 4 });
ok(getKingdom().unrest.value === 17, `anarchy doubles the rolled 4: 25 → ${getKingdom().unrest.value}`);

// Turned off: rolled at once.
env.settings.set("rollDice", false);
await updateRealm(async (realm) => { ctx = new EffectContext({ realm, card: null, event: null }); await applyEffects(ctx, [{ unrest: "1d4" }]); });
ok(ctx.unrest >= 1 && ctx.unrest <= 4 && !(ctx.flatChecks ?? []).length, `setting off: rolled straight away (${ctx.unrest})`);
