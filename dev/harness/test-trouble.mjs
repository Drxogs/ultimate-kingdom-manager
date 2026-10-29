import { env } from "./setup.mjs";
const R = "/home/claude/ukm-repo/scripts";
const { preloadData, getTroubles, getCardEvent } = await import(`${R}/content/data.js`);
await preloadData();
env.settings.set("seatAssignments", {});
const ok = (c, m) => console.log(c ? "ok  " : "FAIL", m);
const S = await import(`${R}/realm/settlements.js`);
const TR = await import(`${R}/realm/troubles.js`);
const G = await import(`${R}/realm/gm.js`);
const C = await import(`${R}/constants.js`);
const { getRealm, updateRealm } = await import(`${R}/realm/state.js`);

ok(getTroubles().length === 16, "16 trouble cards");
for (const t of getTroubles()) {
  const skills = C.REALM_STATS[Object.keys(C.REALM_STATS).find((k) => C.REALM_STATS[k].seat === t.seat)]?.skills ?? [];
  if (!t.skill.every((s) => skills.includes(s))) ok(false, `${t.id} skills fit its seat ${t.seat}`);
}
await S.foundCapital({ name: "Monkeyton", userId: "gm" });
const capId = () => getRealm().settlements.find((s) => s.capital).id;
const cap = () => getRealm().settlements.find((s) => s.capital);
const always = () => 0;

// Easy start.
ok(TR.inQuietStart(getRealm()), "new kingdom is in its easy start");
await updateRealm((r) => { r.settlements[0].tracks = { homes: 0 }; });
ok(TR.troubleOptions(cap()).map((g) => g.cause).sort().join() === "faith,food", "a village without food or faith is open to that trouble");
let drawn = [];
await updateRealm((r) => { drawn = TR.drawTroubles(r, { rnd: always }); });
ok(drawn.length === 0, "no trouble in the first three months");
env.advance(91);
ok(!TR.inQuietStart(getRealm()), "after 90 days the easy start ends");
await updateRealm((r) => { drawn = TR.drawTroubles(r, { rnd: always }); });
ok(drawn.length === 2 && drawn.every((c) => c.trouble && c.target.settlementId === capId()), `one card per missing need (${drawn.map((c) => c.name)})`);
ok(drawn.some((c) => c.name === "Empty Bellies") && drawn.some((c) => c.name === "Crisis of Faith"), "Empty Bellies and Crisis of Faith");
await updateRealm((r) => { drawn = TR.drawTroubles(r, { rnd: always }); });
ok(drawn.length === 0, "the same trouble isn't drawn twice while it's open");
await updateRealm((r) => { drawn = TR.drawTroubles(r, { rnd: () => 0.9 }); });
ok(drawn.length === 0, "it's a chance: a high roll draws nothing");
ok(getCardEvent(getRealm().cards.find((c) => c.name === "Empty Bellies")).hook.includes("hunt"), "card reads its text from the trouble data");

// A town short on faith draws Unquiet Dead; Tenements draw crime and fires; crime checks take −1.
await updateRealm((r) => { r.cards = []; r.settlements[0].tracks = { homes: 1, food: 1, faith: 0, watch: 0 }; });
const causes = TR.troubleOptions(cap());
ok(causes.find((g) => g.cause === "faith")?.cards.map((t) => t.name).join() === "Unquiet Dead", "town with only a shrine: Unquiet Dead");
ok(causes.find((g) => g.cause === "tenements")?.cards.map((t) => t.name).sort().join() === "Pickpocket Ring,Shanty Fire", "Tenements: Pickpocket Ring and Shanty Fire");
const crime = TR.troubleCard(getTroubles().find((t) => t.name === "Pickpocket Ring"), cap());
const mods = S.structureModifiers(getRealm(), crime, "intrigue");
ok(mods.some((m) => m.slug === "ukm-dirty-streets" && m.modifier === -1), "crime checks in Tenements take −1");
const fire = TR.troubleCard(getTroubles().find((t) => t.name === "Shanty Fire"), cap());
ok(!S.structureModifiers(getRealm(), fire, "exploration").some((m) => m.slug === "ukm-dirty-streets"), "a fire isn't a crime check");
ok(S.structureModifiers(getRealm(), { eventId: "vandals", target: { settlementId: capId() } }, "intrigue").some((m) => m.slug === "ukm-dirty-streets"), "book crime events count too");
await updateRealm((r) => { r.settlements[0].tracks.homes = 2; });
ok(!S.structureModifiers(getRealm(), crime, "intrigue").some((m) => m.slug === "ukm-dirty-streets"), "Neighborhoods: no dirty streets");

// GM: draw one now.
await updateRealm((r) => { r.cards = []; r.settlements[0].tracks = { homes: 0 }; r.settlements[0].founded = game.time.worldTime; });
const res = await G.gmAction({ op: "drawTrouble", settlementId: capId(), userId: "gm" });
ok(getRealm().cards.filter((c) => c.trouble).length === 1, `GM draws one even in the easy start (${res.notice})`);
await updateRealm((r) => { r.settlements[0].tracks = { homes: 0, food: 0, faith: 0 }; });
const res2 = await G.gmAction({ op: "drawTrouble", settlementId: capId(), userId: "gm" });
ok(res2.notice.includes("Nothing is missing"), "nothing missing, nothing to draw");

// Every outcome of every trouble card applies cleanly.
const { EffectContext, applyEffects, describeEffect } = await import(`${R}/realm/effects.js`);
let bad = 0;
for (const t of getTroubles()) {
  for (const [deg, list] of Object.entries(t.outcomes)) {
    try {
      for (const e of list) if (!describeEffect(e) || /Manual|UKM\./.test(describeEffect(e))) { bad++; console.log("desc", t.id, deg, JSON.stringify(e), describeEffect(e)); }
      globalThis.__dialog.push("0", "0");
      await updateRealm(async (realm) => {
        const ctx = new EffectContext({ realm, card: TR.troubleCard(t, realm.settlements[0]), event: t });
        await applyEffects(ctx, list);
      });
    } catch (e) { bad++; console.log("err", t.id, deg, e.message); }
  }
}
ok(!bad, "all trouble outcomes describe and apply");

// All its trouble already out: say so.
await updateRealm((r) => { r.cards = []; r.settlements[0].tracks = { homes: 0, food: 0 }; });
await G.gmAction({ op: "drawTrouble", settlementId: capId(), userId: "gm" });
await G.gmAction({ op: "drawTrouble", settlementId: capId(), userId: "gm" });
const r3 = await G.gmAction({ op: "drawTrouble", settlementId: capId(), userId: "gm" });
ok(r3.notice.includes("already on a desk"), `all out: ${r3.notice}`);
const { getStory } = await import(`${R}/content/data.js`);
ok(getTroubles().every((t) => ["criticalSuccess", "success", "failure", "criticalFailure"].every((d) => getStory(t.id, d))), "every trouble card has a story for each result");
