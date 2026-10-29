import { env } from "./setup.mjs";
const R = "/home/claude/ukm-repo/scripts";
const { preloadData, getEvents } = await import(`${R}/content/data.js`);
await preloadData();
env.settings.set("seatAssignments", { viceroy: { companion: "ekundayo" }, emissary: {} });
const { getRealm, updateRealm } = await import(`${R}/realm/state.js`);
const deck = await import(`${R}/realm/deck.js`);
const RS = await import(`${R}/realm/resolve.js`);
const { getMatters } = await import(`${R}/content/data.js`).then((m) => m);
let warden, ruler;
await updateRealm((r) => {
  const all = [...(globalThis.__events ?? [])];
  for (let i = 0; i < 60 && (!warden || !ruler); i++) {
    const c = deck.drawWeeklyMatter(r);
    if (c?.seat === "viceroy" && !warden) warden = c; else if (c?.seat === "emissary" && !ruler) ruler = c;
  }
});
console.log("cards", warden?.name, ruler?.name);
console.log("seatsOf wes", RS.seatsOf("Actor.wes"));
const skillW = RS.cardStage(warden).skills[0];
const { PERSONAL_SKILLS } = await import(`${R}/constants.js`);
let r = await RS.assignCard({ cardId: warden.id, type: "pc", actorUuid: "Actor.wes", skill: skillW, personalSkill: "survival", userId: "gm" });
console.log("lend", r, getRealm().cards.find((c) => c.id === warden.id).assignee);
r = await RS.assignCard({ cardId: ruler.id, type: "advisor", skill: RS.cardStage(ruler).skills[0], userId: "gm" });
console.log("ruler delegate", r);
console.log("busy ruler", RS.busyWith(getRealm(), "seat:emissary")?.name, "busy general", RS.busyWith(getRealm(), "seat:general")?.name ?? null);
console.log(env.messages.at(-1)?.content);
await RS.unassignCard({ cardId: warden.id, userId: "gm" });
r = await RS.assignCard({ cardId: ruler.id, type: "advisor", skill: RS.cardStage(ruler).skills[0], userId: "gm" });
console.log("after recall", r);
