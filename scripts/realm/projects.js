import { COMMODITY_BP, FLAG_SCOPE, MODULE_ID, SEATS } from "../constants.js";
import { getCompanion, getProject, getProjects, getSignature } from "../content/data.js";
import {
  getAllHexStates,
  getClaimedHexes,
  getHexDefinitions,
  getZone,
  hasFeature,
  isKingmakerActive,
  structureArt
} from "../integrations/kingmaker.js";
import { getKingdom, getPartyLevel } from "../integrations/party.js";
import { getSetting, setSetting, SETTINGS } from "../settings.js";
import { neighbors, settlementHexes } from "./deck.js";
import { attitudeAtLeast, seatCompanionId, weeklyIncome } from "./rules.js";
import { addLog, getRealm, newId, updateRealm } from "./state.js";
import { syncPins } from "./pins.js";
import { secondsPerDay } from "./time.js";
import { isLeader } from "./leader.js";
import { addBuilding, hasCapital, newSettlement, parseStructureHtml, roomFor, settlementHex, settlements, settlementState, syncKingdomSettlements } from "./settlements.js";

const NEVER = 3650;
const CAMPS = ["quarry", "mine", "lumber"];
const CAMP_FOR_COMMODITY = { stone: "quarry", ore: "mine", lumber: "lumber" };
const SETTLEMENT_TYPES = ["village", "town", "city", "metropolis"];
const SLUG_FIXES = { cemetary: "cemetery" };

function definitions() {
  return new Map(getHexDefinitions().map((h) => [h.key, h]));
}

export function hexLabel(hexKey, defs = definitions()) {
  const n = Number(hexKey);
  const coords = Number.isInteger(n) ? `${Math.floor(n / 1000)}.${n % 1000}` : hexKey;
  const zone = getZone(defs.get(hexKey)?.zone);
  return zone ? `${zone.label} ${coords}, ${game.i18n.localize("UKM.Manager.Level").toLowerCase()} ${zone.level}` : coords;
}

/**
 * Work far above the party's level costs more and takes longer; settled,
 * safe land is cheaper. Returns a multiplier for both.
 */
export function gradientFactor(hexKey, defs = definitions()) {
  const zone = getZone(defs.get(hexKey)?.zone);
  if (!zone) return 1;
  const g = getSetting(SETTINGS.costGradient) ?? {};
  const delta = zone.level - getPartyLevel();
  if (delta <= -2) return 1 + (g.below ?? -0.25);
  if (delta >= 3) return 1 + (g.plusThree ?? 1);
  if (delta === 2) return 1 + (g.plusTwo ?? 0.5);
  return 1 + (g.near ?? 0);
}

/** Hex projects go wherever the party tells the GM; the module only checks one is possible. */
export function isHexProject(def) {
  return !["none", "settlement"].includes(def?.target);
}

const PARTY_PICKS = { hexKey: null, label: "", factor: 1 };

/** Where a project of this kind could go right now. */
export function projectTargets(def, realm = getRealm()) {
  if (isHexProject(def)) {
    if (!isKingmakerActive()) return [PARTY_PICKS];
    return possibleHexes(def, realm).length ? [PARTY_PICKS] : [];
  }
  if (def.target === "settlement") {
    return settlements(realm).map((s) => ({
      hexKey: settlementHex(s),
      settlementId: s.id,
      settlement: s.name,
      label: `${s.name} (${game.i18n.localize(`UKM.Settlement.Type.${s.type}`)})`,
      factor: 1
    }));
  }
  if (!isKingmakerActive()) return def.target === "none" ? [PARTY_PICKS] : [];
  return possibleHexes(def, realm);
}

function possibleHexes(def, realm) {
  const defs = definitions();
  const claimed = getClaimedHexes();
  const isSettlement = (h) => SETTLEMENT_TYPES.some((t) => hasFeature(h, t));
  let hexes = [];

  switch (def.target) {
    case "frontier": {
      const claimedKeys = new Set(claimed.map((h) => h.key));
      const known = new Map(getAllHexStates().map((h) => [h.key, h]));
      const keys = new Set();
      for (const hex of claimed) {
        for (const n of neighbors(hex.key)) {
          if (!claimedKeys.has(n) && defs.get(n) && defs.get(n).zone !== "NA") keys.add(n);
        }
      }
      hexes = [...keys].map((key) => known.get(key) ?? { key });
      break;
    }
    case "claimed-no-road":
      hexes = claimed.filter((h) => !hasFeature(h, "road"));
      break;
    case "claimed-no-farm":
      hexes = claimed.filter((h) => !hasFeature(h, "farmland") && !isSettlement(h));
      break;
    case "claimed-not-fortified": {
      const fortified = new Set(realm.fortified ?? []);
      hexes = claimed.filter((h) => !fortified.has(h.key));
      break;
    }
    case "claimed-no-camp":
      hexes = claimed.filter((h) => !h.camp && !isSettlement(h));
      break;
    case "none":
      return [{ hexKey: null, label: "", factor: 1 }];
    case "settlement":
      return [];
    case "claimed-no-settlement":
      hexes = claimed.filter((h) => !isSettlement(h));
      break;
    default:
      hexes = [];
  }

  return hexes
    .map((h) => {
      const factor = gradientFactor(h.key, defs);
      const commodity = h.commodity ?? null;
      return {
        hexKey: h.key,
        commodity,
        label: `${hexLabel(h.key, defs)}${commodity ? ` · ${game.i18n.localize(`UKM.Project.Commodity.${commodity}`)}` : ""}`,
        factor
      };
    })
    .sort((a, b) => a.factor - b.factor || a.label.localeCompare(b.label, undefined, { numeric: true }));
}

function baseCost(def) {
  return Math.max(2, Math.round(weeklyIncome(getRealm()).base * (def.costWeeks ?? 1)));
}

/** BP cost and working days for a project at a target. */
export function projectQuote(def, target, structure = null) {
  const factor = target?.factor ?? 1;
  if (def.target === "none") return { cost: def.costBP || (def.costWeeks ? baseCost(def) : 0), days: def.workDays ?? 7 };
  if (def.target === "settlement") {
    const bp = structure?.cost ?? structure?.bp ?? Math.max(4, (structure?.level ?? 1) * 6);
    const days = def.workDays + Math.max(0, (structure?.level ?? 1) - 4);
    return { cost: bp, days };
  }
  return { cost: Math.max(1, Math.round(baseCost(def) * factor)), days: Math.max(3, Math.round(def.workDays * factor)) };
}

/** The signature ability of the companion advising a seat, if they have one and it's usable now. */
export function signatureForSeat(seat, realm = getRealm()) {
  const companionId = seatCompanionId(seat);
  const def = companionId ? getSignature(companionId) : null;
  if (!def) return null;
  if (def.requiresSeat && !getCompanion(companionId)?.seats?.includes(seat)) return null;
  if (!attitudeAtLeast(companionId, "friendly")) return null;
  const readyAt = realm.cooldowns?.[def.id] ?? 0;
  const busy = realm.cards.some((c) => c.eventId === `project:${def.id}` && ["open", "assigned", "rolled"].includes(c.status));
  return { ...def, seat, readyAt, available: !busy && readyAt <= game.time.worldTime };
}

function onCooldown(def, realm) {
  if (!def.cooldownDays) return false;
  return (realm.cooldowns?.[def.id] ?? 0) > game.time.worldTime ||
    realm.cards.some((c) => c.eventId === `project:${def.id}` && ["open", "assigned", "rolled"].includes(c.status));
}

export function projectsForSeat(seat, realm = getRealm()) {
  const list = getProjects().filter((p) => p.seat === seat && !onCooldown(p, realm));
  const signature = signatureForSeat(seat);
  if (signature?.available) list.push(signature);
  return list;
}

/* ---------- Structures ---------- */

/** Turn "6 RP, 2 Lumber, 1 Stone" into BP at the realm's conversion rates. */
export function costToBP(text) {
  if (!text) return null;
  let bp = 0;
  let found = false;
  for (const [, amount, kind] of text.matchAll(/(\d+)\s*(RP|Lumber|Stone|Ore|Luxur\w*)/gi)) {
    const n = Number(amount);
    const key = kind.toLowerCase();
    found = true;
    if (key === "rp") bp += n;
    else if (key.startsWith("luxur")) bp += n * COMMODITY_BP.luxuries;
    else bp += n * (COMMODITY_BP[key] ?? 2);
  }
  return found ? bp : null;
}

function slugify(text) {
  return String(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function parseStructure(page) {
  const parsed = parseStructureHtml(page.text?.content);
  return { ...parsed, bp: costToBP(parsed.costText) };
}

/** "tavern, dive" or "wooden wall" → the catalog slug it names. */
function resolveUpgrade(name, catalog) {
  if (!name) return null;
  const first = name.split(/\s+or\s+/i)[0].trim().toLowerCase();
  const slug = slugify(first);
  const reversed = slugify(first.split(/\s+/).reverse().join(" "));
  return (catalog.find((c) => c.name.toLowerCase() === first) ?? catalog.find((c) => c.slug === slug) ?? catalog.find((c) => c.slug === reversed))?.slug ?? null;
}

/** Structure names, levels and costs, read once from the imported story journals. */
export async function buildStructureCatalog() {
  if (!isLeader()) return [];
  const journal = game.journal.find((j) => j.getFlag(FLAG_SCOPE, "category") === "structures");
  if (!journal) return [];
  const catalog = journal.pages.contents
    .map((page) => {
      const raw = page.getFlag(FLAG_SCOPE, "structure");
      if (!raw) return null;
      const slug = SLUG_FIXES[raw] ?? raw;
      const source = page.getFlag(FLAG_SCOPE, "source") ?? null;
      return { slug, name: page.name, source, art: structureArt(source, page.name), ...parseStructure(page) };
    })
    .filter(Boolean)
    .sort((a, b) => (a.level ?? 99) - (b.level ?? 99) || a.name.localeCompare(b.name));
  for (const entry of catalog) entry.upgradeFrom = resolveUpgrade(entry.upgradeFrom, catalog);
  await setSetting(SETTINGS.structureCatalog, catalog);
  return catalog;
}

export function structureCatalog() {
  return getSetting(SETTINGS.structureCatalog) ?? [];
}

/**
 * What can go up in a settlement now: within the kingdom's level, with room on the urban grid,
 * edifices and infrastructure only once. An upgrade replaces what it upgrades and costs the difference.
 */
export function buildableStructures(settlement = null) {
  const level = getKingdom()?.level ?? 1;
  const all = structureCatalog().filter((s) => s.bp && s.slug !== "rubble" && (!s.level || s.level <= level));
  if (!settlement) return all;
  const state = settlementState(settlement);
  const room = roomFor(settlement, state);
  const have = new Map();
  for (const b of settlement.buildings ?? []) have.set(b.slug, (have.get(b.slug) ?? 0) + 1);
  const out = [];
  for (const s of all.filter((x) => !x.capitalOnly || settlement.capital)) {
    const lots = s.infrastructure ? 0 : s.lots ?? 1;
    const once = s.edifice || s.infrastructure;
    if (!(once && have.has(s.slug)) && lots <= room) out.push({ ...s, key: s.slug, replaces: null, replacesName: null, cost: s.bp, needed: lots });
    const base = s.upgradeFrom && have.has(s.upgradeFrom) ? structureCatalog().find((c) => c.slug === s.upgradeFrom) : null;
    if (!base) continue;
    const needed = lots - (base.infrastructure ? 0 : base.lots ?? 1);
    if (needed > room) continue;
    out.push({ ...s, key: `${s.slug}>${base.slug}`, replaces: base.slug, replacesName: base.name, cost: Math.max(1, s.bp - (base.bp ?? 0)), needed });
  }
  return out;
}

/* ---------- Starting and finishing ---------- */

/**
 * Pay for a project and put it on its seat's desk, ready to hand to the
 * advisor or a PC like any other card.
 * request: { type, hexKey, structure, camp, userId }
 */
export async function startProject(request, { canActForSeat }) {
  const user = game.users.get(request.userId) ?? game.user;
  let def = getProject(request.type);
  if (def?.signature) {
    const seat = SEATS.find((s) => seatCompanionId(s) === def.companion);
    const usable = seat ? signatureForSeat(seat) : null;
    if (!usable?.available) return { ok: false, reason: "NotReady" };
    def = usable;
  }
  if (!def) return { ok: false, reason: "Unknown" };
  if (!canActForSeat(user, def.seat)) return { ok: false, reason: "NotYourSeat" };

  const realm = getRealm();
  if (!hasCapital(realm) && !def.signature) return { ok: false, reason: "NoCapital" };
  const targets = projectTargets(def, realm);
  const target =
    def.target === "settlement"
      ? targets.find((t) => t.settlementId === request.settlementId) ?? (targets.length === 1 ? targets[0] : null)
      : isHexProject(def)
        ? targets[0]
        : targets.find((t) => t.hexKey === (request.hexKey ?? null));
  if (!target) return { ok: false, reason: "NoTarget" };
  let structure = null;
  if (def.target === "settlement") {
    const settlement = settlements(realm).find((s) => s.id === target.settlementId);
    structure = buildableStructures(settlement).find((s) => s.key === request.structure);
    if (!structure) return { ok: false, reason: "NoStructure" };
  }
  let founding = null;
  if (def.id === "found-settlement") {
    const name = String(request.settlementName ?? "").trim().slice(0, 60);
    if (!name) return { ok: false, reason: "NoName" };
    if (settlements(realm).some((s) => s.name.toLowerCase() === name.toLowerCase())) return { ok: false, reason: "NameTaken" };
    founding = { name, waterside: !!request.waterside };
  }
  let camp = null;
  if (def.id === "establish-work-site") {
    camp = CAMPS.includes(request.camp) ? request.camp : CAMP_FOR_COMMODITY[target.commodity] ?? "lumber";
  }
  const where = isHexProject(def) ? String(request.where ?? "").trim().slice(0, 80) : "";
  const quote = projectQuote(def, target, structure);
  if (realm.treasury < quote.cost) return { ok: false, reason: "TooPoor", data: { cost: quote.cost } };

  const now = game.time.worldTime;
  const label = structure ? `${structure.name}, ${target.settlement}` : founding ? founding.name : where || target.label;
  const name = label ? `${def.name}: ${label}` : def.name;
  await updateRealm((r) => {
    r.treasury -= quote.cost;
    const card = {
      id: newId(),
      eventId: `project:${def.id}`,
      tier: null,
      matter: false,
      name,
      kind: "project",
      seat: def.seat,
      stage: 0,
      status: "open",
      drawnAt: now,
      deadline: now + NEVER * secondsPerDay(),
      target: { hexKey: target.hexKey, settlement: target.settlement ?? null, settlementId: target.settlementId ?? null, hidden: false },
      revealed: true,
      assignee: null,
      workUntil: null,
      months: 1,
      noteId: null,
      project: {
        type: def.id,
        cost: quote.cost,
        days: quote.days,
        camp,
        where,
        commodity: target.commodity ?? null,
        structure: structure ? { slug: structure.slug, name: structure.name, level: structure.level, skill: structure.skill, lots: structure.lots ?? 1, replaces: structure.replaces ?? null } : null,
        founding,
        by: user.id
      }
    };
    if (def.signature || def.cooldownDays) {
      r.cooldowns ??= {};
      r.cooldowns[def.id] = now + (def.cooldownDays ?? 30) * secondsPerDay();
    }
    r.cards.push(card);
    addLog(r, { type: "project-start", card: card.id, seat: def.seat, text: card.name, amount: -quote.cost });
  });
  await syncPins();
  return { ok: true, cost: quote.cost };
}

/** What the GM needs to do on the map once a project succeeds. */
function mapTask(card) {
  const p = card.project;
  const where = card.target?.hexKey
    ? hexLabel(card.target.hexKey)
    : p.where
      ? game.i18n.format("UKM.Project.PartyWhere", { where: p.where })
      : game.i18n.localize("UKM.Project.PartyHex");
  switch (p.type) {
    case "claim-hex":
      return game.i18n.format("UKM.Project.Task.claim", { where });
    case "build-road":
      return game.i18n.format("UKM.Project.Task.road", { where });
    case "establish-farmland":
      return game.i18n.format("UKM.Project.Task.farm", { where });
    case "establish-work-site":
      return game.i18n.format("UKM.Project.Task.camp", { where, camp: game.i18n.localize(`UKM.Project.Camp.${p.camp}`).toLowerCase() });
    case "fortify-hex":
      return game.i18n.format(card.target?.hexKey ? "UKM.Project.Task.fortify" : "UKM.Project.Task.fortifyPick", { where });
    case "found-settlement":
      return game.i18n.format("UKM.Project.Task.settlement", { name: p.founding?.name ?? "", where });
    default:
      return null;
  }
}

/** Called from the effects engine when a project's check succeeds. */
export function completeProject(ctx) {
  const card = ctx.card;
  if (!card?.project) return;
  const task = mapTask(card);
  if (task) ctx.gmTask(task);
  if (card.project.type === "fortify-hex" && card.target?.hexKey) {
    ctx.realm.fortified ??= [];
    ctx.realm.fortified.push(card.target.hexKey);
  }
  if (card.project.structure?.slug) {
    const settlementId = card.target?.settlementId;
    if (settlementId && addBuilding(ctx.realm, settlementId, card.project.structure, ctx)) {
      ctx.syncSettlements = true;
    } else {
      ctx.realm.structures ??= [];
      ctx.realm.structures.push(card.project.structure.slug);
    }
  }
  if (card.project.founding) {
    ctx.realm.settlements ??= [];
    if (!ctx.realm.settlements.some((s) => s.name.toLowerCase() === card.project.founding.name.toLowerCase())) {
      ctx.realm.settlements.push(newSettlement(card.project.founding));
      ctx.note(game.i18n.format("UKM.Settlement.Founded", { name: card.project.founding.name }));
      ctx.syncSettlements = true;
    }
  }
  ctx.realm.projectRecord ??= {};
  ctx.realm.projectRecord[card.project.type] = (ctx.realm.projectRecord[card.project.type] ?? 0) + 1;
  ctx.note(game.i18n.localize("UKM.Project.Done"));
  Hooks.callAll(`${MODULE_ID}.projectComplete`, { card });
}

/** The GM marks a hex fortified (or not) from the Kingmaker hex panel. */
export async function setFortified(hexKey, on) {
  const key = String(hexKey);
  await updateRealm((realm) => {
    const list = new Set(realm.fortified ?? []);
    if (on) list.add(key);
    else list.delete(key);
    realm.fortified = [...list];
  });
}

export function isFortified(hexKey, realm = getRealm()) {
  return (realm.fortified ?? []).includes(String(hexKey));
}

export function refundProject(ctx, share) {
  const cost = ctx.card?.project?.cost ?? 0;
  const amount = Math.floor(cost * share);
  if (!amount) return;
  ctx.realm.treasury += amount;
  ctx.note(game.i18n.format("UKM.Project.Refund", { amount }));
}
