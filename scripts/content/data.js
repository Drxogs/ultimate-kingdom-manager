import { MODULE_ID } from "../constants.js";

const cache = {};

async function load(name) {
  if (cache[name]) return cache[name];
  const response = await fetch(`modules/${MODULE_ID}/data/${name}.json`);
  if (!response.ok) throw new Error(`${MODULE_ID} | could not load data/${name}.json`);
  cache[name] = await response.json();
  return cache[name];
}

export async function preloadData() {
  await Promise.all(["events", "matters", "rankups", "projects", "audiences", "ambitions", "companions", "quests", "stories", "tracks", "troubles", "services"].map(load));
}

/** Settlement tracks (Homes, Faith, Food...): stages, what each gives, costs. */
export function getTrackData() {
  return cache.tracks ?? { tracks: [], costs: [], needs: {} };
}

export function getTracks() {
  return getTrackData().tracks ?? [];
}

export function getTrack(id) {
  return getTracks().find((t) => t.id === id) ?? null;
}

/** Trouble cards: what a settlement missing a need can draw. */
export function getTroubleData() {
  return cache.troubles ?? { troubles: [], chance: {}, quietDays: 90 };
}

export function getTroubles() {
  return getTroubleData().troubles ?? [];
}

/** Crown services: what the realm can do for the party, bought with BP. */
export function getServices() {
  return cache.services?.services ?? [];
}

export function getEvents() {
  return cache.events?.events ?? [];
}

/**
 * What happened, in a line or two, for each result of an event, desk matter or project.
 * Desk matters have a set of lines for each tier (early, middle, late), since each tier is a different situation.
 */
export function getStory(eventId, degreeName, tier = null) {
  const stories = cache.stories?.stories ?? {};
  const id = abilityId(eventId);
  const entry = stories[id];
  if (!entry) return null;
  const set = (tier && entry[tier]) || (entry[degreeName] ? entry : entry.early ?? entry.middle ?? entry.late);
  return set?.[degreeName] ?? null;
}

export function getStoryEvents() {
  return cache.events?.storyEvents ?? [];
}

export function getMatters() {
  return cache.matters?.matters ?? [];
}

export function getProjects() {
  return cache.projects?.projects ?? [];
}

/** Each seat's special ability, used by a suited companion advising that seat. */
export function getSeatAbilities() {
  return cache.companions?.seatAbilities ?? {};
}

const ABILITY_PREFIX = "seat-ability-";

/** Older saves name abilities after the companion (signature-valerie); they now belong to the seat. */
export function abilityId(id) {
  const raw = String(id ?? "").replace(/^project:/, "");
  if (!raw.startsWith("signature-")) return raw;
  const seat = getCompanion(raw.slice(10))?.seats?.[0];
  return seat ? `${ABILITY_PREFIX}${seat}` : raw;
}

/** A seat's special ability, shaped like a project, told with the advising companion's name. */
export function getSeatAbility(seat, companionId = null) {
  const ability = getSeatAbilities()[seat];
  if (!ability) return null;
  const companion = companionId ? getCompanion(companionId) : null;
  const who = companion?.name ?? game.i18n.localize("UKM.Ability.TheAdvisor");
  return {
    id: `${ABILITY_PREFIX}${seat}`,
    kind: "project",
    target: "none",
    advisorOnly: true,
    signature: true,
    companion: companion?.id ?? null,
    costBP: ability.cost ?? 0,
    ...ability,
    seat,
    hook: String(ability.hook ?? "").replaceAll("{advisor}", who),
    name: companion ? `${ability.name} (${companion.name})` : ability.name
  };
}

export function getProject(type) {
  const id = abilityId(type);
  if (id.startsWith(ABILITY_PREFIX)) return getSeatAbility(id.slice(ABILITY_PREFIX.length));
  return getProjects().find((p) => p.id === id) ?? null;
}

export function getAmbition(seat) {
  return cache.ambitions?.ambitions?.[seat] ?? null;
}

export function getAudiences() {
  return cache.audiences?.audiences ?? [];
}

export function getAudience(id) {
  return getAudiences().find((a) => a.id === id) ?? null;
}

export function getEvent(id) {
  if (typeof id === "string" && id.startsWith("project:")) return getProject(id.slice(8));
  if (typeof id === "string" && id.startsWith("audience:")) {
    const a = getAudience(id.slice(9));
    return a ? { ...a, name: a.petitioner, hook: a.request } : null;
  }
  return (
    getEvents().find((e) => e.id === id) ??
    getStoryEvents().find((e) => e.id === id) ??
    getMatters().find((e) => e.id === id) ??
    getTroubles().find((e) => e.id === id) ??
    null
  );
}

/** The level band a desk matter is written for. */
export function matterTier(level) {
  if (level >= 14) return "late";
  if (level >= 7) return "middle";
  return "early";
}

/** The event behind a card, with a desk matter's level version folded in. */
const KINGDOM_SKILLS = [
  "agriculture", "arts", "boating", "defense", "engineering", "exploration", "folklore", "industry",
  "intrigue", "magic", "politics", "scholarship", "statecraft", "trade", "warfare", "wilderness"
];

export function getCardEvent(card) {
  const event = getEvent(card.eventId);
  // A settlement-track project rolls with that track's skills.
  const trackSkills = card.project?.track?.skills;
  if (event && trackSkills?.length) return { ...event, skill: trackSkills };
  const structureSkill = card.project?.structure?.skill;
  if (event && KINGDOM_SKILLS.includes(structureSkill)) return { ...event, skill: [structureSkill] };
  if (!event?.tiers) return event;
  const { tiers, ...base } = event;
  return { ...base, ...(tiers[card.tier] ?? tiers.early) };
}

export function getRankUpScene(stat) {
  return cache.rankups?.stats?.[stat] ?? null;
}

export function getRankUpAlways(stat) {
  return cache.rankups?.always?.[stat] ?? [];
}

/** Advisors the GM added by name in Setup (an NPC they made up or met in play). */
function customAdvisors() {
  try {
    const list = game.settings.get(MODULE_ID, "customAdvisors");
    return (Array.isArray(list) ? list : []).filter((a) => a?.id && a?.name && a?.seats?.length).map((a) => ({ ...a, custom: true }));
  } catch {
    return [];
  }
}

/** Everyone who can advise a seat: the book's companions, the adventure's NPCs, and the GM's own. */
export function getCompanions() {
  return [...(cache.companions?.companions ?? []), ...customAdvisors()];
}

/** The advisor an actor stands for, matched by name (or a short name like "Oleg"). */
export function companionForName(actorName) {
  const name = String(actorName ?? "").toLowerCase();
  if (!name) return null;
  return (
    getCompanions().find((c) =>
      [c.name, ...(c.aliases ?? [])].some((raw) => {
        const n = raw.toLowerCase();
        return name === n || name.startsWith(`${n} `) || name.startsWith(`${n},`) || name.startsWith(`${n} (`);
      })
    ) ?? null
  );
}

export function getCompanion(id) {
  return getCompanions().find((c) => c.id === id) ?? null;
}

export function getQuests() {
  return cache.quests?.quests ?? [];
}
