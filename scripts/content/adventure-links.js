import { FLAG_SCOPE } from "../constants.js";

/*
 * Links from a story card to where the adventure tells it. The Kingmaker module's chapters are
 * journals in the GM's world; rather than copying their text, we find the page whose heading
 * names the event and open it there. Nothing is found (and no link shown) if the adventure
 * isn't imported.
 */

const cache = new Map();

const norm = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/&[a-z]+;/g, " ")
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** The adventure page (and heading anchor) for a heading like "The Rabble-Rouser", or null. */
export function adventurePage(heading) {
  if (!heading || !game.journal) return null;
  const key = norm(heading);
  if (cache.has(key)) return cache.get(key);
  let found = null;
  for (const journal of game.journal) {
    if (journal.getFlag(FLAG_SCOPE, "category")) continue; // our own imported pages
    for (const page of journal.pages) {
      if (page.type !== "text") continue;
      if (norm(page.name).includes(key)) {
        found = { page, anchor: null };
        break;
      }
      const html = page.text?.content ?? "";
      for (const match of html.matchAll(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi)) {
        if (norm(match[2]).includes(key)) {
          found = { page, anchor: Object.entries(page.toc ?? {}).find(([, t]) => norm(t.text).includes(key))?.[0] ?? null };
          break;
        }
      }
      if (found) break;
    }
    if (found) break;
  }
  cache.set(key, found);
  return found;
}

export function openAdventurePage(heading) {
  const found = adventurePage(heading);
  if (!found) return false;
  found.page.parent.sheet.render(true, { pageId: found.page.id, anchor: found.anchor ?? undefined });
  return true;
}

/** Forget what was found, after the adventure is imported or re-imported. */
export function clearAdventureLinks() {
  cache.clear();
}
