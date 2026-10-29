/*
 * A campaign from level 1 to 20 on the real module code, with real dice.
 *   node sim-campaign.mjs [seed] [daysPerLevel] [engagement]
 * daysPerLevel: in-game days the party spends on each level (default 90: 3 sessions of ~30 days).
 * engagement: "daily" (players act every in-game day the GM runs) or "weekly".
 * Prints one JSON line per level, then a summary.
 */
import { env } from "./setup.mjs";
const R = process.env.UKM_SCRIPTS ?? "/home/claude/ukm-repo/scripts";

const SEED = Number(process.argv[2] ?? 1);
const DAYS_PER_LEVEL = Number(process.argv[3] ?? 90);
const ENGAGEMENT = process.argv[4] ?? "daily";
const QUIET = !!process.env.QUIET;

// ---------- seeded dice ----------
let seed = SEED * 9301 + 49297;
const rand = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
Math.random = rand;
const d = (n) => 1 + Math.floor(rand() * n);
class Roll {
  constructor(formula) { this.formula = String(formula); }
  static validate() { return true; }
  async evaluate() {
    let total = 0;
    let first = null;
    const f = this.formula.replace(/\s+/g, "");
    for (const term of f.match(/[+-]?[^+-]+/g) ?? []) {
      const sign = term.startsWith("-") ? -1 : 1;
      const t = term.replace(/^[+-]/, "");
      const m = t.match(/^(\d*)d(\d+)$/);
      if (m) {
        let sum = 0;
        for (let i = 0; i < Number(m[1] || 1); i++) sum += d(Number(m[2]));
        if (first === null) first = sum;
        total += sign * sum;
      } else total += sign * Number(t);
    }
    this.total = total;
    this.dice = [{ total: first ?? total }];
    return this;
  }
}
globalThis.Roll = Roll;
globalThis.__ukmTestDegree = undefined;
globalThis.__setDegree = () => {};
globalThis.ui.notifications = { info() {}, warn() {}, error() {} };
const realLog = console.log;
console.warn = () => {};

// ---------- the party ----------
// Proficiency: trained 2, expert 4, master 6, legendary 8 (+ level when trained or better). Item bonuses +1 at 3, +2 at 9, +3 at 17.
const PROF = { U: 0, T: 2, E: 4, M: 6, L: 8 };
const NEXT = { T: "E", E: "M", M: "L" };
const MIN_LEVEL = { E: 2, M: 7, L: 15 };
const itemBonus = (lvl) => (lvl >= 17 ? 3 : lvl >= 9 ? 2 : lvl >= 3 ? 1 : 0);
// Ability modifiers by level: key ability +4, +5 at 10, +6 at 17 (apex); a good secondary +2/+3 rising with boosts; weak ones stay low.
const ability = (start, lvl) => {
  let m = start;
  for (const at of [5, 10, 15, 20]) if (lvl >= at) m += m >= 4 ? 0.5 : 1;
  if (start >= 4 && lvl >= 17) m += 1;
  return Math.floor(m);
};
// A balanced four: fighter, wizard, cleric, rogue. Trained skills and the order they're raised in.
const CLASSES = {
  fighter: {
    name: "Valeros (fighter)", seat: "general", increases: "odd",
    abilities: { str: 4, dex: 2, con: 2, wis: 1, int: 0, cha: 0 },
    trained: { athletics: "str", intimidation: "cha", survival: "wis", "warfare-lore": "int", crafting: "int" },
    order: ["athletics", "intimidation", "warfare-lore", "survival", "athletics", "intimidation", "athletics"]
  },
  wizard: {
    name: "Ezren (wizard)", seat: "magister", increases: "odd",
    abilities: { int: 4, dex: 2, con: 1, wis: 1, str: 0, cha: 0 },
    trained: { arcana: "int", society: "int", crafting: "int", occultism: "int", diplomacy: "cha", "engineering-lore": "int" },
    order: ["arcana", "society", "crafting", "arcana", "occultism", "society", "arcana", "crafting"]
  },
  cleric: {
    name: "Kyra (cleric)", seat: "counselor", increases: "odd",
    abilities: { wis: 4, cha: 2, con: 2, str: 1, int: 0, dex: 0 },
    trained: { religion: "wis", medicine: "wis", diplomacy: "cha", nature: "wis", society: "int", survival: "wis" },
    order: ["religion", "medicine", "diplomacy", "religion", "nature", "medicine", "religion", "diplomacy"]
  },
  rogue: {
    name: "Merisiel (rogue)", seat: "emissary", increases: "every",
    abilities: { dex: 4, cha: 2, int: 1, con: 1, wis: 1, str: 0 },
    trained: { thievery: "dex", stealth: "dex", deception: "cha", diplomacy: "cha", acrobatics: "dex", society: "int", intimidation: "cha", "mercantile-lore": "int", athletics: "str" },
    order: ["thievery", "stealth", "deception", "diplomacy", "acrobatics", "society", "thievery", "stealth", "deception", "diplomacy", "intimidation", "thievery"]
  },
  investigator: {
    name: "Quinn (investigator)", increases: "every",
    abilities: { int: 4, dex: 2, wis: 2, cha: 1, con: 1, str: 0 },
    trained: { society: "int", arcana: "int", crafting: "int", diplomacy: "cha", deception: "cha", medicine: "wis", occultism: "int", thievery: "dex", nature: "wis", "mercantile-lore": "int", "engineering-lore": "int" },
    order: ["society", "diplomacy", "arcana", "crafting", "occultism", "medicine", "society", "deception", "nature", "arcana", "diplomacy", "crafting"]
  },
  bard: {
    name: "Lem (bard)", increases: "odd",
    abilities: { cha: 4, dex: 2, int: 1, wis: 1, con: 1, str: 0 },
    trained: { performance: "cha", occultism: "int", diplomacy: "cha", deception: "cha", intimidation: "cha", society: "int", arcana: "int", "farming-lore": "int" },
    order: ["performance", "diplomacy", "occultism", "deception", "performance", "intimidation", "diplomacy", "society"]
  },
  ranger: {
    name: "Harsk (ranger)", increases: "odd",
    abilities: { dex: 4, wis: 2, con: 2, str: 1, int: 1, cha: 0 },
    trained: { survival: "wis", nature: "wis", athletics: "str", stealth: "dex", crafting: "int", "sailing-lore": "int" },
    order: ["survival", "nature", "athletics", "stealth", "survival", "nature", "crafting"]
  },
  swashbuckler: {
    name: "Jirelle (swashbuckler)", increases: "odd",
    abilities: { dex: 4, cha: 2, con: 1, str: 1, wis: 1, int: 0 },
    trained: { acrobatics: "dex", diplomacy: "cha", deception: "cha", intimidation: "cha", athletics: "str", performance: "cha", "sailing-lore": "int" },
    order: ["acrobatics", "diplomacy", "deception", "intimidation", "performance", "athletics", "diplomacy"]
  },
  barbarian: {
    name: "Amiri-like (barbarian)", increases: "odd",
    abilities: { str: 4, con: 2, dex: 1, wis: 1, int: -1, cha: 0 },
    trained: { athletics: "str", intimidation: "cha", survival: "wis" },
    order: ["athletics", "intimidation", "athletics", "survival", "athletics"]
  },
  champion: {
    name: "Seelah (champion)", increases: "odd",
    abilities: { str: 4, cha: 2, con: 2, wis: 1, int: 0, dex: 0 },
    trained: { religion: "wis", athletics: "str", diplomacy: "cha" },
    order: ["athletics", "religion", "diplomacy", "athletics", "religion"]
  },
  monk: {
    name: "Sajan (monk)", increases: "odd",
    abilities: { dex: 4, wis: 2, con: 2, str: 1, int: 0, cha: 0 },
    trained: { acrobatics: "dex", athletics: "str", stealth: "dex" },
    order: ["acrobatics", "athletics", "acrobatics", "stealth"]
  }
};
const ALL_SKILLS = ["acrobatics", "arcana", "athletics", "crafting", "deception", "diplomacy", "intimidation", "medicine", "nature", "occultism", "performance", "religion", "society", "stealth", "survival", "thievery", "farming-lore", "sailing-lore", "engineering-lore", "mercantile-lore", "warfare-lore"];
const SKILL_ABILITY = { acrobatics: "dex", arcana: "int", athletics: "str", crafting: "int", deception: "cha", diplomacy: "cha", intimidation: "cha", medicine: "wis", nature: "wis", occultism: "int", performance: "cha", religion: "wis", society: "int", stealth: "dex", survival: "wis", thievery: "dex" };

const { stackModifiers } = await import(`${R}/realm/kingdom.js`);
const { LEVEL_DC } = await import(`${R}/constants.js`);
const degreeOf = (total, dc, natural) => {
  let deg = total >= dc + 10 ? 3 : total >= dc ? 2 : total <= dc - 10 ? 0 : 1;
  if (natural === 20) deg = Math.min(3, deg + 1);
  if (natural === 1) deg = Math.max(0, deg - 1);
  return deg;
};
function makePc(key) {
  const c = CLASSES[key];
  const ranks = Object.fromEntries(Object.keys(c.trained).map((s) => [s, "T"]));
  const pc = { uuid: `Actor.${key}`, id: key, name: c.name, type: "character", level: 1, isOwner: true, hasPlayerOwner: true, testUserPermission: () => true, ranks, skills: {} };
  pc.raise = () => {
    const lvl = pc.level;
    const gets = c.increases === "every" ? lvl >= 2 : lvl >= 3 && lvl % 2 === 1;
    if (!gets) return;
    for (const s of c.order) {
      const next = NEXT[ranks[s]];
      if (next && lvl >= MIN_LEVEL[next]) { ranks[s] = next; return; }
    }
  };
  pc.refresh = () => {
    for (const s of ALL_SKILLS) {
      const ab = c.trained[s] ?? SKILL_ABILITY[s] ?? "int";
      const abMod = ability(c.abilities[ab] ?? 0, pc.level);
      const rank = ranks[s] ?? "U";
      const mod = abMod + (rank === "U" ? 0 : PROF[rank] + pc.level) + (rank === "U" ? 0 : itemBonus(pc.level));
      pc.skills[s] = {
        mod, rank, label: s,
        roll: async ({ dc, modifiers = [] }) => {
          const extra = stackModifiers((modifiers ?? []).map((m) => ({ slug: m.slug, modifier: m.modifier, type: m.type })));
          const nat = d(20);
          const total = nat + mod + extra;
          return { degreeOfSuccess: degreeOf(total, dc?.value ?? dc, nat), total };
        }
      };
    }
  };
  pc.refresh();
  return pc;
}
const PARTIES = {
  average: ["fighter", "wizard", "cleric", "rogue"],
  skilled6: ["rogue", "investigator", "bard", "ranger", "swashbuckler", "wizard"],
  poor: ["barbarian", "fighter", "champion", "monk"]
};
const PARTY = process.env.PARTY ?? "average";
const party = PARTIES[PARTY].map(makePc);
const byUuid = new Map(party.map((p) => [p.uuid, p]));
globalThis.fromUuidSync = (u) => byUuid.get(u) ?? (u?.startsWith?.("Actor.") ? { name: u.slice(6), type: "npc", testUserPermission: () => false } : null);
env.party.members = party;
env.party.level = 1;
game.actors.contents = party;
game.actors.filter = (fn) => party.filter(fn);
game.actors.find = (fn) => party.find(fn);

// ---------- the Stolen Lands: a grid of hexes, zones by distance, some commodities ----------
const W = 22;
const H = 16;
const hexes = {};
const HEXES = {};
const ZONES = { NA: { id: "NA", label: "None", level: 0 } };
const neighborsOf = (k) => {
  const i = Math.floor(k / 1000);
  const j = k % 1000;
  return [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]].map(([a, b]) => (i + a) * 1000 + (j + b)).filter((n) => Math.floor(n / 1000) >= 1 && Math.floor(n / 1000) <= W && n % 1000 >= 1 && n % 1000 <= H);
};
const start = 3 * 1000 + 8;
const commodities = ["lumber", "lumber", "stone", "ore", "luxuries"];
for (let i = 1; i <= W; i++) for (let j = 1; j <= H; j++) {
  const key = i * 1000 + j;
  const dist = Math.abs(i - 3) + Math.abs(j - 8);
  const level = Math.min(20, 1 + Math.floor(dist / 1.6));
  const zoneId = `Z${level}`;
  ZONES[zoneId] ??= { id: zoneId, label: `Zone ${level}`, level, terrain: ["plains", "forest", "hills", "swamp", "mountains"][level % 5] };
  HEXES[`${i}.${j}`] = { zone: zoneId, terrain: ZONES[zoneId].terrain };
  hexes[key] = rand() < 0.3 ? { commodity: commodities[Math.floor(rand() * commodities.length)] } : {};
}
hexes[start].claimed = true;
globalThis.kingmaker = {
  CONST: { ZONES, HEXES },
  state: { hexes },
  region: { hexes: { get: (n) => ({ key: n, center: { x: 1, y: 1 }, getNeighbors: () => neighborsOf(n).map((k) => ({ key: k })) }) }, scene: null }
};
env.hexes; // (setup's small region is replaced)

// ---------- the module ----------
const { preloadData, getMatters } = await import(`${R}/content/data.js`);
await preloadData();
// Seats go to whoever is best at them (judged at level 5); seats left over go to companions.
const { SEATS: ALL_SEATS, REALM_STATS: STATS, PERSONAL_SKILLS: PS } = await import(`${R}/constants.js`);
const seatScore = (pc, seat) => {
  const stat = Object.values(STATS).find((d) => d.seat === seat);
  pc.level = 5; pc.refresh();
  const v = Math.max(...stat.skills.flatMap((k) => (PS[k] ?? []).map((ps) => (pc.skills[ps]?.rank !== "U" ? pc.skills[ps]?.mod ?? -9 : -9))));
  pc.level = 1; pc.refresh();
  return v;
};
const seatOf = {};
const pairs = party.flatMap((pc) => ALL_SEATS.map((seat) => ({ pc, seat, score: seatScore(pc, seat) }))).sort((a, b) => b.score - a.score);
for (const { pc, seat } of pairs) if (!Object.values(seatOf).includes(seat) && !seatOf[pc.id]) seatOf[pc.id] = seat;
const COMPANION = { treasurer: "jubilost", viceroy: "svetlana", counselor: "linzi", magister: "octavia", emissary: "valerie", general: "amiri" };
const assignments = {};
for (const seat of ALL_SEATS) if (!Object.values(seatOf).includes(seat)) assignments[seat] = { companion: COMPANION[seat], supervisor: party[0].uuid };
realLog("PARTY", PARTY, JSON.stringify(seatOf), "companions", Object.keys(assignments).join(","));
for (const [k, v] of Object.entries({ seatAssignments: assignments, knownAdvisors: Object.fromEntries(Object.values(COMPANION).map((c) => [c, true])), companionAttitudes: Object.fromEntries(Object.values(COMPANION).map((c) => [c, "friendly"])), levelGravity: 1, costGradient: {}, clock: {}, audiences: true, council: false, deskMatters: true, pinResolved: "remove", tapTreasury: "disabled", pinsShown: false })) env.settings.set(k, v);
const realmKey = "ultimate-kingdom-manager-next.realm";
env.flags[realmKey] = {
  kingdom: {
    active: true, name: "Simland", img: null, level: 1, capital: null, ruler: party[0].uuid,
    unrest: { value: 0 }, resources: { fame: { value: 0, max: 3 } },
    abilities: { culture: { ruin: { value: 0, max: 10 }, penalty: 0 }, economy: { ruin: { value: 0, max: 10 }, penalty: 0 }, stability: { ruin: { value: 0, max: 10 }, penalty: 0 }, loyalty: { ruin: { value: 0, max: 10 }, penalty: 0 } },
    leadership: Object.fromEntries(party.map((p) => [seatOf[p.id], { uuid: p.uuid }])),
    size: 1
  },
  seatsVersion: 6
};
const { getRealm, updateRealm } = await import(`${R}/realm/state.js`);
const { tick } = await import(`${R}/realm/clock.js`);
const RS = await import(`${R}/realm/resolve.js`);
const RK = await import(`${R}/realm/ranks.js`);
const P = await import(`${R}/realm/projects.js`);
const A = await import(`${R}/realm/audiences.js`);
const S = await import(`${R}/realm/settlements.js`);
const T = await import(`${R}/realm/tracks.js`);
const RY = await import(`${R}/realm/royal.js`);
const F = await import(`${R}/realm/flat.js`);
const C = await import(`${R}/constants.js`);
const { getKingdom, syncKingdomLevel } = await import(`${R}/integrations/party.js`);
const { weeklyIncome, rankCap } = await import(`${R}/realm/rules.js`);
const { getTracks } = await import(`${R}/content/data.js`);

await RK.applyFounding(["economy", "community"]);
await S.foundCapital({ name: "Capital", mapHex: null, userId: "gm" });
hexes[start].features = [{ type: "village", name: "Capital" }];
await updateRealm((r) => { const s = r.settlements[0]; s.hexKey = String(start); r.treasury = 10; });
await tick();

// ---------- the GM marks finished projects on the map ----------
let lastRecord = {};
const claimed = () => Object.entries(hexes).filter(([, h]) => h.claimed).map(([k]) => Number(k));
function gmMarksMap() {
  const rec = getRealm().projectRecord ?? {};
  for (const [type, n] of Object.entries(rec)) {
    for (let i = lastRecord[type] ?? 0; i < n; i++) {
      const mine = claimed();
      const isSettled = (k) => (hexes[k].features ?? []).some((f) => ["village", "town", "city", "metropolis"].includes(f.type));
      if (type === "claim-hex") {
        const frontier = [...new Set(mine.flatMap(neighborsOf))].filter((k) => !hexes[k].claimed);
        frontier.sort(() => rand() - 0.5);
        if (frontier[0]) hexes[frontier[0]].claimed = true;
      } else if (type === "establish-farmland") {
        const k = mine.find((h) => !(hexes[h].features ?? []).some((f) => f.type === "farmland") && !isSettled(h) && !hexes[h].camp);
        if (k) (hexes[k].features ??= []).push({ type: "farmland" });
      } else if (type === "build-road") {
        const k = mine.find((h) => !(hexes[h].features ?? []).some((f) => f.type === "road"));
        if (k) (hexes[k].features ??= []).push({ type: "road" });
      } else if (type === "establish-work-site") {
        const want = { lumber: "lumber", stone: "quarry", ore: "mine" };
        const k = mine.find((h) => want[hexes[h].commodity] && !hexes[h].camp);
        if (k) hexes[k].camp = want[hexes[k].commodity];
      } else if (type === "found-settlement") {
        const realm = getRealm();
        const onMap = new Set(Object.values(hexes).flatMap((h) => (h.features ?? []).map((f) => f.name)).filter(Boolean));
        const s = realm.settlements.find((x) => !onMap.has(x.name));
        const k = mine.find((h) => !isSettled(h) && !(hexes[h].features ?? []).some((f) => f.type === "farmland"));
        if (s && k) (hexes[k].features ??= []).push({ type: "village", name: s.name });
      }
    }
  }
  lastRecord = { ...rec };
}

// ---------- the players ----------
const stats = { resolved: 0, success: 0, crit: 0, fail: 0, critFail: 0, expired: 0, trouble: 0, personal: 0, advisor: 0, fameRerolls: 0, decrees: 0, projectsStarted: {}, tracksBuilt: 0, bpOnTracks: 0, bpOnProjects: 0, bpOnRankUps: 0, anarchyDays: 0, maxUnrest: 0 };
const DEGREE = { criticalSuccess: 3, success: 2, failure: 1, criticalFailure: 0 };
const ACTIVE = ["open", "assigned", "rolled", "escalated"];

function bestOptions(card) {
  const realm = getRealm();
  const { skills, event } = RS.cardStage(card);
  const opts = [];
  for (const skill of skills) {
    const a = RS.estimateCheck(card, { type: "advisor", skill }, realm);
    if (a) opts.push({ type: "advisor", skill, chance: a.chance });
    if (event?.advisorOnly) continue;
    for (const pc of party) for (const ps of C.PERSONAL_SKILLS[skill] ?? []) {
      if (!pc.skills[ps] || pc.skills[ps].rank === "U") continue;
      const e = RS.estimateCheck(card, { type: "pc", actorUuid: pc.uuid, personalSkill: ps, skill }, realm);
      if (!e) continue;
      // Players prefer their own desks; borrowing someone costs a little in their minds.
      const own = RS.seatsOf(pc.uuid).includes(card.seat);
      opts.push({ type: "pc", actorUuid: pc.uuid, personalSkill: ps, skill, chance: e.chance - (own ? 0 : 0.15) });
    }
  }
  return opts.sort((a, b) => b.chance - a.chance);
}

async function handleCards() {
  for (const card of getRealm().cards.filter((c) => c.status === "open" && !RS.isResting(c))) {
    if (card.kind === "audience") {
      const { responses } = A.audienceResponses(card);
      const pick = responses[Math.floor(rand() * responses.length)];
      await A.answerAudience({ cardId: card.id, response: pick.id, userId: "gm" });
      continue;
    }
    for (const opt of bestOptions(card)) {
      const r = await RS.assignCard({ cardId: card.id, userId: "gm", ...opt });
      if (r?.ok) { stats[opt.type === "pc" ? "personal" : "advisor"]++; break; }
    }
  }
  for (const card of getRealm().cards.filter((c) => c.status === "rolled" && c.pendingRoll)) {
    const pr = card.pendingRoll;
    const bad = pr.degree <= 1 && card.kind !== "opportunity";
    if (bad && !pr.decreeUsed && RY.usesLeft("decree") > 0) {
      const r = await RS.useRoyalDecree({ cardId: card.id, userId: "gm" });
      if (r?.ok) stats.decrees++;
    }
    const again = getRealm().cards.find((c) => c.id === card.id);
    if (again?.pendingRoll && again.pendingRoll.degree <= 1 && card.kind !== "opportunity" && getKingdom().resources.fame.value > 0 && !again.pendingRoll.fameUsed && !again.pendingRoll.fortuneUsed) {
      const r = await RS.useFame({ cardId: card.id, userId: "gm" });
      if (r?.ok) stats.fameRerolls++;
    }
    const now = getRealm().cards.find((c) => c.id === card.id);
    if (now?.status === "rolled") await RS.acceptRoll(card.id);
  }
}

const pending = { flats: new Set() };
async function rollFlats() {
  for (const flat of getRealm().pendingFlats ?? []) {
    if (pending.flats.has(flat.id)) continue;
    pending.flats.add(flat.id);
    await F.resolveFlat({ id: flat.id, total: d(20) });
  }
}

const reserve = () => Math.max(4, weeklyIncome(getRealm()).base * 1.5);
async function spend() {
  const realm = getRealm();
  const level = getKingdom().level;
  // Rank-ups first: they're what makes the kingdom better at everything.
  for (const stat of Object.keys(C.REALM_STATS)) {
    const proj = RK.rankUpProject(getRealm(), stat);
    if (proj?.status === "choosing") {
      const opts = RK.rankUpChoices(proj).options;
      await RK.chooseRankUp({ projectId: proj.id, option: opts[Math.floor(rand() * opts.length)].id, userId: "gm" });
    } else if (!proj && getRealm().treasury >= RK.rankUpCost(getRealm())) {
      const before = getRealm().treasury;
      const r = await RK.startRankUp({ stat, userId: "gm" });
      if (r?.ok) stats.bpOnRankUps += before - getRealm().treasury;
    }
  }
  const tryProject = async (type, extra = {}) => {
    const before = getRealm().treasury;
    const r = await P.startProject({ type, userId: "gm", where: "", ...extra }, { canActForSeat: RS.canActForSeat });
    if (r?.ok) { stats.projectsStarted[type] = (stats.projectsStarted[type] ?? 0) + 1; stats.bpOnProjects += before - getRealm().treasury; }
    return r?.ok;
  };
  const working = (type) => getRealm().cards.some((c) => c.project?.type === type && ACTIVE.includes(c.status));
  // Food first: a farm whenever the settlements need more than the farms give.
  const income = weeklyIncome(getRealm());
  const need = getKingdom().consumption.value;
  const farms = claimed().filter((k) => (hexes[k].features ?? []).some((f) => f.type === "farmland")).length;
  if (farms < need && !working("establish-farmland") && getRealm().treasury > reserve()) await tryProject("establish-farmland");
  // Grow the realm: claim a hex now and then (the AP's kingdoms grow to dozens of hexes).
  const targetSize = Math.round(1 + level * 4.5);
  if (claimed().length < targetSize && !working("claim-hex") && getRealm().treasury > reserve()) await tryProject("claim-hex");
  // Work sites on commodity hexes.
  const idle = claimed().filter((k) => ["lumber", "stone", "ore"].includes(hexes[k].commodity) && !hexes[k].camp).length;
  if (idle && !working("establish-work-site") && getRealm().treasury > reserve()) await tryProject("establish-work-site", { camp: "lumber" });
  if (claimed().length > 3 && !working("build-road") && rand() < 0.1 && getRealm().treasury > reserve() * 2) await tryProject("build-road");
  // A new settlement every few levels.
  const wantSettlements = 1 + Math.floor(level / 4);
  if (getRealm().settlements.length < wantSettlements && !working("found-settlement") && getRealm().treasury > reserve()) {
    await tryProject("found-settlement", { settlementName: `Town ${getRealm().settlements.length + 1}`, waterside: rand() < 0.4 });
  }
  // Settlement tracks: missing needs first, then Homes, then whatever helps most, cheapest first.
  // Sensible players keep hands free for what lands on the desks: no more than two stages at once,
  // and none while a card is waiting for someone.
  const building = getRealm().cards.filter((c) => c.project?.track && ACTIVE.includes(c.status)).length;
  const waiting = getRealm().cards.some((c) => c.status === "open" && !RS.isResting(c) && c.kind !== "project" && c.kind !== "audience");
  const maxBuilds = Number(process.env.MAXBUILDS ?? 2);
  if (waiting || building >= maxBuilds) return;
  const all = getRealm().settlements;
  const wants = [];
  for (const s of all) {
    const missing = new Set(T.missingNeeds(s).map((m) => m.trackId));
    for (const track of getTracks()) {
      const q = P.developmentQuote(s.id, track.id);
      if (q.blocked) continue;
      const priority = (missing.has(track.id) ? 0 : track.id === "homes" ? 1 : ["food", "commerce", "faith", "watch", "industry"].includes(track.id) ? 2 : 3) + (s.capital ? 0 : 0.5);
      wants.push({ s, track, q, priority });
    }
  }
  wants.sort((a, b) => a.priority - b.priority || a.q.cost - b.q.cost);
  for (const w of wants.slice(0, maxBuilds - building)) {
    if (getRealm().treasury - w.q.cost < reserve()) continue;
    const before = getRealm().treasury;
    const r = await P.startProject({ type: "develop-settlement", settlementId: w.s.id, track: w.track.id, userId: "gm" }, { canActForSeat: RS.canActForSeat });
    if (r?.ok) { stats.bpOnTracks += before - getRealm().treasury; stats.projectsStarted["develop-settlement"] = (stats.projectsStarted["develop-settlement"] ?? 0) + 1; }
  }
  // Quell Unrest when it's climbing.
  if (getKingdom().unrest.value >= 2 && !working("quell-unrest")) await tryProject("quell-unrest");
  // The ruler holds court when the people grumble.
  if (getKingdom().unrest.value > 0 && RY.usesLeft("court") > 0) await RY.royalCourt({ userId: "gm" });
  for (const f of RY.favours()) if (getKingdom().unrest.value > 1 || rand() < 0.2) await RY.useFavour({ favourId: f.id, userId: "gm" });
}

// ---------- the campaign ----------
const levelLines = [];
let resolvedSeen = new Set();
const degrees = [0, 0, 0, 0];
function countResults() {
  for (const c of getRealm().cards) {
    if (resolvedSeen.has(c.id)) continue;
    if (c.status === "resolved") {
      resolvedSeen.add(c.id);
      stats.resolved++;
      const deg = DEGREE[c.outcome ?? c.lastOutcome];
      if (deg !== undefined) degrees[deg]++;
      if (c.trouble) stats.trouble++;
    } else if (c.status === "expired") { resolvedSeen.add(c.id); stats.expired++; if (c.trouble) stats.trouble++; }
  }
}
const degreeCount = { 0: 0, 1: 0, 2: 0, 3: 0 };
const origAccept = RS.acceptRoll;

let day = 0;
const T0 = Date.now();
const MAX_LEVEL = Number(process.env.MAXLEVEL ?? 20);
for (let level = 1; level <= MAX_LEVEL; level++) {
  for (const pc of party) { pc.level = level; if (level > 1) pc.raise(); pc.refresh(); }
  env.party.level = level;
  await syncKingdomLevel();
  for (let i = 0; i < DAYS_PER_LEVEL; i++) {
    day++;
    if (process.env.TRACE && day % 10 === 0) realLog("day", day, Date.now() - T0);
    env.advance(1);
    try {
      const u0 = getKingdom().unrest.value;
      await tick();
      if (ENGAGEMENT === "daily" || day % 7 === 0) {
        await handleCards();
        await spend();
        await rollFlats();
      }
      gmMarksMap();
      countResults();
      const du = getKingdom().unrest.value - u0;
      if (process.env.UTRACE && du !== 0 && level >= Number(process.env.UTRACE)) {
        realLog("U", level, day, u0, "->", getKingdom().unrest.value, JSON.stringify(getRealm().log.filter((e) => e.time >= game.time.worldTime - 86400).map((e) => `${e.type}:${e.text ?? ""}${e.amount ?? ""}`)));
      }
      const u = getKingdom().unrest.value;
      stats.maxUnrest = Math.max(stats.maxUnrest, u);
      if (u >= 20) stats.anarchyDays++;
    } catch (e) {
      realLog("ERROR level", level, "day", day, e.stack.split("\n").slice(0, 4).join(" | "));
    }
  }
  const realm = getRealm();
  const k = getKingdom();
  const cap = rankCap(level);
  const ranks = Object.fromEntries(Object.entries(realm.stats).map(([s, v]) => [s, v.rank]));
  const inc = weeklyIncome(realm);
  const line = {
    level,
    years: +(day / 365).toFixed(1),
    cap,
    ranks: Object.values(ranks).join("/"),
    treasury: Math.round(realm.treasury),
    income: +inc.total.toFixed(1),
    inc: [inc.base, inc.worksites, inc.ranks, inc.trade, inc.tracks].map((n) => +n.toFixed(1)).join("/"),
    pinnacles: realm.settlements.reduce((n, s) => n + (s.pinnacles?.length ?? 0), 0),
    unrest: k.unrest.value,
    ruin: Object.values(k.abilities).map((a) => `${a.ruin.value}${a.penalty ? `(${a.penalty})` : ""}`).join(" "),
    fame: k.resources.fame.value,
    hexes: claimed().length,
    farms: claimed().filter((h) => (hexes[h].features ?? []).some((f) => f.type === "farmland")).length,
    camps: claimed().filter((h) => hexes[h].camp).length,
    food: k.consumption.value,
    settlements: realm.settlements.map((s) => `${s.name}:${s.type[0]}${Object.values(s.tracks ?? {}).reduce((a, b) => a + Math.max(0, b + 1), 0)}`).join(" "),
    open: realm.cards.filter((c) => ACTIVE.includes(c.status)).length,
    trouble: stats.trouble,
    expired: stats.expired
  };
  levelLines.push(line);
  if (!QUIET) realLog(JSON.stringify(line));
}
const final = levelLines.at(-1);
realLog("SUMMARY", JSON.stringify({ degrees, seed: SEED, daysPerLevel: DAYS_PER_LEVEL, engagement: ENGAGEMENT, resolved: stats.resolved, expired: stats.expired, trouble: stats.trouble, personal: stats.personal, advisor: stats.advisor, fameRerolls: stats.fameRerolls, decrees: stats.decrees, maxUnrest: stats.maxUnrest, anarchyDays: stats.anarchyDays, bp: { rankUps: Math.round(stats.bpOnRankUps), projects: Math.round(stats.bpOnProjects), tracks: Math.round(stats.bpOnTracks) }, projects: stats.projectsStarted, final }));
