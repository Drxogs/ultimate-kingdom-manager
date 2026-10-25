import { COMMODITY_BP, FLAG_SCOPE, MODULE_ID } from "../constants.js";
import { getCompanion, getProject, getProjects, getSignature } from "../content/data.js";
import {
  getAllHexStates,
  getClaimedHexes,
  getHexDefinitions,
  getZone,
  hasFeature,
  isKingmakerActive
} from "../integrations/kingmaker.js";
import { getKingdom, getPartyLevel } from "../integrations/party.js";
import { getSetting, setSetting, SETTINGS } from "../settings.js";
import { neighbors, settlementHexes } from "./deck.js";
import { weeklyIncome } from "./rules.js";
import { addLog, getRealm, newId, updateRealm } from "./state.js";
import { secondsPerDay } from "./time.js";

const NEVER = 3650;
const CAMPS = ["quarry", "mine", "lumber"];
const CAMP_FOR_COMMODITY = { stone: "quarry", ore: "mine", lumber: "lumber" };
const SETTLEMENT_TYPES = ["village", "town", "city", "metropolis"];

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

function activeTargets(realm) {
  return new Set(
    realm.cards
      .filter((c) => c.project && ["open", "assigned", "rolled", "escalated"].includes(c.status))
      .map((c) => `${c.project.type}:${c.target?.hexKey}`)
  );
}

/** Where a project of this kind could go right now. */
export function projectTargets(def, realm = getRealm()) {
  if (!isKingmakerActive()) return [];
  const defs = definitions();
  const claimed = getClaimedHexes();
  const taken = activeTargets(realm);
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
    case "claimed-no-camp":
      hexes = claimed.filter((h) => !h.camp && !isSettlement(h));
      break;
    case "none":
      return [{ hexKey: null, label: "", factor: 1 }];
    case "settlement":
      return settlementHexes().map((s) => ({
        hexKey: s.key,
        settlement: s.name ?? game.i18n.localize(`UKM.Project.Settlement.${s.type}`),
        label: `${s.name ?? game.i18n.localize(`UKM.Project.Settlement.${s.type}`)} (${hexLabel(s.key, defs)})`,
        factor: 1
      }));
    default:
      hexes = [];
  }

  return hexes
    .filter((h) => !taken.has(`${def.id}:${h.key}`))
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
  if (def.target === "none") return { cost: def.costBP ?? 0, days: def.workDays ?? 7 };
  if (def.target === "settlement") {
    const bp = structure?.bp ?? Math.max(4, (structure?.level ?? 1) * 6);
    const days = def.workDays + Math.max(0, (structure?.level ?? 1) - 4);
    return { cost: bp, days };
  }
  return { cost: Math.max(1, Math.round(baseCost(def) * factor)), days: Math.max(3, Math.round(def.workDays * factor)) };
}

/** The signature ability of the companion advising a seat, if they have one and it's usable now. */
export function signatureForSeat(seat, realm = getRealm()) {
  const companionId = getSetting(SETTINGS.seatAssignments)?.[seat]?.companion;
  const def = companionId ? getSignature(companionId) : null;
  if (!def) return null;
  if (def.requiresSeat && !getCompanion(companionId)?.seats?.includes(seat)) return null;
  const readyAt = realm.cooldowns?.[def.id] ?? 0;
  const busy = realm.cards.some((c) => c.eventId === `project:${def.id}` && ["open", "assigned", "rolled"].includes(c.status));
  return { ...def, seat, readyAt, available: !busy && readyAt <= game.time.worldTime };
}

export function projectsForSeat(seat) {
  const list = getProjects().filter((p) => p.seat === seat);
  const signature = signatureForSeat(seat);
  if (signature?.available) list.push(signature);
  return list;
}

/* ---------- Structures ---------- */

function plainText(html) {
  const div = document.createElement("div");
  div.innerHTML = html ?? "";
  return (div.textContent ?? "").replace(/\s+/g, " ").trim();
}

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

function parseStructure(page) {
  const text = plainText(page.text?.content);
  const level = Number(text.match(/Structure\s+(\d+)/i)?.[1]) || null;
  const costText = text.match(/Cost\s+(.+?)(?:;|Construction|Upgrade|Ruin|Item Bonus|$)/i)?.[1] ?? null;
  const skill = text.match(/Construction\s+([A-Za-z]+)/i)?.[1]?.toLowerCase() ?? null;
  const lots = Number(text.match(/Lots?\s+(\d+)/i)?.[1]) || null;
  return { level, bp: costToBP(costText), skill, lots };
}

/** Structure names, levels and costs, read once from the imported story journals. */
export async function buildStructureCatalog() {
  if (!game.user.isActiveGM) return [];
  const journal = game.journal.find((j) => j.getFlag(FLAG_SCOPE, "category") === "structures");
  if (!journal) return [];
  const catalog = journal.pages.contents
    .map((page) => {
      const slug = page.getFlag(FLAG_SCOPE, "structure");
      if (!slug) return null;
      return { slug, name: page.name, ...parseStructure(page) };
    })
    .filter(Boolean)
    .sort((a, b) => (a.level ?? 99) - (b.level ?? 99) || a.name.localeCompare(b.name));
  await setSetting(SETTINGS.structureCatalog, catalog);
  return catalog;
}

export function structureCatalog() {
  return getSetting(SETTINGS.structureCatalog) ?? [];
}

export function buildableStructures() {
  const level = getKingdom()?.level ?? 1;
  return structureCatalog().filter((s) => !s.level || s.level <= level);
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
    const seat = Object.entries(getSetting(SETTINGS.seatAssignments) ?? {}).find(([, a]) => a?.companion === def.companion)?.[0];
    const usable = seat ? signatureForSeat(seat) : null;
    if (!usable?.available) return { ok: false, reason: "NotReady" };
    def = usable;
  }
  if (!def) return { ok: false, reason: "Unknown" };
  if (!canActForSeat(user, def.seat)) return { ok: false, reason: "NotYourSeat" };

  const realm = getRealm();
  const target = projectTargets(def, realm).find((t) => t.hexKey === (request.hexKey ?? null));
  if (!target) return { ok: false, reason: "NoTarget" };
  let structure = null;
  if (def.target === "settlement") {
    structure = buildableStructures().find((s) => s.slug === request.structure);
    if (!structure) return { ok: false, reason: "NoStructure" };
  }
  let camp = null;
  if (def.id === "establish-work-site") {
    camp = CAMPS.includes(request.camp) ? request.camp : CAMP_FOR_COMMODITY[target.commodity] ?? "lumber";
  }
  const quote = projectQuote(def, target, structure);
  if (realm.treasury < quote.cost) return { ok: false, reason: "TooPoor", data: { cost: quote.cost } };

  const now = game.time.worldTime;
  const label = structure ? `${structure.name}, ${target.settlement}` : target.label;
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
      target: { hexKey: target.hexKey, settlement: target.settlement ?? null, hidden: false },
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
        commodity: target.commodity ?? null,
        structure: structure ? { slug: structure.slug, name: structure.name, level: structure.level, skill: structure.skill } : null,
        by: user.id
      }
    };
    if (def.signature) {
      r.cooldowns ??= {};
      r.cooldowns[def.id] = now + (def.cooldownDays ?? 30) * secondsPerDay();
    }
    r.cards.push(card);
    addLog(r, { type: "project-start", card: card.id, seat: def.seat, text: card.name, amount: -quote.cost });
  });
  return { ok: true, cost: quote.cost };
}

/** What the GM needs to do on the map once a project succeeds. */
function mapTask(card) {
  const p = card.project;
  const where = hexLabel(card.target?.hexKey);
  switch (p.type) {
    case "claim-hex":
      return game.i18n.format("UKM.Project.Task.claim", { where });
    case "build-road":
      return game.i18n.format("UKM.Project.Task.road", { where });
    case "establish-farmland":
      return game.i18n.format("UKM.Project.Task.farm", { where });
    case "establish-work-site":
      return game.i18n.format("UKM.Project.Task.camp", { where, camp: game.i18n.localize(`UKM.Project.Camp.${p.camp}`) });
    case "build-structure":
      return game.i18n.format("UKM.Project.Task.structure", { name: p.structure?.name ?? "", where: card.target?.settlement ?? where });
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
  if (card.project.structure?.slug) {
    ctx.realm.structures ??= [];
    ctx.realm.structures.push(card.project.structure.slug);
  }
  ctx.realm.projectRecord ??= {};
  ctx.realm.projectRecord[card.project.type] = (ctx.realm.projectRecord[card.project.type] ?? 0) + 1;
  ctx.note(game.i18n.localize("UKM.Project.Done"));
  Hooks.callAll(`${MODULE_ID}.projectComplete`, { card });
}

export function refundProject(ctx, share) {
  const cost = ctx.card?.project?.cost ?? 0;
  const amount = Math.floor(cost * share);
  if (!amount) return;
  ctx.realm.treasury += amount;
  ctx.note(game.i18n.format("UKM.Project.Refund", { amount }));
}
