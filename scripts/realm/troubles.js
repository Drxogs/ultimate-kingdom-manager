import { CARD_DEADLINE_DAYS, MODULE_ID } from "../constants.js";
import { getEvent, getTroubleData, getTroubles } from "../content/data.js";
import { addLog, newId } from "./state.js";
import { secondsPerDay } from "./time.js";
import { missingNeeds, sizeFor, SIZES, trackStage } from "./tracks.js";

/*
 * Trouble (stage 3c of the redesign). A settlement missing what its size needs, or crammed into
 * Tenements, may draw a trouble card at the start of a month. It's a chance, not a fixed penalty,
 * and a new kingdom gets its first three months free of it.
 */

const ACTIVE = ["open", "assigned", "rolled", "escalated"];
/** Book events that count as crime, besides trouble cards marked "crime". */
const CRIME_EVENTS = ["sensational-crime", "drug-den", "vandals"];

/** Tenements are the top Homes stage: dirty streets. */
export function hasTenements(settlement) {
  return trackStage(settlement, "homes") === 1;
}

export function isCrimeCard(card) {
  if (CRIME_EVENTS.includes(card?.eventId)) return true;
  return !!getEvent(card?.eventId)?.traits?.includes("crime");
}

function sizeAtLeast(settlement, size) {
  return !size || SIZES.indexOf(sizeFor(settlement)) >= SIZES.indexOf(size);
}

/** The trouble cards a settlement could draw now, grouped by what causes them. */
export function troubleOptions(settlement) {
  const groups = [];
  for (const { trackId } of missingNeeds(settlement)) {
    const when = trackStage(settlement, trackId) < 0 ? "missing" : "short";
    const cards = getTroubles().filter((t) => t.need?.track === trackId && t.need.when === when && sizeAtLeast(settlement, t.need.minSize));
    if (cards.length) groups.push({ cause: trackId, chance: "need", cards });
  }
  if (hasTenements(settlement)) groups.push({ cause: "tenements", chance: "tenements", cards: getTroubles().filter((t) => t.tenements) });
  return groups;
}

/** Still in the easy start? The first three months after the capital is founded are trouble-free. */
export function inQuietStart(realm, now = game.time.worldTime) {
  const capital = (realm.settlements ?? []).find((s) => s.capital);
  if (!capital?.founded) return false;
  return now - capital.founded < (getTroubleData().quietDays ?? 90) * secondsPerDay();
}

function activeHere(realm, eventId, settlementId) {
  return realm.cards.some((c) => c.eventId === eventId && c.target?.settlementId === settlementId && ACTIVE.includes(c.status));
}

export function troubleCard(trouble, settlement, { now = game.time.worldTime, hexKey = null } = {}) {
  return {
    id: newId(),
    eventId: trouble.id,
    tier: null,
    matter: false,
    trouble: true,
    name: trouble.name,
    kind: trouble.kind ?? "problem",
    seat: trouble.seat,
    stage: 0,
    status: "open",
    drawnAt: now,
    deadline: now + (trouble.deadlineDays ?? CARD_DEADLINE_DAYS) * secondsPerDay(),
    target: { hexKey, settlement: settlement.name, settlementId: settlement.id, hidden: false },
    revealed: false,
    assignee: null,
    workUntil: null,
    months: 1,
    noteId: null
  };
}

/**
 * At the start of a month: each settlement rolls for each kind of trouble it's open to.
 * Returns the new cards (already in the realm). rnd is for tests.
 */
export function drawTroubles(realm, { now = game.time.worldTime, rnd = Math.random, hexOf = () => null } = {}) {
  if (inQuietStart(realm, now)) return [];
  const chance = getTroubleData().chance ?? {};
  const drawn = [];
  for (const settlement of realm.settlements ?? []) {
    for (const group of troubleOptions(settlement)) {
      if (rnd() >= (chance[group.chance] ?? 0)) continue;
      const pool = group.cards.filter((t) => !activeHere(realm, t.id, settlement.id));
      if (!pool.length) continue;
      const trouble = pool[Math.floor(rnd() * pool.length)];
      const card = troubleCard(trouble, settlement, { now, hexKey: hexOf(settlement) });
      realm.cards.push(card);
      drawn.push(card);
      addLog(realm, { type: "event-drawn", card: card.id, seat: card.seat, text: `${card.name} (${settlement.name})` });
    }
  }
  if (drawn.length) Hooks.callAll(`${MODULE_ID}.eventsDrawn`, drawn);
  return drawn;
}

/** GM tool: draw one trouble card for a settlement now, ignoring the odds and the easy start. */
export function forceTrouble(realm, settlementId, { now = game.time.worldTime, hexOf = () => null } = {}) {
  const settlement = (realm.settlements ?? []).find((s) => s.id === settlementId);
  if (!settlement) return null;
  const pool = troubleOptions(settlement)
    .flatMap((g) => g.cards)
    .filter((t, i, all) => all.indexOf(t) === i && !activeHere(realm, t.id, settlement.id));
  if (!pool.length) return null;
  const card = troubleCard(pool[Math.floor(Math.random() * pool.length)], settlement, { now, hexKey: hexOf(settlement) });
  realm.cards.push(card);
  addLog(realm, { type: "event-drawn", card: card.id, seat: card.seat, text: `${card.name} (${settlement.name})` });
  Hooks.callAll(`${MODULE_ID}.eventsDrawn`, [card]);
  return card;
}
