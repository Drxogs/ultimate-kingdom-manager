import { env } from "./setup.mjs";
const R = "/home/claude/ukm-repo/scripts";
const { preloadData } = await import(`${R}/content/data.js`);
await preloadData();
const ok = (c, m) => console.log(c ? "ok  " : "FAIL", m);
const S = await import(`${R}/realm/settlements.js`);
const { getRealm } = await import(`${R}/realm/state.js`);
// Tatzleford is drawn on the map at 1002; found it as the capital, rename it, and the map label isn't adopted again.
await S.foundCapital({ mapHex: "1002", userId: "gm" });
ok(getRealm().settlements.length === 1, "capital from the map");
await S.renameSettlement(getRealm().settlements[0].id, "Monkeyton");
await S.adoptMapSettlements();
ok(getRealm().settlements.length === 1 && getRealm().settlements[0].name === "Monkeyton", `rename doesn't bring the old map name back (${getRealm().settlements.map((s) => s.name)})`);
env.hexes["1003"] = { claimed: true, features: [{ type: "village", name: "Newvale" }] };
await S.adoptMapSettlements();
ok(getRealm().settlements.some((s) => s.name === "Newvale"), "a newly drawn village joins");
