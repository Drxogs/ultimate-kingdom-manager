import { env } from "./setup.mjs";
const notes = []; const journals = []; let n = 0;
const doc = (d) => ({ ...d, id: `d${++n}`, getFlag(s, k) { return this.flags?.[s]?.[k]; } });
kingmaker.region.scene = { notes: { filter: (fn) => notes.filter(fn) },
  async createEmbeddedDocuments(t, list) { const m = list.map(doc); notes.push(...m); return m; },
  async updateEmbeddedDocuments(t, list) { for (const u of list) { const x = notes.find((y) => y.id === u._id); Object.assign(x, u); } return list; },
  async deleteEmbeddedDocuments(t, ids) { for (const id of ids) notes.splice(notes.findIndex((x) => x.id === id), 1); return ids; } };
globalThis.JournalEntry = { create: async (d) => { const j = doc({ ...d, pages: { contents: [] } }); j.createEmbeddedDocuments = async (t, l) => { const m = l.map((x) => doc({ ...x, parent: j })); j.pages.contents.push(...m); return m; }; j.deleteEmbeddedDocuments = async (t, ids) => { j.pages.contents = j.pages.contents.filter((p) => !ids.includes(p.id)); }; journals.push(j); return j; } };
game.journal = { find: (fn) => journals.find(fn), [Symbol.iterator]: function* () { yield* journals; } };
game.folders = { find: () => null };
const R = "/home/claude/ukm-repo/scripts";
const { preloadData } = await import(`${R}/content/data.js`);
await preloadData();
env.settings.set("seatAssignments", {}); env.settings.set("levelGravity", 1); env.settings.set("costGradient", {}); env.settings.set("pinResolved", "remove");
const { getRealm, updateRealm } = await import(`${R}/realm/state.js`);
const P = await import(`${R}/realm/projects.js`); const RS = await import(`${R}/realm/resolve.js`); const PI = await import(`${R}/realm/pins.js`);
await updateRealm((r) => { r.settlements = [{ id: "cap", name: "Tatzleford", type: "village", capital: true, buildings: [] }]; r.treasury = 20; r.cards.push({ id: "ev1", eventId: "monster-activity", name: "Monster Activity", kind: "problem", seat: "warden", status: "open", deadline: env.time + 86400 * 30, target: { hexKey: "1001" }, revealed: false }); });
await P.startProject({ type: "build-road", hexKey: "1002", userId: "gm" }, { canActForSeat: RS.canActForSeat });
console.log("pins after project", notes.map((x) => [x.text, x.flags["ultimate-kingdom-manager-next"].public]));
await PI.setRevealed("ev1", true);
console.log("after reveal", notes.map((x) => [x.text, x.flags["ultimate-kingdom-manager-next"].public ?? x["flags.ultimate-kingdom-manager-next.public"]]), journals[0]?.pages.contents.map((p) => p.name));
console.log("hud 1001", PI.cardsOnHex("1001").map((c) => c.name), "hud 1002", PI.cardsOnHex(1002).map((c) => c.name));
await PI.setRevealed("ev1", false);
console.log("after hide", notes.length, journals[0]?.pages.contents.map((p) => p.name));
