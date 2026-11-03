import { env } from "./setup.mjs";
const R = "/home/claude/ukm-repo/scripts";
const { preloadData } = await import(`${R}/content/data.js`);
await preloadData();
env.settings.set("seatAssignments", {});
const ok = (c, m) => console.log(c ? "ok  " : "FAIL", m);
const { getRealm, updateRealm } = await import(`${R}/realm/state.js`);
const { resolveDue } = await import(`${R}/realm/resolve.js`);
const plagues = () => getRealm().cards.filter((c) => c.eventId === "plague" && ["open", "assigned", "rolled"].includes(c.status));

await updateRealm((r) => {
  r.settlements = [
    { id: "cap", name: "Capital", type: "town", capital: true, key: "1001", tracks: { food: 3 }, buildings: [] },
    { id: "t2", name: "Town Two", type: "village", key: "1002", tracks: {}, buildings: [] }
  ];
  r.cards = [{ id: "p1", eventId: "plague", name: "Plague", kind: "problem", seat: "emissary", status: "open", deadline: env.time + 86400 * 30, target: { settlement: "Capital" } }];
  r.scheduled = [
    { id: "s1", eventId: "plague", at: env.time - 1, placement: "nearest-unaffected-settlement", from: "Capital" },
    { id: "s2", eventId: "plague", at: env.time - 1, placement: "nearest-unaffected-settlement", from: "Capital" }
  ];
});
await resolveDue();
const list = plagues();
ok(list.length === 2, `plague spread to one new place only (${list.length} active)`);
ok(list.some((c) => c.target?.settlement === "Town Two"), "the new plague is in the unaffected settlement");
ok(!getRealm().scheduled.length, "the spread with nowhere to go was dropped");
await updateRealm((r) => { r.scheduled = [{ id: "s3", eventId: "plague", at: env.time - 1, placement: "nearest-unaffected-settlement", from: "Town Two" }]; });
await resolveDue();
ok(plagues().length === 2, "no third plague when every settlement has one");
