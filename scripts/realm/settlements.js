import { MODULE_ID, RUINS, SKILL_TO_STAT } from "../constants.js";
import { getKingdom } from "../integrations/party.js";
import { getSetting, SETTINGS } from "../settings.js";
import { settlementHexes } from "./deck.js";
import { addLog, getRealm, newId, updateRealm } from "./state.js";
import { isLeader } from "./leader.js";

/** Settlement sizes, from the Kingmaker rules. Lots are what the urban grid can hold. */
export const SETTLEMENT_INFO = {
  village: { minLevel: 1, lots: 4, consumption: 1, maxItem: 1, growAt: 4, next: "town" },
  town: { minLevel: 3, lots: 16, consumption: 2, maxItem: 1, growAt: 8, next: "city" },
  city: { minLevel: 9, lots: 36, consumption: 4, maxItem: 2, growAt: 18, next: "metropolis" },
  metropolis: { minLevel: 15, lots: 72, consumption: 6, maxItem: 3, growAt: null, next: null }
};

export const SETTLEMENT_ORDER = ["village", "town", "city", "metropolis"];

const QUELL_SKILLS = ["arts", "folklore", "intrigue", "magic", "politics", "warfare"];

/** Which kingdom skills each tabletop activity is rolled with. */
const ACTIVITIES = [
  [/creative solution/i, ["scholarship"]],
  [/supernatural solution|prognostication/i, ["magic"]],
  [/celebrate holiday/i, ["folklore"]],
  [/create a masterpiece|craft luxuries/i, ["arts"]],
  [/provide care/i, ["defense"]],
  [/demolish/i, ["engineering"]],
  [/build structure/i, ["engineering", "industry"]],
  [/establish work site/i, ["industry", "engineering"]],
  [/harvest crops/i, ["agriculture"]],
  [/gather livestock/i, ["wilderness"]],
  [/go fishing/i, ["boating"]],
  [/hire adventurers/i, ["exploration"]],
  [/trade commodities/i, ["industry"]],
  [/purchase commodities|establish trade agreement|capital investment|collect taxes|tap treasury/i, ["trade"]],
  [/clandestine business|infiltration/i, ["intrigue"]],
  [/improve lifestyle|new leadership/i, ["politics"]],
  [/send diplomatic envoy|request foreign aid/i, ["statecraft"]],
  [/pledge of fealty/i, ["statecraft"], true],
  [/(garrison|recover|recruit|deploy|outfit|train) army/i, ["warfare"]],
  [/repair reputation \(corruption\)/i, ["arts"]],
  [/repair reputation \(crime\)/i, ["trade"]],
  [/repair reputation \(decay\)/i, ["engineering"]],
  [/repair reputation \(strife\)/i, ["intrigue"]],
  [/quell unrest/i, QUELL_SKILLS, true],
  [/rest and relax/i, ["arts", "boating", "exploration", "scholarship", "trade", "wilderness"], true]
];

function skillWord(word) {
  const slug = word?.toLowerCase();
  return slug && SKILL_TO_STAT[slug] ? slug : null;
}

/** "+1 item bonus to Quell Unrest using Magic" → [{ value: 1, skills: ["magic"] }] */
export function parseItemBonus(text) {
  if (!text) return [];
  const out = [];
  for (const segment of text.split(/(?=\+\d)/)) {
    const value = Number(segment.match(/^\+(\d+)/)?.[1]);
    if (!value) continue;
    if (/resolve events/i.test(segment)) {
      out.push({ value, skills: [], events: true });
      continue;
    }
    const skills = new Set();
    for (const [pattern, list, narrows] of ACTIVITIES) {
      const match = segment.match(pattern);
      if (!match) continue;
      let picked = null;
      if (narrows) {
        const after = segment.slice(match.index + match[0].length, match.index + match[0].length + 24);
        const before = segment.slice(Math.max(0, match.index - 30), match.index);
        picked = skillWord(after.match(/^\s*using\s+(\w+)/i)?.[1]) ?? skillWord(before.match(/(\w+)\s+checks\s+made\s+to\s+$/i)?.[1]);
      }
      for (const skill of picked ? [picked] : list) skills.add(skill);
    }
    if (skills.size) out.push({ value, skills: [...skills] });
  }
  return out;
}

function textOf(node) {
  return (node?.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** Read one structure page of the imported Structures journal. */
export function parseStructureHtml(html) {
  const div = document.createElement("div");
  div.innerHTML = (html ?? "").replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1");
  const fields = {};
  for (const p of div.querySelectorAll("p")) {
    const labels = [...p.querySelectorAll("strong")];
    if (!labels.length) continue;
    const text = textOf(p);
    labels.forEach((label, i) => {
      const name = textOf(label);
      const start = text.indexOf(name) + name.length;
      const end = labels[i + 1] ? text.indexOf(textOf(labels[i + 1]), start) : text.length;
      fields[name.toLowerCase()] = text.slice(start, end).replace(/;\s*$/, "").trim();
    });
  }
  const header = textOf(div.querySelector("header")) || textOf(div);
  const traits = [...div.querySelectorAll("ul li")].slice(0, 8).map((li) => textOf(li).toLowerCase());
  const found = header.match(/(?:Structure|Building)\s+(\d+)/i)?.[1];
  const lots = Number(fields.lots);
  const ruinText = fields.ruin ?? "";
  let ruin = null;
  if (/choice/i.test(ruinText)) ruin = { choice: Number(ruinText.match(/\d+/)?.[0] ?? 1) };
  else {
    const named = RUINS.find((r) => new RegExp(r, "i").test(ruinText));
    if (named) ruin = { [named]: Number(ruinText.match(/\d+/)?.[0] ?? 1) };
  }
  const effects = fields.effects ?? fields.effect ?? "";
  const consumption = /(reduce|reduces)[^.]*Consumption by (\d+)/i.exec(effects);
  return {
    level: found === undefined ? null : Number(found),
    costText: fields.cost ?? null,
    skill: (fields.construction ?? "").match(/^([A-Za-z]+)/)?.[1]?.toLowerCase() ?? null,
    lots: Number.isFinite(lots) ? lots : 0,
    infrastructure: traits.includes("infrastructure"),
    residential: traits.includes("residential"),
    edifice: traits.includes("edifice"),
    famous: traits.includes("famous") || traits.includes("infamous"),
    bonuses: parseItemBonus(fields["item bonus"]),
    bonusText: fields["item bonus"] ?? "",
    ruin,
    upgradeFrom: fields["upgrade from"] ?? null,
    unrest: Number(/reduce Unrest by (\d+)/i.exec(effects)?.[1] ?? 0),
    consumption: consumption ? Number(consumption[2]) : 0,
    needsWater: !!consumption && /water/i.test(effects),
    capitalOnly: /only be built in your capital/i.test(effects)
  };
}

/* ---------- Settlements in the realm ---------- */

export function settlements(realm = getRealm()) {
  return realm.settlements ?? [];
}

export function capital(realm = getRealm()) {
  return settlements(realm).find((s) => s.capital) ?? null;
}

export function hasCapital(realm = getRealm()) {
  return !!capital(realm);
}

export function catalogEntry(slug) {
  return (getSetting(SETTINGS.structureCatalog) ?? []).find((s) => s.slug === slug) ?? null;
}

function buildingInfo(building) {
  return { ...building, ...(catalogEntry(building.slug) ?? {}) };
}

/** Lots used, blocks touched, homes needed, and whether it's overcrowded. */
export function settlementState(settlement) {
  const info = SETTLEMENT_INFO[settlement.type] ?? SETTLEMENT_INFO.village;
  const buildings = (settlement.buildings ?? []).map(buildingInfo);
  const lots = buildings.reduce((sum, b) => sum + (b.infrastructure ? 0 : b.lots ?? 1), 0);
  const blocks = lots ? Math.ceil(lots / 4) : 0;
  const homes = buildings.filter((b) => b.residential).reduce((sum, b) => sum + (b.lots ?? 1), 0);
  const overcrowded = homes < blocks;
  const capacity = settlement.type === "metropolis" ? 36 * (settlement.grids ?? 2) : info.lots;
  let reduction = 0;
  const seen = new Set();
  for (const b of buildings) {
    if (!b.consumption || seen.has(b.slug) || (b.needsWater && !settlement.waterside)) continue;
    seen.add(b.slug);
    reduction += b.consumption;
  }
  return {
    info,
    buildings,
    lots,
    capacity,
    blocks,
    level: Math.max(1, Math.min(20, blocks)),
    homes,
    homesNeeded: blocks,
    overcrowded,
    consumption: Math.max(0, info.consumption - reduction),
    reduction
  };
}

/** The next size up, if the kingdom's level and the settlement allow it. */
export function canGrow(settlement, state = settlementState(settlement), level = getKingdom()?.level ?? 1) {
  const info = state.info;
  if (!info.next || state.overcrowded) return null;
  if (settlement.type === "metropolis") return null;
  const next = SETTLEMENT_INFO[info.next];
  if (level < next.minLevel || state.lots < info.growAt) return null;
  return info.next;
}

/** How many lots a new building could use, counting a growth step it would trigger. */
export function roomFor(settlement, state = settlementState(settlement)) {
  if (settlement.type === "metropolis") {
    const extra = state.lots >= state.capacity - 18 && !state.overcrowded ? 36 : 0;
    return state.capacity + extra - state.lots;
  }
  const next = canGrow(settlement, state);
  const capacity = next ? SETTLEMENT_INFO[next].lots : state.capacity;
  return capacity - state.lots;
}

/** Item bonuses a settlement's buildings give each kingdom skill, capped by its size. */
export function settlementBonuses(settlement, state = settlementState(settlement)) {
  const bySlug = new Map();
  for (const b of state.buildings) {
    const entry = bySlug.get(b.slug) ?? {};
    for (const bonus of b.bonuses ?? []) {
      if (bonus.events) continue;
      for (const skill of bonus.skills) entry[skill] = b.edifice ? Math.max(entry[skill] ?? 0, bonus.value) : (entry[skill] ?? 0) + bonus.value;
    }
    bySlug.set(b.slug, entry);
  }
  const out = {};
  for (const entry of bySlug.values()) {
    for (const [skill, value] of Object.entries(entry)) out[skill] = Math.max(out[skill] ?? 0, Math.min(value, state.info.maxItem));
  }
  return out;
}

function eventBonus(state) {
  const best = state.buildings.flatMap((b) => (b.bonuses ?? []).filter((x) => x.events).map((x) => x.value));
  return best.length ? Math.min(Math.max(...best), state.info.maxItem) : 0;
}

/** The settlement a card is about, if any. */
export function cardSettlement(card, realm = getRealm()) {
  const list = settlements(realm);
  if (card?.target?.settlementId) return list.find((s) => s.id === card.target.settlementId) ?? null;
  const name = card?.target?.settlement?.toLowerCase();
  return name ? list.find((s) => s.name.toLowerCase() === name) ?? null : null;
}

/** Item bonus from buildings on a kingdom check: the card's settlement, or the best one in the realm. */
export function structureModifiers(realm, card, skill) {
  const here = cardSettlement(card, realm);
  const pool = here ? [here] : settlements(realm);
  let best = 0;
  let from = null;
  for (const s of pool) {
    const state = settlementState(s);
    let value = settlementBonuses(s, state)[skill] ?? 0;
    if (here && s === here) value = Math.max(value, eventBonus(state));
    if (value > best) {
      best = value;
      from = s;
    }
  }
  if (!best) return [];
  return [{ slug: `ukm-structures-${skill}`, label: game.i18n.format("UKM.Settlement.BonusLabel", { name: from.name }), modifier: best, type: "item" }];
}

/** Every building slug in the realm, for events that ask "does the kingdom have a ...". */
export function builtSlugs(realm) {
  return settlements(realm).flatMap((s) => (s.buildings ?? []).map((b) => b.slug));
}

export function refreshDerived(realm) {
  if (settlements(realm).length || realm.settlementsStarted) realm.structures = builtSlugs(realm);
}

/** A settlement holding more than its size allows (placed by hand, or from before) grows to fit. */
export function fitSize(settlement) {
  let state = settlementState(settlement);
  while (state.lots > state.capacity && SETTLEMENT_INFO[settlement.type]?.next) {
    settlement.type = SETTLEMENT_INFO[settlement.type].next;
    state = settlementState(settlement);
  }
  if (settlement.type === "metropolis") {
    while (state.lots > state.capacity) {
      settlement.grids = (settlement.grids ?? 2) + 1;
      state = settlementState(settlement);
    }
  }
  return settlement;
}

/**
 * A settlement that meets the next size's requirements (kingdom level, lots built, enough homes)
 * becomes that size straight away. Returns the sizes it passed through.
 */
export function growIfReady(realm, settlement) {
  const grown = [];
  let next = canGrow(settlement);
  while (next && next !== settlement.type) {
    settlement.type = next;
    grown.push(next);
    addLog(realm, { type: "settlement-grew", text: `${settlement.name} (${game.i18n.localize(`UKM.Settlement.Type.${next}`)})` });
    next = canGrow(settlement);
  }
  return grown;
}

/** Grow every settlement that's ready, and say so in chat. */
export async function growSettlements() {
  if (!isLeader()) return;
  if (!settlements().some((s) => canGrow(s))) return;
  const news = [];
  await updateRealm((realm) => {
    for (const s of settlements(realm)) {
      for (const type of growIfReady(realm, s)) news.push(game.i18n.format("UKM.Settlement.Grew", { name: s.name, type: game.i18n.localize(`UKM.Settlement.Type.${type}`) }));
    }
  });
  if (!news.length) return;
  await syncKingdomSettlements();
  await ChatMessage.create({
    speaker: { alias: getKingdom()?.name || game.i18n.localize("UKM.Manager.Unnamed") },
    content: `<div class="ukm-chat">${news.map((n) => `<p>${Handlebars.escapeExpression(n)}</p>`).join("")}</div>`
  });
}

/** Run once when the GM's window starts: fix any settlement that's too small for what's in it. */
export async function repairSettlements() {
  if (!isLeader()) return;
  const realm = getRealm();
  const needs = settlements(realm).some((s) => settlementState(s).lots > settlementState(s).capacity || canGrow(s));
  if (!needs && (realm.settlementsStarted || !settlements(realm).length)) return;
  await updateRealm((r) => {
    for (const s of settlements(r)) {
      fitSize(s);
      growIfReady(r, s);
    }
    if (settlements(r).length) r.settlementsStarted = true;
    refreshDerived(r);
  });
  await syncKingdomSettlements();
}

/** Map hex of a settlement, matched by the name the GM gave it on the Kingmaker map. */
export function settlementHex(settlement) {
  if (settlement.hexKey) return settlement.hexKey;
  const name = settlement.name.toLowerCase();
  return settlementHexes().find((h) => h.name?.toLowerCase() === name)?.key ?? null;
}

/** Settlements drawn on the map that the realm doesn't know about yet. */
export function unknownMapSettlements(realm = getRealm()) {
  const names = new Set(settlements(realm).map((s) => s.name.toLowerCase()));
  return settlementHexes().filter((h) => h.name && !names.has(h.name.toLowerCase()));
}

export function newSettlement({ name, type = "village", capital = false, waterside = false, hexKey = null }) {
  return {
    id: newId(),
    name: name.trim().slice(0, 60),
    type: SETTLEMENT_ORDER.includes(type) ? type : "village",
    capital,
    waterside: !!waterside,
    hexKey,
    buildings: [],
    founded: game.time.worldTime
  };
}

/** Put a finished building in a settlement, replacing what it upgrades, and grow the settlement if it needs to. */
export function addBuilding(realm, settlementId, structure, ctx = null) {
  const settlement = settlements(realm).find((s) => s.id === settlementId);
  if (!settlement) return null;
  const before = settlementState(settlement);
  const grow = canGrow(settlement, before);
  settlement.buildings ??= [];
  if (structure.replaces) {
    const index = settlement.buildings.findIndex((b) => b.slug === structure.replaces);
    if (index >= 0) settlement.buildings.splice(index, 1);
  }
  settlement.buildings.push({ slug: structure.slug, name: structure.name, lots: structure.lots ?? 1, built: game.time.worldTime });
  let after = settlementState(settlement);
  if (settlement.type === "metropolis" && after.lots > after.capacity) settlement.grids = (settlement.grids ?? 2) + 1;
  if (grow && after.lots > before.capacity) settlement.type = grow;
  for (const type of growIfReady(realm, settlement)) {
    ctx?.note(game.i18n.format("UKM.Settlement.Grew", { name: settlement.name, type: game.i18n.localize(`UKM.Settlement.Type.${type}`) }));
  }
  after = settlementState(settlement);
  const info = catalogEntry(structure.slug) ?? structure;
  if (ctx) {
    if (info.unrest) ctx.unrest -= info.unrest;
    if (info.famous) ctx.fame += 1;
    if (info.ruin?.choice) {
      const lowest = RUINS.slice().sort((a, b) => (getKingdom()?.ruin?.[a]?.value ?? 0) - (getKingdom()?.ruin?.[b]?.value ?? 0))[0];
      ctx.ruin[lowest] += info.ruin.choice;
    } else if (info.ruin) {
      for (const [ruin, amount] of Object.entries(info.ruin)) if (RUINS.includes(ruin)) ctx.ruin[ruin] += amount;
    }
    if (after.overcrowded && !before.overcrowded) ctx.note(game.i18n.format("UKM.Settlement.NowOvercrowded", { name: settlement.name }));
  }
  refreshDerived(realm);
  return settlement;
}

export function removeBuilding(realm, settlementId, index) {
  const settlement = settlements(realm).find((s) => s.id === settlementId);
  if (!settlement?.buildings?.[index]) return;
  settlement.buildings.splice(index, 1);
  refreshDerived(realm);
}

/* ---------- Founding ---------- */

/**
 * The party's first step: name the capital. It can be a settlement already on the map,
 * or a new village the GM then draws on the hex the party picked.
 * request: { name, mapHex, waterside, where, userId }
 */
export async function foundCapital(request) {
  const user = game.users.get(request.userId) ?? game.user;
  if (!canFoundCapital(user)) return { ok: false, reason: "NotYourSeat" };
  const realm = getRealm();
  if (hasCapital(realm)) return { ok: false, reason: "HasCapital" };
  const fromMap = request.mapHex ? settlementHexes().find((h) => h.key === String(request.mapHex)) : null;
  const name = (fromMap?.name ?? request.name ?? "").trim();
  if (!name) return { ok: false, reason: "NoName" };
  const where = String(request.where ?? "").trim().slice(0, 80);

  await updateRealm((r) => {
    r.settlements ??= [];
    let record = r.settlements.find((s) => s.name.toLowerCase() === name.toLowerCase());
    if (!record) {
      record = newSettlement({ name, type: fromMap?.type ?? "village", waterside: request.waterside, hexKey: fromMap?.key ?? null });
      r.settlements.push(record);
    }
    record.capital = true;
    if (request.waterside !== undefined && !fromMap) record.waterside = !!request.waterside;
    if (!r.settlementsStarted) {
      for (const slug of r.structures ?? []) {
        if (record.buildings.some((b) => b.slug === slug)) continue;
        const entry = catalogEntry(slug);
        if (entry) record.buildings.push({ slug, name: entry.name, lots: entry.lots ?? 1, built: game.time.worldTime });
      }
    }
    r.settlementsStarted = true;
    fitSize(record);
    if (!fromMap) {
      const place = where ? game.i18n.format("UKM.Project.PartyWhere", { where }) : game.i18n.localize("UKM.Project.PartyHex");
      r.gmTasks.push({ id: newId(), text: game.i18n.format("UKM.Settlement.CapitalTask", { name, where: place }), card: null, hexKey: null, created: game.time.worldTime, done: false });
    }
    addLog(r, { type: "capital", text: name });
    refreshDerived(r);
  });
  await syncKingdomSettlements();
  const kingdom = getKingdom();
  if (kingdom) await kingdom.update({ capital: name });
  await ChatMessage.create({
    speaker: { alias: kingdom?.name || game.i18n.localize("UKM.Manager.Unnamed") },
    content: `<div class="ukm-chat"><h3>${game.i18n.format("UKM.Settlement.CapitalChatTitle", { name: Handlebars.escapeExpression(name) })}</h3><p>${game.i18n.localize("UKM.Settlement.CapitalChat")}</p></div>`
  });
  Hooks.callAll(`${MODULE_ID}.capitalFounded`, { name });
  return { ok: true };
}

/** The Ruler's player founds the capital; with no Ruler yet, any player with a character in the party can. */
export function canFoundCapital(user) {
  if (user.isGM) return true;
  const kingdom = getKingdom();
  const rulerUuid = kingdom?.leadership?.ruler?.uuid;
  const ruler = rulerUuid ? fromUuidSync(rulerUuid) : null;
  if (ruler) return !!ruler.testUserPermission?.(user, "OWNER");
  return game.actors.some((a) => a.type === "character" && a.testUserPermission?.(user, "OWNER"));
}

/** Settlements the GM drew on the map after the capital was set join the realm on their own. */
export async function adoptMapSettlements() {
  if (!isLeader()) return;
  const realm = getRealm();
  if (!hasCapital(realm)) return;
  const fresh = unknownMapSettlements(realm);
  if (!fresh.length) return;
  await updateRealm((r) => {
    for (const hex of fresh) {
      r.settlements.push(newSettlement({ name: hex.name, type: hex.type, hexKey: hex.key }));
      r.settlementsStarted = true;
      addLog(r, { type: "settlement", text: hex.name });
    }
  });
  await syncKingdomSettlements();
}

/** Mirror the realm's settlements onto the PF2e kingdom so its sheet and Consumption match. */
export async function syncKingdomSettlements() {
  const kingdom = getKingdom();
  if (!kingdom || !isLeader()) return;
  const update = {};
  for (const s of settlements()) {
    const state = settlementState(s);
    update[`settlements.${s.id}`] = {
      name: s.name,
      type: s.type,
      level: state.level,
      overcrowded: state.overcrowded,
      consumption: { reduction: state.reduction }
    };
  }
  if (Object.keys(update).length) await kingdom.update(update);
}

/** Overcrowded settlements each add 1 Unrest a month. */
export function overcrowdedCount(realm) {
  return settlements(realm).filter((s) => settlementState(s).overcrowded).length;
}
