import { env } from "./setup.mjs";
const R = "/home/claude/ukm-repo/scripts";
const { preloadData } = await import(`${R}/content/data.js`);
await preloadData();
for (const [k, v] of Object.entries({ seatAssignments: { warden: { companion: "amiri" }, treasurer: { companion: "jubilost" }, magister: { companion: "tristian" }, emissary: { companion: "jaethal" }, viceroy: { companion: "ekundayo" } }, levelGravity: 1, costGradient: {}, clock: {}, audiences: true, council: true, deskMatters: true, pinResolved: "remove", tapTreasury: "allowed", structureCatalog: [{ slug: "mill", name: "Mill", level: 1, bp: 10, skill: "industry" }] })) env.settings.set(k, v);
env.kingdom.leadership.emissary = { uuid: null }; env.kingdom.leadership.treasurer = { uuid: null };
const { getRealm, updateRealm } = await import(`${R}/realm/state.js`);
const { tick } = await import(`${R}/realm/clock.js`);
const RS = await import(`${R}/realm/resolve.js`);
const RK = await import(`${R}/realm/ranks.js`);
const P = await import(`${R}/realm/projects.js`);
const A = await import(`${R}/realm/audiences.js`);
await RK.applyFounding(["loyalty", "economy"]);
await updateRealm((r) => { r.settlements = [{ id: "cap", name: "Tatzleford", type: "village", capital: true, buildings: [] }]; r.treasury = 40; });
await tick();
let errors = 0;
for (let day = 0; day < 365; day++) {
  try {
    env.advance(1);
    globalThis.__setDegree(Math.floor(Math.random() * 4));
    await tick();
    const realm = getRealm();
    for (const c of realm.cards.filter((c) => c.status === "open")) {
      if (c.kind === "audience") await A.answerAudience({ cardId: c.id, response: A.audienceResponses(c).responses[0].id, userId: "gm" });
      else await RS.assignCard({ cardId: c.id, type: "advisor", userId: "gm" });
    }
    for (const c of getRealm().cards.filter((c) => c.status === "rolled")) if (Math.random() < 0.5) await RS.acceptRoll(c.id);
    if (day % 30 === 5) {
      for (const seat of ["warden", "viceroy", "treasurer", "magister", "emissary"]) {
        const defs = P.projectsForSeat(seat);
        for (const def of defs) { const t = P.projectTargets(def)[0]; if (t) await P.startProject({ type: def.id, hexKey: t.hexKey, structure: "mill", userId: "gm" }, { canActForSeat: RS.canActForSeat }); }
      }
    }
    for (const stat of Object.keys(getRealm().stats)) {
      const r = await RK.startRankUp({ stat, userId: "gm" });
      const proj = RK.rankUpProject(getRealm(), stat);
      if (proj?.status === "choosing") await RK.chooseRankUp({ projectId: proj.id, option: RK.rankUpChoices(proj).options[1].id, userId: "gm" });
    }
  } catch (e) { errors++; console.log("ERROR day", day, e.stack.split("\n").slice(0, 4).join(" | ")); if (errors > 5) break; }
}
const realm = getRealm();
const kinds = {}; for (const c of realm.cards) kinds[`${c.kind}:${c.status}`] = (kinds[`${c.kind}:${c.status}`] ?? 0) + 1;
console.log("errors", errors, "treasury", realm.treasury, "unrest", env.kingdom.unrest.value, "fame", env.kingdom.resources.fame.value);
console.log("stats", Object.entries(realm.stats).map(([k, v]) => `${k}:${v.rank}/${Math.round(v.points)}`).join(" "));
console.log("cards", kinds, "gmTasks", realm.gmTasks.length, "ambitions", realm.ambitions, "structures", realm.structures);
console.log("messages", env.messages.length, "log", realm.log.length);
