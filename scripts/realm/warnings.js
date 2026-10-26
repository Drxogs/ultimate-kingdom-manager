import { FLAG_SCOPE } from "../constants.js";
import { getCompanion } from "../content/data.js";
import { getHexDefinitions, getRegionScene, getZone, isKingmakerActive } from "../integrations/kingmaker.js";
import { getKingdom, getPartyLevel } from "../integrations/party.js";
import { getSetting, setSetting, SETTINGS } from "../settings.js";
import { isLeader } from "./leader.js";
import { seatCompanionId } from "./rules.js";

const ADVISOR_SEATS = ["warden", "general", "magister"];

function hexAt(point) {
  const region = globalThis.kingmaker?.region;
  if (!region?.hexes) return null;
  const direct = region.getHexFromPoint?.(point);
  if (direct) return direct;
  let best = null;
  let bestDistance = Infinity;
  for (const hex of region.hexes) {
    const c = hex.center;
    if (!c) continue;
    const d = (c.x - point.x) ** 2 + (c.y - point.y) ** 2;
    if (d < bestDistance) {
      bestDistance = d;
      best = hex;
    }
  }
  return best;
}

/** Who speaks up: the first of these seats with someone in it. */
function speakerName() {
  const kingdom = getKingdom();
  for (const seat of ADVISOR_SEATS) {
    const companionId = seatCompanionId(seat);
    if (companionId) return getCompanion(companionId)?.name ?? null;
    const uuid = kingdom?.leadership?.[seat]?.uuid;
    const name = uuid ? fromUuidSync(uuid)?.name : null;
    if (name) return name;
  }
  return null;
}

function isPartyToken(token) {
  const actor = token.actor;
  return actor?.type === "party" || (actor?.type === "character" && actor.hasPlayerOwner);
}

/**
 * When the party heads into land well above its level, an advisor says so.
 * Once per zone until the party levels up. Never blocks anything.
 */
export async function checkPartyPosition(token, changes) {
  const mode = getSetting(SETTINGS.advisorWarnings);
  if (mode === "off" || !isLeader() || !isKingmakerActive()) return;
  if (!("x" in changes) && !("y" in changes)) return;
  if (token.parent?.id !== getRegionScene()?.id || !isPartyToken(token)) return;

  const size = token.parent.grid?.size ?? 100;
  const point = { x: token.x + (token.width * size) / 2, y: token.y + (token.height * size) / 2 };
  const hex = hexAt(point);
  if (!hex) return;
  const key = String(hex.key ?? 1000 * hex.offset.i + hex.offset.j);
  const def = getHexDefinitions().find((h) => h.key === key);
  const zone = getZone(def?.zone);
  if (!zone) return;
  const level = getPartyLevel();
  const delta = zone.level - level;
  if (delta < 2) return;

  const warned = foundry.utils.deepClone(getSetting(SETTINGS.warnedZones) ?? {});
  if (warned[zone.id] === level) return;
  warned[zone.id] = level;
  await setSetting(SETTINGS.warnedZones, warned);

  const name = speakerName();
  const severity = delta >= 4 ? "Deadly" : delta >= 3 ? "Danger" : "Caution";
  const text = game.i18n.format(`UKM.Warning.${mode === "blunt" ? "Blunt" : "Subtle"}.${severity}`, {
    zone: zone.label,
    zoneLevel: zone.level,
    level
  });
  await ChatMessage.create({
    speaker: { alias: name ?? game.i18n.localize("UKM.Warning.Someone") },
    content: `<div class="ukm-chat ukm-warning"><p>${text}</p></div>`,
    flags: { [FLAG_SCOPE]: { warning: zone.id } }
  });
}
