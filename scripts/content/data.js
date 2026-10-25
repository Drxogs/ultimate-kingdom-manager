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
  await Promise.all(["events", "matters", "rankups", "projects", "companions", "quests"].map(load));
}

export function getEvents() {
  return cache.events?.events ?? [];
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

export function getProject(type) {
  return getProjects().find((p) => p.id === type) ?? null;
}

export function getEvent(id) {
  if (typeof id === "string" && id.startsWith("project:")) return getProject(id.slice(8));
  return (
    getEvents().find((e) => e.id === id) ??
    getStoryEvents().find((e) => e.id === id) ??
    getMatters().find((e) => e.id === id) ??
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

export function getCompanions() {
  return cache.companions?.companions ?? [];
}

export function getCompanion(id) {
  return getCompanions().find((c) => c.id === id) ?? null;
}

export function getQuests() {
  return cache.quests?.quests ?? [];
}
