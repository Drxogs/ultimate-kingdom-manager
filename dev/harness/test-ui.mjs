import { env } from "./setup.mjs";
import Handlebars from "handlebars";
import fs from "node:fs";
foundry.applications.api.ApplicationV2 = class { async _prepareContext() { return {}; } _prepareTabs() { return { overview: { cssClass: "active" }, desks: {}, council: {}, log: {} }; } async _preparePartContext(p, c) { return c; } };
foundry.applications.api.HandlebarsApplicationMixin = (c) => c;
globalThis.Handlebars = Object.assign(Handlebars, {});
const R = "/home/claude/ukm-repo/scripts";
const { preloadData } = await import(`${R}/content/data.js`);
await preloadData();
for (const [k, v] of Object.entries({ seatAssignments: { warden: { companion: "amiri", supervisor: "Actor.wes" }, treasurer: { companion: "jubilost" } }, levelGravity: 1, costGradient: {}, clock: {}, audiences: true, council: true, deskMatters: true, tapTreasury: "approval", storyImported: true, betweenSessions: false, structureCatalog: [{ slug: "houses", name: "Houses", lots: 1, residential: true, bonuses: [], art: ["art/a.svg", "art/b.svg"] }, { slug: "mill", name: "Mill", lots: 1, bonuses: [{ value: 1, skills: ["agriculture"] }], consumption: 1, needsWater: true }, { slug: "shrine", name: "Shrine", lots: 1, bonuses: [{ value: 1, skills: ["folklore"] }] }, { slug: "tenement", name: "Tenement", lots: 1, residential: true, bonuses: [] }, { slug: "town-hall", name: "Town Hall", lots: 2, edifice: true, bonuses: [], art: ["art/wide.svg"] }, { slug: "arena", name: "Arena", lots: 4, bonuses: [], art: ["art/big.svg"] }, { slug: "paved-streets", name: "Paved Streets", lots: 0, infrastructure: true, bonuses: [] }, { slug: "inn", name: "Inn", lots: 1, residential: true, bonuses: [{ value: 1, skills: ["exploration"] }] }] })) env.settings.set(k, v);
const { getRealm, updateRealm } = await import(`${R}/realm/state.js`);
const deck = await import(`${R}/realm/deck.js`);
const A = await import(`${R}/realm/audiences.js`);
const C = await import(`${R}/realm/council.js`);
await updateRealm((r) => { r.settlements = process.env.NOCAP ? [] : [{ id: "cap", name: "Tatzleford", type: "town", capital: true, waterside: true, buildings: [{ slug: "houses", name: "Houses", lots: 1 }, { slug: "mill", name: "Mill", lots: 1 }, { slug: "shrine", name: "Shrine", lots: 1 }, { slug: "tenement", name: "Tenement", lots: 1 }, { slug: "town-hall", name: "Town Hall", lots: 2 }, { slug: "arena", name: "Arena", lots: 4 }, { slug: "houses", name: "Houses", lots: 1 }, { slug: "paved-streets", name: "Paved Streets", lots: 0 }] }, { id: "v2", name: "Oleg's", type: "village", capital: false, buildings: [{ slug: "inn", name: "Inn", lots: 1 }] }]; r.treasury = 30; deck.drawWeeklyMatter(r); deck.drawMonthlyEvents(r); A.drawAudience(r); r.debt.amount = 10; });
await C.proposeProject({ type: "claim-hex", hexKey: "1003", userId: "gm" });
// ONGOING-CARD: an ongoing event on a desk (its tag has a tooltip saying what ends it).
{ const { getEvents } = await import(`${R}/content/data.js`); await updateRealm((r) => { r.cards.push(deck.createCard(getEvents().find((e) => e.id === "bandit-activity"))); }); }
// TRACKS-PREVIEW: the capital as a town with a few tracks, the village with its starters.
await updateRealm((r) => {
  r.settlements[0].tracks = { homes: 1, food: 2, faith: 1, commerce: 2, walls: 1, watch: 0, industry: 1, performance: 0, learning: 0 };
  r.settlements[0].pinnacles = [];
  r.settlements[1].tracks = { homes: 0, food: 0, faith: 0 };
  r.settlements[1].pinnacles = [];
  if (process.env.BIG) { r.settlements[0].tracks = { homes: 3, food: 3, faith: 3, commerce: 3, walls: 3, watch: 3, industry: 3, performance: 3, learning: 3, governance: 3, army: 2, publicworks: 3 }; r.settlements[0].pinnacles = ["faith", "learning"]; }
});
globalThis.CONFIG = {};
if (process.env.JUMP) {
  const { tick } = await import(`${R}/realm/clock.js`);
  await tick();
  for (const [i, days] of (process.env.JUMP.split(",").map(Number)).entries()) {
    env.advance(days);
    try { await tick(); } catch (e) { console.log("TICK ERROR", e.stack.split("\n").slice(0, 5).join(" | ")); }
  }
  const r = getRealm();
  console.log("cards", r.cards.length, "statuses", JSON.stringify(r.cards.reduce((m, c) => ((m[c.status] = (m[c.status] ?? 0) + 1), m), {})), "size", JSON.stringify(r).length);
}
game.actors.filter = () => [];
game.actors.find = () => null;
const { KingdomManager } = await import(`${R}/apps/kingdom-manager.js`);
const app = new KingdomManager();
const ctx = await app._prepareContext({});
const helpers = { localize: (k, o) => (o?.hash && Object.keys(o.hash).length ? game.i18n.format(k, o.hash) : game.i18n.localize(k)), ukmSigned: (n) => (n > 0 ? `+${n}` : `${n}`), concat: (...a) => a.slice(0, -1).join(""), gt: (a, b) => a > b, lt: (a, b) => a < b, eq: (a, b) => a === b };
for (const [n, f] of Object.entries(helpers)) Handlebars.registerHelper(n, f);
const out = {};
for (const part of ["header", "overview", "desks", "settlements", "council", "log"]) {
  const tpl = Handlebars.compile(fs.readFileSync(`/home/claude/ukm-repo/templates/manager/${part}.hbs`, "utf8"));
  const html = tpl({ ...ctx, tab: { cssClass: part === (process.env.TAB ?? "desks") ? "active" : "" } });
  out[part] = html;
  console.log(part, html.length, (html.match(/UKM\.[A-Za-z.]+/g) ?? []).slice(0, 5));
  if (part === "desks") console.log(html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 1400));
  if (part === "overview") console.log(html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 2600));
  if (part === "council") console.log(html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 400));
}
if (process.env.PREVIEW) {
  const tabs = ["overview", "desks", "settlements", "council", "log"].map((t) => `<a class="${t === (process.env.TAB ?? "desks") ? "active" : ""}" data-tab="${t}"><i></i><span>${game.i18n.localize(`UKM.Manager.Tab.${{ overview: "Overview", desks: "Desks", settlements: "Settlements", council: "Council", log: "Log" }[t]}`)}</span></a>`).join("");
  const page = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="modules/ultimate-kingdom-manager-next/styles/ukm.css"><style>body{margin:0;background:#333;font-family:Roboto,sans-serif;font-size:14px}.window-app{width:860px;height:${process.env.H ?? 900}px;display:flex;flex-direction:column;margin:10px}.window-header{background:#222;color:#eee;padding:4px 8px}button{cursor:pointer}</style></head><body>
  <div class="application ukm ukm-sheet ukm-manager themed theme-light window-app"><header class="window-header">Ultimate Kingdom Manager</header><section class="window-content">${out.header}<nav class="tabs">${tabs}</nav>${out.overview}${out.desks}${out.settlements}${out.council}${out.log}</section></div></body></html>`;
  fs.writeFileSync(process.env.PREVIEW, page);
}
