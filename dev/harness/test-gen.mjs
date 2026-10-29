import { env } from "./setup.mjs";
const R = "/home/claude/ukm-repo/scripts";
const { preloadData, getProject } = await import(`${R}/content/data.js`);
await preloadData();
env.settings.set("seatAssignments", {}); env.settings.set("levelGravity", 1); env.settings.set("costGradient", {});
const P = await import(`${R}/realm/projects.js`); const RS = await import(`${R}/realm/resolve.js`);
const { getRealm, updateRealm } = await import(`${R}/realm/state.js`);
await updateRealm((r) => { r.settlements = [{ id: "cap", name: "Tatzleford", type: "village", capital: true, buildings: [] }]; r.treasury = 30; });
console.log("general", P.projectsForSeat("general").map((p) => p.id));
for (const id of ["fortify-hex", "muster-troops"]) { const d = getProject(id); const t = P.projectTargets(d); console.log(id, t.length, P.projectQuote(d, t[0])); }
console.log(await P.startProject({ type: "muster-troops", userId: "gm" }, { canActForSeat: RS.canActForSeat }));
console.log("after", P.projectsForSeat("general").map((p) => p.id));
console.log(await P.startProject({ type: "fortify-hex", hexKey: "1001", userId: "gm" }, { canActForSeat: RS.canActForSeat }));
const c = getRealm().cards.at(-1); await RS.assignCard({ cardId: c.id, type: "advisor", userId: "gm" }); await RS.rollCard(c.id); await RS.acceptRoll(c.id);
console.log(getRealm().fortified, getRealm().gmTasks.map((t) => t.text), P.projectTargets(getProject("fortify-hex")).length);
