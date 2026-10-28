import { KINGDOM_SKILLS, selectorReaches } from "../constants.js";
import { getKingdom } from "../integrations/party.js";
import { getRealm } from "./state.js";

const ALL_SKILLS = KINGDOM_SKILLS;

/** The kingdom skills a modifier's selector reaches: an attribute, a skill, or every event check. */
export function skillsFor(selector) {
  return ALL_SKILLS.filter((skill) => selectorReaches(selector, skill));
}

/** The best status bonus a skill already gets: from the kingdom sheet or a timed bonus. */
export function currentStatus(skill, realm = getRealm()) {
  const statistic = getKingdom()?.skills?.[skill];
  const fromSheet = (statistic?.modifiers ?? [])
    .filter((m) => m.type === "status" && m.enabled !== false && !m.ignored && m.modifier > 0)
    .reduce((best, m) => Math.max(best, m.modifier), 0);
  const now = game.time.worldTime;
  const fromRealm = (realm.timedModifiers ?? [])
    .filter((m) => m.type === "status" && m.value > 0 && m.expires > now && skillsFor(m.selector).includes(skill))
    .reduce((best, m) => Math.max(best, m.value), 0);
  return Math.max(fromSheet, fromRealm);
}

/**
 * What a status bonus would actually add right now. Bonuses of the same type
 * don't stack, so a +2 on top of an existing +2 adds nothing.
 */
export function statusGain(modifier, realm = getRealm()) {
  if (modifier?.type !== "status" || !(modifier.value > 0)) return null;
  const skills = skillsFor(modifier.selector);
  if (!skills.length) return null;
  const existing = skills.map((s) => currentStatus(s, realm));
  const gains = existing.map((e) => Math.max(0, modifier.value - e));
  return { best: Math.max(...gains), worst: Math.min(...gains), existing: Math.max(...existing), skills };
}

/** A short warning for a choice whose status bonus would add little or nothing. */
export function statusNote(effects, realm = getRealm()) {
  for (const effect of effects ?? []) {
    const gain = statusGain(effect.modifier, realm);
    if (!gain || gain.best >= effect.modifier.value) continue;
    if (gain.best === 0) return game.i18n.format("UKM.Bonus.Wasted", { existing: gain.existing });
    return game.i18n.format("UKM.Bonus.Partial", { gain: gain.best, existing: gain.existing });
  }
  return null;
}

/**
 * Swap a status bonus that would add nothing for something that does: a
 * reroll on the same checks, twice, for the same length of time.
 */
export function convertWasted(effects, realm = getRealm()) {
  const converted = [];
  const out = (effects ?? []).map((effect) => {
    const gain = statusGain(effect.modifier, realm);
    if (!gain || gain.best > 0) return effect;
    converted.push(effect);
    return { reroll: { skills: gain.skills, uses: 2, days: effect.modifier.days ?? 30 } };
  });
  return { effects: out, converted: converted.length > 0 };
}
