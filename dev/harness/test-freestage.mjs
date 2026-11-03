import { env } from "./setup.mjs";
const R = "/home/claude/ukm-repo/scripts";
const ok = (c, m) => console.log(c ? "ok  " : "FAIL", m);
const { preloadData, getEvent } = await import(`${R}/content/data.js`);
await preloadData();
const { getRealm, updateRealm } = await import(`${R}/realm/state.js`);
const { applyEffects, EffectContext } = await import(`${R}/realm/effects.js`);
await updateRealm((r) => { r.treasury = 0; r.settlements = [{ id: "cap", name: "Capital", capital: true, type: "village", tracks: { homes: 0, food: 0, faith: 0 }, pinnacles: [] }]; });
const run = async (effects) => { await updateRealm(async (r) => { const ctx = new EffectContext({ realm: r, card: null, event: null }); await applyEffects(ctx, effects); }); };
await run([{ freeTrackStage: { track: "performance" } }]);
ok(getRealm().settlements[0].tracks.performance === 0, `performance starter built free (${JSON.stringify(getRealm().settlements[0].tracks)})`);
ok(getRealm().treasury === 0, "nothing paid");
await run([{ freeTrackStage: { track: "homes" } }]);
const homes = getRealm().settlements[0].tracks.homes;
ok(homes === 1 || getRealm().treasury > 0, `homes raised or BP instead (homes ${homes}, treasury ${getRealm().treasury})`);
for (const id of ["noblesse-oblige", "wealthy-immigrant", "boomtown"]) {
  const s = JSON.stringify(getEvent(id)?.outcomes ?? {});
  ok(!s.includes("freeStructure") && !s.includes("settlementItemBonus"), `${id} has no building-era effects`);
}
