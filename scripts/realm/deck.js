import { CARD_DEADLINE_DAYS, MODULE_ID, SEATS } from "../constants.js";
import { getEvents, getMatters, matterTier } from "../content/data.js";
import { getKingdom } from "../integrations/party.js";
import {
  getAllHexStates,
  getClaimedHexes,
  getHexDefinitions,
  getZone,
  hasFeature,
  isKingmakerActive,
  summarizeRealm
} from "../integrations/kingmaker.js";
import { getSetting, SETTINGS } from "../settings.js";
import { addLog, newId } from "./state.js";
import { secondsPerDay } from "./time.js";

const SETTLEMENT_TYPES = ["metropolis", "city", "town", "village"];
const DRAWS_BY_NATION = { territory: 1, province: 1, state: 2, country: 2, dominion: 3 };

function pickWeighted(items, weightOf) {
  const total = items.reduce((sum, item) => sum + weightOf(item), 0);
  if (total <= 0) return null;
  let roll = Math.random() * total;
  for (const item of items) {
    roll -= weightOf(item);
    if (roll < 0) return item;
  }
  return items.at(-1);
}

function pickRandom(items) {
  return items.length ? items[Math.floor(Math.random() * items.length)] : null;
}

function hexDefinitionMap() {
  return new Map(getHexDefinitions().map((h) => [h.key, h]));
}

function zoneLevelOf(hexKey, defs) {
  return getZone(defs.get(hexKey)?.zone)?.level ?? null;
}

/** Prefer hexes in zones near the kingdom's level; fall back to anything that qualifies. */
function withLevelGravity(hexes, defs) {
  const level = getKingdom()?.level ?? 1;
  const band = getSetting(SETTINGS.levelGravity);
  const near = hexes.filter((h) => {
    const zoneLevel = zoneLevelOf(h.key, defs);
    return zoneLevel !== null && Math.abs(zoneLevel - level) <= band;
  });
  return near.length ? near : hexes;
}

export function settlementHexes() {
  return getClaimedHexes()
    .map((hex) => {
      const feature = (hex.features ?? []).find((f) => SETTLEMENT_TYPES.includes(f.type));
      if (!feature) return null;
      return { key: hex.key, type: feature.type, name: feature.name ?? null, rank: SETTLEMENT_TYPES.length - SETTLEMENT_TYPES.indexOf(feature.type) };
    })
    .filter(Boolean);
}

export function neighbors(hexKey) {
  const hex = globalThis.kingmaker?.region?.hexes?.get?.(Number(hexKey));
  const list = hex?.getNeighbors?.() ?? [];
  return list.map((n) => String(n.key ?? 1000 * n.offset.i + n.offset.j));
}

function chooseHex(rule) {
  const defs = hexDefinitionMap();
  const claimed = getClaimedHexes();
  const settlements = new Set(settlementHexes().map((s) => s.key));
  let pool = [];

  switch (rule) {
    case "farmland":
      pool = claimed.filter((h) => hasFeature(h, "farmland"));
      break;
    case "unclaimed-adjacent": {
      const claimedKeys = new Set(claimed.map((h) => h.key));
      const known = new Map(getAllHexStates().map((h) => [h.key, h]));
      const frontier = new Set();
      for (const hex of claimed) {
        for (const n of neighbors(hex.key)) {
          if (!claimedKeys.has(n) && defs.get(n)?.zone !== "NA") frontier.add(n);
        }
      }
      pool = [...frontier].map((key) => known.get(key) ?? { key });
      break;
    }
    case "claimed-in-influence":
      pool = claimed.filter((h) => !settlements.has(h.key) && neighbors(h.key).some((n) => settlements.has(n)));
      break;
    case "claimed-outside-influence":
    default:
      pool = claimed.filter((h) => !settlements.has(h.key) && !neighbors(h.key).some((n) => settlements.has(n)));
      if (!pool.length) pool = claimed.filter((h) => !settlements.has(h.key));
  }

  return pickRandom(withLevelGravity(pool, defs))?.key ?? null;
}

function chooseSettlement(rule) {
  const list = settlementHexes();
  if (!list.length) return null;
  const capital = getKingdom()?.capital;
  switch (rule) {
    case "largest":
    case "highest-consumption-or-largest":
    case "most-cemeteries-or-largest":
      return list.sort((a, b) => b.rank - a.rank)[0];
    case "smallest":
      return list.sort((a, b) => a.rank - b.rank)[0];
    case "capital":
      return list.find((s) => capital && s.name === capital) ?? list.sort((a, b) => b.rank - a.rank)[0];
    case "newest":
      return list.at(-1);
    default:
      return pickRandom(list);
  }
}

function requirementsMet(event, realm) {
  const req = event.requires;
  if (!req) return true;
  const map = isKingmakerActive() ? summarizeRealm() : { farmlands: 0, settlements: 0 };
  if (req.farmland && map.farmlands < req.farmland) return false;
  if (req.settlements && settlementHexes().length < req.settlements) return false;
  if (req.relations && (realm.relations?.length ?? 0) < req.relations) return false;
  if (req.npcLeader) {
    const leaders = Object.values(getKingdom()?.leadership ?? {});
    const hasNpc = leaders.some((l) => l.uuid && fromUuidSync(l.uuid)?.type !== "character");
    if (!hasNpc && !req.orGmPcLeader) return false;
  }
  if (req.structureAny) {
    const built = new Set(realm.structures ?? []);
    if (!req.structureAny.some((s) => built.has(s))) return false;
  }
  return true;
}

function isAlreadyActive(event, realm) {
  return realm.cards.some((c) => c.eventId === event.id && ["open", "assigned"].includes(c.status));
}

export function createCard(event, { now = game.time.worldTime, tier = null } = {}) {
  const version = tier && event.tiers ? { ...event, ...event.tiers[tier] } : event;
  const target = {};
  if (event.placement?.type === "hex") target.hexKey = chooseHex(event.placement.rule);
  if (event.placement?.type === "settlement") {
    const settlement = chooseSettlement(event.placement.rule);
    target.hexKey = settlement?.key ?? null;
    target.settlement = settlement?.name ?? null;
  }
  target.hidden = !!event.placement?.hidden;

  return {
    id: newId(),
    eventId: event.id,
    tier,
    matter: !!event.tiers,
    name: version.name,
    kind: version.kind,
    seat: event.seat,
    stage: 0,
    status: "open",
    drawnAt: now,
    deadline: now + (version.deadlineDays ?? CARD_DEADLINE_DAYS) * secondsPerDay(),
    target,
    revealed: false,
    assignee: null,
    workUntil: null,
    months: 1,
    noteId: null
  };
}

/** Draw the month's random events into the realm. Returns the new cards. */
export function drawMonthlyEvents(realm) {
  const nation = getKingdom()?.nationType ?? "territory";
  const count = DRAWS_BY_NATION[nation] ?? 1;
  const drawn = [];

  for (let i = 0; i < count; i++) {
    const excluded = new Set();
    let card = null;
    while (!card) {
      const pool = getEvents().filter(
        (e) => !excluded.has(e.id) && requirementsMet(e, realm) && !isAlreadyActive(e, realm)
      );
      const event = pickWeighted(pool, (e) => e.weight ?? 1);
      if (!event) break;
      const candidate = createCard(event);
      const needsPlace = ["hex", "settlement"].includes(event.placement?.type);
      if (needsPlace && !candidate.target.hexKey) excluded.add(event.id);
      else card = candidate;
    }
    if (!card) break;
    realm.cards.push(card);
    drawn.push(card);
    addLog(realm, { type: "event-drawn", card: card.id, seat: card.seat, text: card.name });
  }

  Hooks.callAll(`${MODULE_ID}.eventsDrawn`, drawn);
  return drawn;
}

const MATTER_LOOKBACK_DAYS = 56;
const MATTER_COOLDOWN_DAYS = 180;

/** How busy each desk has been lately, counting every card drawn to it. */
function deskActivity(realm, now) {
  const since = now - MATTER_LOOKBACK_DAYS * secondsPerDay();
  const counts = Object.fromEntries(SEATS.map((s) => [s, 0]));
  for (const card of realm.cards) {
    if (card.drawnAt >= since && counts[card.seat] !== undefined) counts[card.seat] += 1;
    if (["open", "assigned", "rolled", "escalated"].includes(card.status) && counts[card.seat] !== undefined) counts[card.seat] += 1;
  }
  return counts;
}

/**
 * One small matter a week, sent to whichever desk has been quietest. Matters
 * seen recently are held back so the same one doesn't come round too soon.
 */
export function drawWeeklyMatter(realm, { now = game.time.worldTime } = {}) {
  const matters = getMatters();
  if (!matters.length) return null;
  const tier = matterTier(getKingdom()?.level ?? 1);
  const history = (realm.matterHistory ??= {});
  const cooldown = MATTER_COOLDOWN_DAYS * secondsPerDay();
  const activity = deskActivity(realm, now);

  const available = (seat) =>
    matters.filter(
      (m) =>
        m.seat === seat &&
        m.tiers?.[tier] &&
        !isAlreadyActive(m, realm) &&
        requirementsMet(m, realm) &&
        !(history[m.id] && now - history[m.id] < cooldown)
    );

  const seats = SEATS.filter((s) => available(s).length).sort((a, b) => activity[a] - activity[b] || Math.random() - 0.5);
  for (const seat of seats) {
    const matter = pickWeighted(available(seat), (m) => m.weight ?? 1);
    if (!matter) continue;
    const card = createCard(matter, { now, tier });
    const placement = matter.placement?.type;
    if (["hex", "settlement"].includes(placement) && !card.target.hexKey) continue;
    history[matter.id] = now;
    realm.cards.push(card);
    addLog(realm, { type: "event-drawn", card: card.id, seat: card.seat, text: card.name });
    Hooks.callAll(`${MODULE_ID}.eventsDrawn`, [card]);
    return card;
  }
  return null;
}
