import fs from "node:fs";
globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0, OBSERVER: 2 }, JOURNAL_ENTRY_PAGE_FORMATS: { HTML: 1 } };
import path from "node:path";
const ROOT = "/home/claude/ukm-repo";
const lang = JSON.parse(fs.readFileSync(`${ROOT}/lang/en.json`, "utf8"));
const lookup = (key) => key.split(".").reduce((o, k) => o?.[k], lang);
const settings = new Map();
const flags = {};
const messages = [];
let worldTime = 86400 * 400;
let idc = 0;
globalThis.document = { createElement: () => ({ set innerHTML(v) { this.textContent = String(v).replace(/<[^>]+>/g, " "); }, textContent: "" }) };
globalThis.Handlebars = { escapeExpression: (s) => String(s ?? "").replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`) };
globalThis.Hooks = { on() {}, once() {}, callAll() {} };
globalThis.ui = { notifications: { info: (m) => console.log("INFO", m), warn: (m) => console.log("WARN", m) } };
const dialogAnswers = [];
globalThis.__dialog = dialogAnswers;
const DialogV2 = {
  wait: async (o) => (dialogAnswers.length ? dialogAnswers.shift() : o.buttons[0].action),
  confirm: async () => true,
  prompt: async () => null
};
globalThis.foundry = {
  applications: { api: { DialogV2, ApplicationV2: class {}, HandlebarsApplicationMixin: (c) => c }, ux: {} },
  utils: {
    randomID: () => `id${++idc}`,
    deepClone: (o) => structuredClone(o),
    mergeObject: (a, b, o) => Object.assign(structuredClone(a), structuredClone(b ?? {})),
    expandObject: (o) => o,
    hasProperty: () => false
  }
};
Math.clamp = (v, a, b) => Math.min(Math.max(v, a), b);
class Roll {
  constructor(f) { this.f = f; }
  static validate(f) { return /^\d*d\d+([+-]\d+)?$|^\d+$/.test(String(f).trim()); }
  async evaluate() { const m = this.f.match(/(\d*)d(\d+)([+-]\d+)?/); this.total = m ? (Number(m[1] || 1) * Math.ceil(Number(m[2]) / 2) + Number(m[3] || 0)) : Number(this.f); return this; }
}
globalThis.Roll = Roll;
globalThis.ChatMessage = { create: async (d) => { messages.push(d); return d; }, getWhisperRecipients: () => [] };
globalThis.fetch = async (url) => {
  const file = path.join(ROOT, url.replace(/^modules\/[^/]+\//, ""));
  return { ok: true, json: async () => JSON.parse(fs.readFileSync(file, "utf8")), text: async () => fs.readFileSync(file, "utf8") };
};
let nextDegree = 2;
globalThis.__setDegree = (d) => { nextDegree = d; globalThis.__ukmTestDegree = d; };
globalThis.__ukmTestDegree = 2;
const statistic = (mod) => ({ mod, label: "Skill", roll: async () => ({ degreeOfSuccess: nextDegree, total: 15 }) });
// The kingdom's numbers live in the realm flag now; seed them like the old PF2e mock.
flags["ultimate-kingdom-manager-next.realm"] = { kingdom: {
  active: true, level: 3, name: "Testland", size: 3, capital: null,
  abilities: { culture: { ruin: { value: 0, max: 10 }, penalty: 0 }, economy: { ruin: { value: 0, max: 10 }, penalty: 0 }, loyalty: { ruin: { value: 0, max: 10 }, penalty: 0 }, stability: { ruin: { value: 9, max: 10 }, penalty: 0 } },
  leadership: { ruler: { uuid: "Actor.wes" }, counselor: { uuid: "Actor.clorg" }, general: { uuid: "Actor.fred" } },
  resources: { fame: { value: 0, max: 3 } },
  unrest: { value: 2 }
} };
const kingdom = new Proxy({}, { get: (_, k) => flags["ultimate-kingdom-manager-next.realm"]?.kingdom?.[k], set: (_, k, v) => { flags["ultimate-kingdom-manager-next.realm"].kingdom[k] = v; return true; } });
const pc = { uuid: "Actor.wes", name: "Wes", type: "character", isOwner: true, testUserPermission: () => true, skills: { diplomacy: statistic(8), society: statistic(6), survival: statistic(4), crafting: statistic(7) } };
const party = {
  id: "party", campaign: kingdom, members: [pc], level: 3,
  getFlag: (s, k) => flags[`${s}.${k}`],
  setFlag: async (s, k, v) => { flags[`${s}.${k}`] = structuredClone(v); }
};
const users = [{ id: "gm", name: "GM", isGM: true, getFlag: () => null }];
globalThis.game = {
  user: { id: "gm", isGM: true, isActiveGM: true },
  users: Object.assign(users, { get: (id) => users.find((u) => u.id === id), activeGM: users[0] }),
  actors: { party, get: () => null, filter: () => [], contents: [pc] },
  time: { get worldTime() { return worldTime; }, calendar: null },
  i18n: {
    localize: (k) => lookup(k) ?? k,
    format: (k, d) => String(lookup(k) ?? k).replace(/\{(\w+)\}/g, (_, n) => d?.[n] ?? `{${n}}`),
    has: (k) => lookup(k) !== undefined
  },
  settings: { get: (m, k) => settings.get(k), set: async (m, k, v) => settings.set(k, v), register: () => {}, registerMenu: () => {} },
  modules: { get: () => ({ active: true }) },
  messages: { contents: [] },
  journal: { find: () => null, [Symbol.iterator]: function* () {} },
  pf2e: { Modifier: class { constructor(o) { Object.assign(this, o); } } },
  socket: { on() {}, emit() {} }
};
globalThis.fromUuidSync = (u) => (u === pc.uuid ? pc : u?.startsWith("Actor.") ? { name: u.slice(6), type: "character", testUserPermission: () => true } : null);
// a small region: claimed 1001, 1002 (village), neighbor 1003, 2001
const hexes = { "1001": { claimed: true, features: [{ type: "road" }] }, "1002": { claimed: true, features: [{ type: "village", name: "Tatzleford" }] }, "1004": { claimed: true, commodity: "lumber" } };
const neighborsMap = { 1001: [1002, 1003], 1002: [1001, 2001], 1004: [1005] };
globalThis.kingmaker = {
  CONST: {
    ZONES: { RL: { id: "RL", label: "Rostland", level: 1 }, GB: { id: "GB", label: "Greenbelt", level: 2 }, NM: { id: "NM", label: "Narlmarches", level: 5 } },
    HEXES: { "1.1": { zone: "RL" }, "1.2": { zone: "RL" }, "1.3": { zone: "GB" }, "2.1": { zone: "NM" }, "1.4": { zone: "GB" }, "1.5": { zone: "GB" } }
  },
  state: { hexes },
  region: { hexes: { get: (n) => ({ key: n, center: { x: 1, y: 1 }, getNeighbors: () => (neighborsMap[n] ?? []).map((k) => ({ key: k })) }) }, scene: null }
};
export const env = { settings, flags, messages, kingdom, party, hexes, advance: (days) => (worldTime += days * 86400), get time() { return worldTime; } };
globalThis.CONFIG ??= { JournalEntry: { sheetClasses: { base: { "pf2e-kingmaker.KingmakerJournalSheet": {} } } } };
