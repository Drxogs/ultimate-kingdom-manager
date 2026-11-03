// Times one redraw of the Kingdom Manager on a late-campaign realm. Make the realm first:
// STORY=1 PARTY=average DUMP=simout/late-realm.json node sim-campaign.mjs 2 90 daily
import { env } from "./setup.mjs";
import fs from "node:fs";
foundry.applications.api.ApplicationV2 = class { async _prepareContext() { return {}; } _configureRenderParts() { return {}; } _prepareTabs() { return { overview: { cssClass: "active" }, desks: {}, council: {}, log: {}, gm: {} }; } async _preparePartContext(p, c) { return c; } };
foundry.applications.api.HandlebarsApplicationMixin = (c) => c;
const R = "/home/claude/ukm-repo/scripts";
const dump = JSON.parse(fs.readFileSync("simout/late-realm.json", "utf8"));
env.flags[`${env.id}.realm`] = dump.realm;
for (const [k, v] of Object.entries(dump.settings)) env.settings.set(k, v);
const acts = game.actors ?? []; if (!acts.find) Object.assign(acts, { find: () => null, filter: () => [], get: () => null }); game.actors = acts;
const { preloadData } = await import(`${R}/content/data.js`);
await preloadData();
let merges = 0;
const orig = foundry.utils.mergeObject;
foundry.utils.mergeObject = (...a) => { merges++; return orig(...a); };
const { KingdomManager } = await import(`${R}/apps/kingdom-manager.js`);
const app = new KingdomManager();
await app._prepareContext({});
merges = 0;
const N = 10;
const t = performance.now();
for (let i = 0; i < N; i++) await app._prepareContext({});
const ms = (performance.now() - t) / N;
console.log("ms per render", ms.toFixed(1), "mergeObject calls per render", merges / N);
if (process.env.PROFILE) {
  const { getRealm } = await import(`${R}/realm/state.js`);
  const t2 = performance.now(); for (let i = 0; i < 200; i++) getRealm(); console.log("getRealm ms", ((performance.now() - t2) / 200).toFixed(3));
}
