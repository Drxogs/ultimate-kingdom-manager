import { FLAG_SCOPE, KINGMAKER_JOURNALS, KINGMAKER_JOURNAL_NAMES, STORY_FOLDER_NAME } from "../constants.js";
import { getHexDefinitions, getZones, isKingmakerActive } from "../integrations/kingmaker.js";
import { getEvents, getQuests, getStoryEvents } from "./data.js";

const GAZETTEER_NAMES = ["Central Stolen Lands", "Eastern Stolen Lands", "Western Stolen Lands", "Pitax"];

const JOURNAL_TITLES = {
  regions: "Regions",
  locations: "Locations",
  events: "Kingdom Events",
  quests: "Quests",
  characters: "Characters",
  structures: "Structures"
};

function hashText(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function slug(name) {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function findJournal(id, name) {
  return game.journal.get(id) ?? (name ? game.journal.getName(name) : null) ?? null;
}

function sortedPages(journal) {
  return journal ? journal.pages.contents.slice().sort((a, b) => a.sort - b.sort) : [];
}

function gazetteerPages() {
  return KINGMAKER_JOURNALS.gazetteers.flatMap((id, i) => sortedPages(findJournal(id, GAZETTEER_NAMES[i])));
}

function textOf(page) {
  return page?.type === "text" ? page.text?.content ?? "" : "";
}

/** What the import can see in this world, before anything is copied. */
export function inspectSources() {
  const kingmaker = isKingmakerActive();
  const sources = {
    gazetteers: KINGMAKER_JOURNALS.gazetteers.every((id, i) => !!findJournal(id, GAZETTEER_NAMES[i])),
    events: !!findJournal(KINGMAKER_JOURNALS.events, KINGMAKER_JOURNAL_NAMES.events),
    quests: !!findJournal(KINGMAKER_JOURNALS.quests, KINGMAKER_JOURNAL_NAMES.quests),
    characters: !!findJournal(KINGMAKER_JOURNALS.characters, KINGMAKER_JOURNAL_NAMES.characters),
    structures: !!findJournal(KINGMAKER_JOURNALS.structures, KINGMAKER_JOURNAL_NAMES.structures)
  };
  const adventureImported = Object.values(sources).every(Boolean);
  return { kingmaker, adventureImported, sources };
}

function buildRegions() {
  const zonePages = new Map();
  for (const page of gazetteerPages()) {
    const match = page.name.match(/^Zone (\d+):/);
    if (match) zonePages.set(Number(match[1]), page);
  }
  return getZones().map((zone) => {
    const page = zonePages.get(zone.level);
    return {
      key: `zone-${zone.id}`,
      name: `${zone.label} (level ${zone.level})`,
      source: page,
      flags: { zone: zone.id, level: zone.level }
    };
  });
}

function buildLocations() {
  return getHexDefinitions()
    .filter((hex) => hex.page)
    .map((hex) => {
      const page = fromUuidSync(hex.page);
      if (!page) return null;
      const code = page.name.match(/^([A-Z]{2}\d+)\./)?.[1] ?? null;
      return {
        key: `hex-${hex.key}`,
        name: page.name,
        source: page,
        flags: { hexKey: hex.key, offset: hex.offsetKey, zone: hex.zone, code, discovery: hex.discovery }
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

function buildEvents() {
  const journal = findJournal(KINGMAKER_JOURNALS.events, KINGMAKER_JOURNAL_NAMES.events);
  return [...getEvents(), ...getStoryEvents()].map((event) => {
    const page = journal?.pages.get(event.page) ?? journal?.pages.getName(event.name) ?? null;
    return { key: `event-${event.id}`, name: event.name, source: page, flags: { eventId: event.id } };
  });
}

function buildQuests() {
  const journal = findJournal(KINGMAKER_JOURNALS.quests, KINGMAKER_JOURNAL_NAMES.quests);
  const locations = new Map(buildLocations().map((l) => [l.flags.code, l.flags.hexKey]));
  return getQuests().map((quest) => {
    const page = journal?.pages.getName(quest.name) ?? null;
    return {
      key: `quest-${quest.id}`,
      name: quest.name,
      source: page,
      flags: { questId: quest.id, location: quest.location ?? null, hexKey: locations.get(quest.location) ?? null }
    };
  });
}

function buildCharacters() {
  const journal = findJournal(KINGMAKER_JOURNALS.characters, KINGMAKER_JOURNAL_NAMES.characters);
  return sortedPages(journal)
    .filter((p) => p.title?.level === 2 && p.name !== "Prominent Citizens")
    .map((page) => ({ key: `npc-${slug(page.name)}`, name: page.name, source: page, flags: { npc: slug(page.name) } }));
}

function buildStructures() {
  const journal = findJournal(KINGMAKER_JOURNALS.structures, KINGMAKER_JOURNAL_NAMES.structures);
  const pages = sortedPages(journal);
  const start = pages.findIndex((p) => p.name === "Structures");
  const after = pages.slice(start + 1);
  const end = after.findIndex((p) => p.title?.level === 1);
  return (end === -1 ? after : after.slice(0, end))
    .filter((p) => p.title?.level === 2)
    .map((page) => ({ key: `structure-${slug(page.name)}`, name: page.name, source: page, flags: { structure: slug(page.name) } }));
}

const BUILDERS = {
  regions: buildRegions,
  locations: buildLocations,
  events: buildEvents,
  quests: buildQuests,
  characters: buildCharacters,
  structures: buildStructures
};

/** Counts of what an import would copy, without writing anything. */
export function previewStoryImport() {
  const preview = { byCategory: {}, missing: [] };
  for (const [category, build] of Object.entries(BUILDERS)) {
    const entries = build();
    preview.byCategory[category] = entries.filter((e) => e.source).length;
    for (const e of entries) if (!e.source) preview.missing.push(`${JOURNAL_TITLES[category]}: ${e.name}`);
  }
  return preview;
}

async function ensureFolder() {
  const existing = game.folders.find((f) => f.type === "JournalEntry" && f.getFlag(FLAG_SCOPE, "story"));
  if (existing) return existing;
  return Folder.create({
    name: STORY_FOLDER_NAME,
    type: "JournalEntry",
    color: "#5b3a1a",
    flags: { [FLAG_SCOPE]: { story: true } }
  });
}

async function ensureJournal(folder, category) {
  const existing = game.journal.find((j) => j.getFlag(FLAG_SCOPE, "category") === category);
  if (existing) return existing;
  return JournalEntry.create({
    name: JOURNAL_TITLES[category],
    folder: folder.id,
    ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE },
    flags: { [FLAG_SCOPE]: { category } }
  });
}

/**
 * Copy story text from the adventure journals into GM-only journals.
 * Pages the GM has edited since the last import are left alone.
 */
export async function runStoryImport({ onProgress } = {}) {
  const folder = await ensureFolder();
  const summary = { created: 0, updated: 0, skippedEdited: 0, missing: [], byCategory: {} };
  const categories = Object.keys(BUILDERS);

  for (const [index, category] of categories.entries()) {
    onProgress?.({ category, step: index + 1, total: categories.length });
    const journal = await ensureJournal(folder, category);
    const entries = BUILDERS[category]();
    const existing = new Map(journal.pages.contents.map((p) => [p.getFlag(FLAG_SCOPE, "key"), p]));
    const toCreate = [];
    const toUpdate = [];

    for (const [sort, entry] of entries.entries()) {
      if (!entry.source) {
        summary.missing.push(`${JOURNAL_TITLES[category]}: ${entry.name}`);
        continue;
      }
      const content = textOf(entry.source);
      const hash = hashText(content);
      const flags = { [FLAG_SCOPE]: { key: entry.key, source: entry.source.uuid, hash, ...entry.flags } };
      const current = existing.get(entry.key);

      if (!current) {
        toCreate.push({
          name: entry.name,
          type: "text",
          sort: (sort + 1) * 100,
          title: { show: true, level: 1 },
          text: { content, format: CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML },
          flags
        });
        continue;
      }

      const storedHash = current.getFlag(FLAG_SCOPE, "hash");
      const editedByGM = hashText(textOf(current)) !== storedHash;
      if (editedByGM) {
        summary.skippedEdited++;
        continue;
      }
      if (storedHash !== hash) toUpdate.push({ _id: current.id, "text.content": content, flags });
    }

    if (toCreate.length) await journal.createEmbeddedDocuments("JournalEntryPage", toCreate);
    if (toUpdate.length) await journal.updateEmbeddedDocuments("JournalEntryPage", toUpdate);
    summary.created += toCreate.length;
    summary.updated += toUpdate.length;
    summary.byCategory[category] = entries.filter((e) => e.source).length;
  }

  return summary;
}

/** Find an imported page by its key (for example "event-plague" or "hex-1019"). */
export function getImportedPage(key) {
  for (const journal of game.journal) {
    if (!journal.getFlag(FLAG_SCOPE, "category")) continue;
    const page = journal.pages.find((p) => p.getFlag(FLAG_SCOPE, "key") === key);
    if (page) return page;
  }
  return null;
}

