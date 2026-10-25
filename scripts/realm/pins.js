import { FLAG_SCOPE } from "../constants.js";
import { getImportedPage } from "../content/story-import.js";
import { getHexCenter, getRegionScene } from "../integrations/kingmaker.js";
import { getSetting, SETTINGS } from "../settings.js";
import { getRealm, updateRealm } from "./state.js";

const ACTIVE_ICON = "icons/svg/hazard.svg";
const OPPORTUNITY_ICON = "icons/svg/book.svg";
const RESOLVED_ICON = "icons/svg/circle.svg";

function pinsOnScene(scene) {
  return scene.notes.filter((n) => n.getFlag(FLAG_SCOPE, "card"));
}

/**
 * Keep map pins in step with the realm's cards. Pins link to GM-only journal
 * pages, so players only see them once a page is shared with them.
 */
export async function syncPins() {
  if (!game.user.isActiveGM) return;
  const scene = getRegionScene();
  if (!scene) return;

  const realm = getRealm();
  const existing = new Map(pinsOnScene(scene).map((n) => [n.getFlag(FLAG_SCOPE, "card"), n]));
  const keepResolved = getSetting(SETTINGS.pinResolved) === "keep";
  const toCreate = [];
  const toUpdate = [];
  const toDelete = [];

  for (const card of realm.cards) {
    const note = existing.get(card.id);
    existing.delete(card.id);
    const active = ["open", "assigned"].includes(card.status);

    if (!active) {
      if (!note) continue;
      if (keepResolved) {
        if (note.texture.src !== RESOLVED_ICON) toUpdate.push({ _id: note.id, "texture.src": RESOLVED_ICON });
      } else toDelete.push(note.id);
      continue;
    }

    if (note || !card.target?.hexKey) continue;
    const center = getHexCenter(card.target.hexKey);
    const page = getImportedPage(`event-${card.eventId}`);
    if (!center || !page) continue;

    toCreate.push({
      x: center.x,
      y: center.y,
      entryId: page.parent.id,
      pageId: page.id,
      text: card.name,
      texture: { src: card.kind === "problem" ? ACTIVE_ICON : OPPORTUNITY_ICON, tint: card.kind === "problem" ? "#c0392b" : "#d4a017" },
      iconSize: 48,
      fontSize: 24,
      flags: { [FLAG_SCOPE]: { card: card.id } }
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
