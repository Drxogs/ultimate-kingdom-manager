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
  await Promise.all(["events", "companions", "quests"].map(load));
}

export function getEvents() {
  return cache.events?.events ?? [];
}

export function getStoryEvents() {
  return cache.events?.storyEvents ?? [];
}

export function getEvent(id) {
  return getEvents().find((e) => e.id === id) ?? getStoryEvents().find((e) => e.id === id) ?? null;
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
