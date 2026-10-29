import { FLAG_SCOPE } from "../constants.js";
import { getCardEvent } from "../content/data.js";
import { getImportedPage, KINGMAKER_SHEET, kingmakerSheetAvailable } from "../content/story-import.js";
import { getHexCenter, getRegionScene } from "../integrations/kingmaker.js";
import { getSetting, SETTINGS } from "../settings.js";
import { getRealm, updateRealm } from "./state.js";
import { isLeader } from "./leader.js";
import { formatDate } from "./time.js";

const RESOLVED_ICON = "icons/svg/circle.svg";

// Pictures for the pins, from Foundry's own icon library: one per kind of trouble or opportunity.
const EVENT_ICONS = {
  "archaeological-find": "icons/environment/wilderness/wall-ruins.webp",
  boomtown: "icons/environment/settlement/market-stall.webp",
  "building-demand": "icons/environment/settlement/house-construction.webp",
  "crop-failure": "icons/commodities/flowers/wheat-bundle.webp",
  "cult-activity": "icons/creatures/unholy/demon-fire-horned-mask.webp",
  "drug-den": "icons/skills/toxins/bottle-open-vapors-pink.webp",
  feud: "icons/sundries/flags/banner-symbol-axe-red.webp",
  "land-rush": "icons/environment/settlement/tent-flag.webp",
  "local-disaster": "icons/environment/settlement/building-rubble.webp",
  "monster-activity": "icons/creatures/claws/claw-bear-paw-swipe-red.webp",
  "noblesse-oblige": "icons/environment/settlement/house-manor.webp",
  plague: "icons/skills/toxins/cauldron-pot-bubbles-green.webp",
  sacrifices: "icons/environment/wilderness/altar-hidden.webp",
  "sensational-crime": "icons/commodities/treasure/mask-wood-tan.webp",
  squatters: "icons/environment/settlement/tent.webp",
  "undead-uprising": "icons/magic/death/undead-zombie-grave-green.webp",
  "unexpected-find": "icons/commodities/treasure/crystal-ball-blue-purple.webp",
  vandals: "icons/environment/settlement/rubble-scrap-refuse-wood-metal.webp",
  "visiting-celebrity": "icons/commodities/treasure/mask-jeweled-gold.webp",
  "wealthy-immigrant": "icons/commodities/currency/coins-assorted-mix-copper-silver-gold.webp",
  "too-close-to-home": "icons/environment/creatures/monster-tentacles-eye-purple.webp",
  "urban-outbreak": "icons/environment/creatures/monster-barbed-carapace-purple.webp",
  "project:claim-hex": "icons/sundries/flags/banner-flag-blue.webp",
  "project:build-road": "icons/environment/wilderness/terrain-river-road-gray.webp",
  "project:establish-farmland": "icons/environment/settlement/house-farmland.webp",
  "project:establish-work-site": "icons/environment/settlement/mine-cart-rocks-red.webp",
  "project:found-settlement": "icons/environment/settlement/house-farmland-small.webp",
  "project:build-structure": "icons/tools/hand/hammer-and-nail.webp",
  "project:fortify-hex": "icons/environment/settlement/watchtower-cliff.webp"
};
const KIND_ICONS = {
  problem: "icons/environment/traps/spike-skull-white-brown.webp",
  opportunity: "icons/commodities/currency/coins-assorted-crown-blue.webp",
  project: "icons/tools/hand/hammer-and-nail.webp"
};
const ACTIVE = ["open", "assigned", "escalated", "rolled"];
const NOTICES_NAME = "Kingdom Notices";

function pinsOnScene(scene) {
  return scene.notes.filter((n) => n.getFlag(FLAG_SCOPE, "card"));
}

function iconFor(card) {
  return { src: EVENT_ICONS[card.eventId] ?? KIND_ICONS[card.kind] ?? KIND_ICONS.opportunity, tint: "#ffffff" };
}

/** A journal everyone can read, holding one short page per card the GM has revealed. */
async function noticesJournal() {
  // The Kingmaker journal sheet, like the handbooks and the imported story, when the module has it.
  const sheetClass = kingmakerSheetAvailable() ? KINGMAKER_SHEET : null;
  const existing = game.journal.find((j) => j.getFlag(FLAG_SCOPE, "notices"));
  if (existing) {
    if (sheetClass && existing.getFlag("core", "sheetClass") !== sheetClass) await existing.setFlag("core", "sheetClass", sheetClass);
    return existing;
  }
  const folder = game.folders.find((f) => f.type === "JournalEntry" && f.getFlag(FLAG_SCOPE, "handbook"));
  return JournalEntry.create({
    name: NOTICES_NAME,
    folder: folder?.id ?? null,
    ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER },
    flags: { [FLAG_SCOPE]: { notices: true }, ...(sheetClass ? { core: { sheetClass } } : {}) }
  });
}

function noticeContent(card) {
  const esc = Handlebars.escapeExpression;
  const event = getCardEvent(card);
  const kind = game.i18n.localize(`UKM.Card.Kind.${card.kind}`);
  const seat = game.i18n.localize(`UKM.Seat.${card.seat}`);
  const hook = event?.hook ?? "";
  const lines = [`<p><strong>${esc(kind)}</strong> · ${esc(seat)}</p>`];
  if (hook) lines.push(`<p><em>${esc(hook)}</em></p>`);
  if (card.kind !== "project") lines.push(`<p>${esc(game.i18n.format("UKM.Pins.Deadline", { date: formatDate(card.deadline) }))}</p>`);
  return lines.join("");
}

/** Keep the public notice pages in step with what's revealed. Returns the page for each revealed card. */
async function syncNotices(realm) {
  const revealed = realm.cards.filter((c) => c.revealed && ACTIVE.includes(c.status) && c.target?.hexKey);
  const journal = game.journal.find((j) => j.getFlag(FLAG_SCOPE, "notices"));
  if (!revealed.length && !journal) return new Map();
  const book = await noticesJournal();
  const pages = new Map(book.pages.contents.map((p) => [p.getFlag(FLAG_SCOPE, "card"), p]));
  const keep = new Set(revealed.map((c) => c.id));
  const stale = [...pages.entries()].filter(([id]) => !keep.has(id)).map(([, p]) => p.id);
  if (stale.length) await book.deleteEmbeddedDocuments("JournalEntryPage", stale);
  const toCreate = revealed
    .filter((c) => !pages.has(c.id))
    .map((c) => ({
      name: c.name,
      type: "text",
      text: { content: noticeContent(c), format: CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML },
      flags: { [FLAG_SCOPE]: { card: c.id } }
    }));
  if (toCreate.length) await book.createEmbeddedDocuments("JournalEntryPage", toCreate);
  return new Map(book.pages.contents.filter((p) => keep.has(p.getFlag(FLAG_SCOPE, "card"))).map((p) => [p.getFlag(FLAG_SCOPE, "card"), p]));
}

/**
 * Keep map pins in step with the realm's cards. A pin links to the GM's own
 * page until the GM reveals it; then it links to a short public notice, and
 * players can see it.
 */
export async function syncPins() {
  if (!isLeader()) return;
  const scene = getRegionScene();
  if (!scene) return;

  const realm = getRealm();
  const notices = await syncNotices(realm);
  const existing = new Map(pinsOnScene(scene).map((n) => [n.getFlag(FLAG_SCOPE, "card"), n]));
  const keepResolved = getSetting(SETTINGS.pinResolved) === "keep";
  const toCreate = [];
  const toUpdate = [];
  const toDelete = [];

  for (const card of realm.cards) {
    const note = existing.get(card.id);
    existing.delete(card.id);
    const active = ACTIVE.includes(card.status);

    if (!active) {
      if (!note) continue;
      if (keepResolved && !note.getFlag(FLAG_SCOPE, "public")) {
        if (note.texture.src !== RESOLVED_ICON) toUpdate.push({ _id: note.id, "texture.src": RESOLVED_ICON });
      } else toDelete.push(note.id);
      continue;
    }

    if (!card.target?.hexKey) continue;
    const page = notices.get(card.id) ?? getImportedPage(`event-${card.eventId}`);
    if (!page) {
      if (note) toDelete.push(note.id);
      continue;
    }
    const isPublic = notices.has(card.id);

    if (note) {
      const icon = iconFor(card);
      if (note.entryId !== page.parent.id || note.pageId !== page.id || note.texture.src !== icon.src) {
        toUpdate.push({ _id: note.id, entryId: page.parent.id, pageId: page.id, "texture.src": icon.src, "texture.tint": icon.tint, [`flags.${FLAG_SCOPE}.public`]: isPublic });
      }
      continue;
    }

    const center = getHexCenter(card.target.hexKey);
    if (!center) continue;
    toCreate.push({
      x: center.x,
      y: center.y,
      entryId: page.parent.id,
      pageId: page.id,
      text: card.name,
      texture: iconFor(card),
      iconSize: 64,
      fontSize: 24,
      flags: { [FLAG_SCOPE]: { card: card.id, public: isPublic } }
    });
  }

  toDelete.push(...[...existing.values()].map((n) => n.id));

  if (toDelete.length) await scene.deleteEmbeddedDocuments("Note", toDelete);
  if (toUpdate.length) await scene.updateEmbeddedDocuments("Note", toUpdate);
  if (toCreate.length) {
    const created = await scene.createEmbeddedDocuments("Note", toCreate);
    const ids = Object.fromEntries(created.map((n) => [n.getFlag(FLAG_SCOPE, "card"), n.id]));
    await updateRealm((r) => {
      for (const card of r.cards) if (ids[card.id]) card.noteId = ids[card.id];
    });
  }
}

/** Show or hide a card's place to the players. */
export async function setRevealed(cardId, revealed) {
  await updateRealm((realm) => {
    const card = realm.cards.find((c) => c.id === cardId);
    if (card) card.revealed = revealed;
  });
  await syncPins();
}

/** Active cards on one hex, for the Kingmaker hex panel. Players only see what's been revealed. */
export function cardsOnHex(hexKey) {
  const key = String(hexKey);
  return getRealm().cards.filter(
    (c) => ACTIVE.includes(c.status) && c.target?.hexKey === key && (game.user.isGM || c.revealed || c.kind === "project")
  );
}
