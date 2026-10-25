import { MODULE_ID } from "../constants.js";

export function getParty() {
  return game.actors.party ?? game.actors.find((a) => a.type === "party") ?? null;
}

/** The PF2e system's kingdom model on the party actor. */
export function getKingdom() {
  const kingdom = getParty()?.campaign;
  return kingdom?.constructor?.name === "Kingdom" || kingdom?.type === "kingmaker" ? kingdom : null;
}

export function isKingdomActive() {
  return !!getKingdom()?.active;
}

export function getPartyLevel() {
  const party = getParty();
  if (!party) return 1;
  if (Number.isInteger(party.level) && party.level > 0) return party.level;
  const levels = party.members.filter((m) => m.type === "character").map((m) => m.level);
  if (!levels.length) return 1;
  return Math.max(1, Math.round(levels.reduce((a, b) => a + b, 0) / levels.length));
}

export function getPlayerCharacters() {
  const party = getParty();
  const members = party?.members?.filter((m) => m.type === "character") ?? [];
  if (members.length) return members;
  return game.actors.filter((a) => a.type === "character" && a.hasPlayerOwner);
}

/** Kingdom level always tracks party level. */
export async function syncKingdomLevel() {
  const kingdom = getKingdom();
  if (!kingdom?.active || !game.user.isActiveGM) return;
  const level = Math.clamp(getPartyLevel(), 1, 20);
  if (kingdom.level === level) return;
  const previous = kingdom.level;
  await kingdom.update({ level });
  Hooks.callAll(`${MODULE_ID}.kingdomLevelChanged`, { previous, level });
}

export function getControlDC() {
  return getKingdom()?.control?.dc?.value ?? null;
}

export function getResourceDie() {
  return getKingdom()?.resources?.dice?.faces ?? 4;
}

export function getUnrest() {
  return getKingdom()?.unrest?.value ?? 0;
}

/** Ruin names by the attribute they penalize, as the system labels them. */
export const RUIN_BY_ABILITY = {
  culture: "corruption",
  economy: "crime",
  stability: "decay",
  loyalty: "strife"
};

export function getRuin() {
  const abilities = getKingdom()?.abilities ?? {};
  return Object.fromEntries(
    Object.entries(RUIN_BY_ABILITY).map(([ability, ruin]) => {
      const data = abilities[ability] ?? {};
      return [ruin, { ability, value: data.ruin?.value ?? 0, max: data.ruin?.max ?? 10, penalty: data.penalty ?? 0 }];
    })
  );
}

export function getFame() {
  const fame = getKingdom()?.resources?.fame;
  return { value: fame?.value ?? 0, max: fame?.max ?? 3 };
}

export function getSkillStatistic(skill) {
  return getKingdom()?.skills?.[skill] ?? null;
}
