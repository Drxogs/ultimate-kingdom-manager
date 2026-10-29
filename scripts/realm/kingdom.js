import { LEVEL_DC, MODULE_ID, SKILL_TO_STAT } from "../constants.js";
import { chatClass, chatKicker } from "./chat-style.js";
import { isKingmakerActive, summarizeRealm } from "../integrations/kingmaker.js";
import { defaultKingdomData, getRealm, realmInFlight, updateRealm } from "./state.js";
import { settlementState } from "./settlements.js";
import { advisorProficiency, rankBonus } from "./rules.js";

/*
 * The kingdom's numbers, kept in our own realm data instead of the PF2e kingdom sheet.
 * It answers to the same names the rest of the module already uses (level, unrest.value,
 * abilities.*.ruin, resources.fame, skills[skill].roll and update), so the rest of the code
 * doesn't need to know where the numbers live.
 */

/** Which Ruin weighs on each kingdom skill (stored under the four old ability keys). */
export const SKILL_RUIN_ABILITY = {
  politics: "culture", intrigue: "culture", statecraft: "culture", arts: "culture", folklore: "culture",
  trade: "economy", industry: "economy", boating: "economy",
  agriculture: "stability", wilderness: "stability", exploration: "stability", magic: "stability", scholarship: "stability", engineering: "stability",
  warfare: "loyalty", defense: "loyalty"
};

export const KINGDOM_SKILLS = Object.keys(SKILL_RUIN_ABILITY);

/** How much a Ruin's threshold rises each time it tips over into a penalty. */
export const THRESHOLD_STEP = 2;

const SIZES = [
  { type: "territory", min: 0, dc: 0, die: 4 },
  { type: "province", min: 10, dc: 1, die: 6 },
  { type: "state", min: 25, dc: 2, die: 8 },
  { type: "country", min: 50, dc: 3, die: 10 },
  { type: "dominion", min: 100, dc: 4, die: 12 }
];

/** One number for a stat's rank, in place of PF2e's training (the table lives in rules.js). */
export const rankCheckBonus = (rank, level) => rankBonus(rank, level);

/** PF2e's Unrest penalty to every kingdom check. */
export function unrestPenalty(unrest) {
  if (unrest >= 15) return -4;
  if (unrest >= 10) return -3;
  if (unrest >= 5) return -2;
  if (unrest >= 1) return -1;
  return 0;
}

export function sizeInfo(size) {
  return [...SIZES].reverse().find((s) => size >= s.min) ?? SIZES[0];
}

/** Highest of each bonus type and lowest of each penalty type; untyped all add up. */
export function stackModifiers(list) {
  const best = {};
  let untyped = 0;
  for (const m of list) {
    if (m.enabled === false || m.ignored) continue;
    const value = Number(m.modifier) || 0;
    if (!m.type || m.type === "untyped") {
      untyped += value;
      continue;
    }
    const key = `${m.type}:${value >= 0 ? "bonus" : "penalty"}`;
    best[key] = value >= 0 ? Math.max(best[key] ?? 0, value) : Math.min(best[key] ?? 0, value);
  }
  return untyped + Object.values(best).reduce((a, b) => a + b, 0);
}

/** PF2e degrees: 10 over or under shifts a step, and a natural 20 or 1 shifts one more. */
export function degreeOf(total, dc, natural) {
  let degree = total >= dc + 10 ? 3 : total >= dc ? 2 : total <= dc - 10 ? 0 : 1;
  if (natural === 20) degree = Math.min(3, degree + 1);
  if (natural === 1) degree = Math.max(0, degree - 1);
  return degree;
}

const DEGREE_NAMES = ["criticalFailure", "failure", "success", "criticalSuccess"];

function flatten(changes, prefix = "", out = {}) {
  for (const [key, value] of Object.entries(changes ?? {})) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value) && !key.startsWith("-=")) flatten(value, path, out);
    else out[path] = value;
  }
  return out;
}

function setPath(target, path, value) {
  const parts = path.split(".");
  let node = target;
  while (parts.length > 1) {
    const part = parts.shift();
    if (node[part] === null || typeof node[part] !== "object") node[part] = {};
    node = node[part];
  }
  const last = parts[0];
  if (last.startsWith("-=")) delete node[last.slice(2)];
  else node[last] = value;
}

function getPath(target, path) {
  return path.split(".").reduce((node, part) => node?.[part], target);
}

/** Apply a PF2e-style update to our kingdom data. A Ruin penalty growing also raises that Ruin's threshold. */
export function applyKingdomUpdate(data, changes) {
  for (const [path, value] of Object.entries(flatten(changes))) {
    const ruinPenalty = /^abilities\.(\w+)\.penalty$/.exec(path);
    if (ruinPenalty) {
      const before = Number(getPath(data, path)) || 0;
      const steps = before - (Number(value) || 0);
      if (steps > 0) {
        const max = getPath(data, `abilities.${ruinPenalty[1]}.ruin.max`) ?? 10;
        setPath(data, `abilities.${ruinPenalty[1]}.ruin.max`, max + steps * THRESHOLD_STEP);
      }
    }
    setPath(data, path, value);
  }
  return data;
}


export class Kingdom {
  constructor(realm) {
    this.realm = realm;
    this.data = realm.kingdom ?? defaultKingdomData();
  }

  get type() {
    return "kingmaker";
  }
  get active() {
    return !!this.data.active;
  }
  get name() {
    return this.data.name ?? "";
  }
  get img() {
    return this.data.img ?? null;
  }
  get level() {
    return Math.clamp(Number(this.data.level) || 1, 1, 20);
  }
  get capital() {
    return this.data.capital ?? null;
  }
  get unrest() {
    return this.data.unrest ?? { value: 0 };
  }
  get abilities() {
    return this.data.abilities ?? defaultKingdomData().abilities;
  }
  get leadership() {
    return this.data.leadership ?? {};
  }
  /** Kept for the few callers that still look; our settlements live in the realm. */
  get settlements() {
    return {};
  }
  get size() {
    if (isKingmakerActive()) return Math.max(1, summarizeRealm().size);
    return Math.max(1, Number(this.data.size) || 1);
  }
  get sizeInfo() {
    return sizeInfo(this.size);
  }
  get nationType() {
    return this.sizeInfo.type;
  }
  get control() {
    return { dc: { value: (LEVEL_DC[this.level] ?? 14) + this.sizeInfo.dc } };
  }
  get resources() {
    const fame = this.data.resources?.fame ?? { value: 0, max: 3 };
    return { fame, dice: { number: this.level + 4, faces: this.sizeInfo.die } };
  }
  /** Food the settlements need each week, after the reductions they build. */
  get consumption() {
    return { value: (this.realm.settlements ?? []).reduce((sum, s) => sum + (settlementState(s).consumption ?? 0), 0) };
  }
  get skills() {
    return Object.fromEntries(KINGDOM_SKILLS.map((skill) => [skill, this.statistic(skill)]));
  }

  /** The standing parts of a kingdom check for one skill. */
  baseModifiers(skill) {
    const stat = SKILL_TO_STAT[skill];
    const rank = this.realm.stats?.[stat]?.rank ?? 0;
    const statLabel = stat ? game.i18n.localize(`UKM.Stat.${stat}`) : "";
    const mods = [
      { slug: "ukm-level", label: game.i18n.localize("UKM.Check.Level"), modifier: this.level, type: "untyped" },
      { slug: `ukm-rank-${stat}`, label: game.i18n.format("UKM.Bonus.RankLabel", { stat: statLabel, prof: game.i18n.localize(`UKM.Proficiency.${advisorProficiency(rank).key}`) }), modifier: rankCheckBonus(rank, this.level), type: "untyped" }
    ];
    const unrest = unrestPenalty(this.unrest.value ?? 0);
    if (unrest) mods.push({ slug: "ukm-unrest", label: game.i18n.localize("UKM.Check.Unrest"), modifier: unrest, type: "status" });
    const ability = SKILL_RUIN_ABILITY[skill];
    const ruin = Number(this.abilities[ability]?.penalty) || 0;
    if (ruin) mods.push({ slug: `ukm-ruin-${ability}`, label: game.i18n.localize(`UKM.Ruin.${RUIN_BY_ABILITY[ability]}`), modifier: ruin, type: "item" });
    return mods;
  }

  statistic(skill) {
    const modifiers = this.baseModifiers(skill);
    const mod = stackModifiers(modifiers);
    const label = game.i18n.localize(`UKM.Skill.${skill}`);
    return {
      slug: skill,
      label,
      mod,
      check: { mod },
      modifiers,
      roll: (options = {}) => rollKingdomCheck(this, skill, options)
    };
  }

  async update(changes) {
    const live = realmInFlight();
    if (live) {
      live.kingdom ??= defaultKingdomData();
      applyKingdomUpdate(live.kingdom, changes);
      this.data = live.kingdom;
      return this;
    }
    const realm = await updateRealm((r) => {
      r.kingdom ??= defaultKingdomData();
      applyKingdomUpdate(r.kingdom, changes);
    });
    if (realm) {
      this.realm = realm;
      this.data = realm.kingdom;
    }
    Hooks.callAll(`${MODULE_ID}.kingdomUpdated`, changes);
    return this;
  }
}

const RUIN_BY_ABILITY = { culture: "corruption", economy: "crime", stability: "decay", loyalty: "strife" };

function esc(s) {
  return Handlebars.escapeExpression(s ?? "");
}

/** Roll a kingdom check in the open: d20 + our modifiers against the DC, posted to chat. */
export async function rollKingdomCheck(kingdom, skill, { dc, modifiers = [], label = "", card = null } = {}) {
  const base = kingdom.baseModifiers(skill);
  const extra = (modifiers ?? []).map((m) => ({ slug: m.slug, label: m.label, modifier: m.modifier, type: m.type, enabled: m.enabled, ignored: m.ignored }));
  const all = [...base, ...extra];
  const mod = stackModifiers(all);
  const target = Number(dc?.value ?? dc) || kingdom.control.dc.value;
  const roll = await new Roll(`1d20 + ${mod}`).evaluate();
  const natural = roll.dice?.[0]?.total ?? roll.total - mod;
  const total = roll.total;
  // The test harness can force a degree; nothing in Foundry sets this.
  const degree = Number.isInteger(globalThis.__ukmTestDegree) ? globalThis.__ukmTestDegree : degreeOf(total, target, natural);
  const sign = (n) => (n >= 0 ? `+${n}` : `${n}`);
  const tags = all
    .filter((m) => m.enabled !== false && !m.ignored && m.modifier)
    .map((m) => `<span class="ukm-tag">${esc(m.label)} ${sign(m.modifier)}</span>`)
    .join(" ");
  const skillLabel = game.i18n.localize(`UKM.Skill.${skill}`);
  const flavor = `<div class="ukm-chat ukm-check${chatClass(card)}">
    ${chatKicker(card)}<h3>${esc(label || skillLabel)}</h3>
    <p class="ukm-check-skill">${esc(game.i18n.format("UKM.Check.Line", { skill: skillLabel, dc: target }))}</p>
    <p class="ukm-check-mods">${tags}</p>
    <p class="ukm-check-result degree-${DEGREE_NAMES[degree]}"><strong>${esc(game.i18n.localize(`UKM.Degree.${DEGREE_NAMES[degree]}`))}</strong></p>
  </div>`;
  const speaker = { alias: kingdom.name || game.i18n.localize("UKM.Manager.Unnamed") };
  if (typeof roll.toMessage === "function") await roll.toMessage({ flavor, speaker });
  else await ChatMessage.create({ content: flavor, speaker });
  return { total, degreeOfSuccess: degree, natural, dc: target, mod };
}

/** The kingdom, read from the realm being changed right now if there is one. */
export function currentKingdom() {
  return new Kingdom(realmInFlight() ?? getRealm());
}
