import { env } from "./setup.mjs";
globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0, OBSERVER: 2 }, JOURNAL_ENTRY_PAGE_FORMATS: { HTML: 1 } };
const journals = [];
const folders = [];
const mkPage = (j, d) => ({ ...d, id: `p${Math.random()}`, getFlag: function (s, k) { return this.flags?.[s]?.[k]; } });
globalThis.Folder = { create: async (d) => { const f = { ...d, id: "f1", getFlag: (s, k) => d.flags[s][k] }; folders.push(f); return f; } };
globalThis.JournalEntry = { create: async (d) => {
  const j = { ...d, id: `j${journals.length}`, pages: { contents: [] }, getFlag: (s, k) => d.flags[s][k], sheet: { render() {} },
    async createEmbeddedDocuments(t, list) { const made = list.map((x) => mkPage(j, x)); j.pages.contents.push(...made); return made; },
    async deleteEmbeddedDocuments(t, ids) { j.pages.contents = j.pages.contents.filter((p) => !ids.includes(p.id)); return ids; },
    async updateEmbeddedDocuments(t, list) { const out = []; for (const u of list) { const p = j.pages.contents.find((x) => x.id === u._id); for (const [k, v] of Object.entries(u)) { if (k === "_id") continue; const parts = k.split("."); let o = p; while (parts.length > 1) { const q = parts.shift(); o[q] ??= {}; o = o[q]; } o[parts[0]] = v; } out.push(p); } return out; } };
  journals.push(j); return j; } };
game.folders = { find: (fn) => folders.find(fn) };
game.journal = { find: (fn) => journals.find(fn), [Symbol.iterator]: function* () { yield* journals; } };
const R = "/home/claude/ukm-repo/scripts";
const { preloadData } = await import(`${R}/content/data.js`);
await preloadData();
env.settings.set("structureCatalog", [{ slug: "mill", name: "Mill", level: 1, bp: 10, skill: "industry" }]);
const H = await import(`${R}/content/handbook.js`);
await H.ensureHandbook();
for (const j of journals) console.log(j.name, j.ownership, j.pages.contents.map((p) => `${p.name}(${p.text.content.length})`).join(", "));
const dup = journals[0].pages.contents.find((p) => p.flags["ultimate-kingdom-manager-next"].handbookKey === "projectref"); dup.flags["ultimate-kingdom-manager-next"].handbookKey = "projects";
const before = journals[0].pages.contents.length;
await H.ensureHandbook();
console.log("second run pages", journals[0].pages.contents.length, before, journals[0].pages.contents.map((p) => p.flags["ultimate-kingdom-manager-next"].handbookKey).join(","));
console.log(journals[0].pages.contents.find((p) => p.name === "Companion Abilities").text.content.slice(0, 700));
