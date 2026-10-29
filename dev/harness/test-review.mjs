import { env } from "./setup.mjs";
const R = "/home/claude/ukm-repo/scripts";
const { preloadData } = await import(`${R}/content/data.js`);
await preloadData();
const ok = (c, m) => console.log(c ? "ok  " : "FAIL", m);
env.settings.set("structureCatalog", [
  { slug: "houses", name: "Houses", lots: 1, residential: true, bp: 5, level: 1 },
  { slug: "brewery", name: "Brewery", lots: 1, bp: 10, level: 1 },
  { slug: "alchemy-laboratory", name: "Alchemy Laboratory", lots: 1, bp: 32, level: 1 },
  { slug: "cemetary", name: "Cemetary", lots: 1, bp: 6, level: 1 }
]);
const S = await import(`${R}/realm/settlements.js`);
const { getRealm, updateRealm } = await import(`${R}/realm/state.js`);
const user = { isGM: false, id: "p" };
ok(!S.canFoundCapital(user) && S.canFoundCapital({ isGM: true }), "only the GM founds the capital");
await S.foundCapital({ name: "Monkeyton", userId: "gm" });
const cap = getRealm().settlements.find((s) => s.capital);
ok(cap?.tracks?.homes === 0 && cap.tracks.food === 0 && cap.tracks.faith === 0, "capital starts with Huts, a Campfire and a Shrine");
const st = S.settlementState(cap);
ok(st.type === "village" && st.consumption === 1 && st.missing.length === 0, "a village with its starters needs nothing more and eats 1 food");
// settlement events
const deck = await import(`${R}/realm/deck.js`);
let found = null;
for (let i = 0; i < 300 && !found; i++) { const c = deck.createCard({ id: "x", name: "X", kind: "problem", seat: "ruler", placement: { type: "settlement", rule: "capital" } }); found = c.target.settlement; }
ok(found === "Monkeyton", "settlement event uses the Settlements tab (capital rule)");
