import { DEGREE_POINTS, DEGREES, HIRED_PENALTY, LEVEL_DC, MODULE_ID, SEATS, SKILL_ABILITY, SKILL_TO_STAT } from "../constants.js";
import { getCardEvent, getCompanion, getEvent, getStory } from "../content/data.js";
import { getControlDC, getFame, getKingdom, getPartyLevel, getPlayerCharacters } from "../integrations/party.js";
import { getSetting, SETTINGS } from "../settings.js";
import { createCard } from "./deck.js";
import { applyEffects, commitKingdomChanges, describeEffect, EffectContext } from "./effects.js";
import { addStatPoints, cardWorkDays, isHired, rankBonus, seatCompanionId, weeklyIncome } from "./rules.js";
import { addLog, getRealm, updateRealm } from "./state.js";
import { secondsPerDay } from "./time.js";
import { isLeader } from "./leader.js";
import { structureModifiers } from "./settlements.js";
import { inAnarchy } from "./standing.js";

const ACTIVE = ["open", "assigned", "rolled"];

const loc = (key, data) => (data ? game.i18n.format(`UKM.Resolve.${key}`, data) : game.i18n.localize(`UKM.Resolve.${key}`));

export function cardStage(card) {
  const event = getCardEvent(card);
  const stage = event?.stages?.[card.stage ?? 0] ?? null;
  return {
    event,
    stage,
    skills: stage?.skill ?? event?.skill ?? [],
    outcomes: stage?.outcomes ?? event?.outcomes ?? {}
  };
}

export function cardLevelMod(card, realm = getRealm()) {
  const event = getCardEvent(card);
  return (event?.mod ?? 0) + (realm.levelModBoosts?.[card.eventId] ?? 0);
}

function assigneeKey(assignee) {
  if (!assignee) return null;
  return assignee.type === "pc" ? assignee.actorUuid : `seat:${assignee.seat}`;
}

/** Who is already working a card. An advisor or PC takes on one card at a time. */
export function busyWith(realm, key) {
  const card = realm.cards.find((c) => c.status === "assigned" && assigneeKey(c.assignee) === key);
  if (card) return card;
  if (key?.startsWith("seat:")) {
    const seat = key.slice(5);
    const lent = realm.cards.find((c) => c.status === "assigned" && c.assignee?.lockSeats?.includes(seat));
    if (lent) return lent;
  }
  const project = realm.projects.find((p) => p.status === "working" && `seat:${p.seat}` === key);
  return project ? { name: project.name } : null;
}

/** The seats a character holds or supervises. */
export function seatsOf(actorUuid) {
  const leadership = getKingdom()?.leadership ?? {};
  const assignments = getSetting(SETTINGS.seatAssignments) ?? {};
  return SEATS.filter((seat) => leadership[seat]?.uuid === actorUuid || assignments[seat]?.supervisor === actorUuid);
}

/** Whether a user may call back a card's work: the desk's player, or the player of a character lent to it. */
export function canCallBack(user, card) {
  if (canActForSeat(user, card.seat)) return true;
  if (card.assignee?.type !== "pc") return false;
  return !!fromUuidSync(card.assignee.actorUuid)?.testUserPermission?.(user, "OWNER");
}

/** Whether a user may act for a seat: the GM, an owner of the seat holder, or the seat's supervising player. */
export function canActForSeat(user, seat) {
  if (user.isGM) return true;
  const leaderUuid = getKingdom()?.leadership?.[seat]?.uuid;
  const leader = leaderUuid ? fromUuidSync(leaderUuid) : null;
  const supervisorUuid = getSetting(SETTINGS.seatAssignments)?.[seat]?.supervisor;
  const supervisor = supervisorUuid ? fromUuidSync(supervisorUuid) : null;
  return [leader, supervisor].some((actor) => actor?.testUserPermission?.(user, "OWNER"));
}

function seatHolderName(seat) {
  const leaderUuid = getKingdom()?.leadership?.[seat]?.uuid;
  const leader = leaderUuid ? fromUuidSync(leaderUuid) : null;
  if (leader) return leader.name;
  const companionId = seatCompanionId(seat);
  if (companionId) return getCompanion(companionId)?.name ?? null;
  return isHired(seat) ? game.i18n.localize("UKM.Hired.Name") : null;
}

function hiredOnly(seat) {
  const kingdom = getKingdom();
  return isHired(seat) && !kingdom?.leadership?.[seat]?.uuid;
}

/**
 * Hand a card to its seat's advisor or to a PC. Runs on the active GM.
 * request: { cardId, type: "advisor" | "pc", actorUuid, skill, personalSkill, userId }
 */
export async function assignCard(request) {
  const user = game.users.get(request.userId) ?? game.user;
  const realm = getRealm();
  const card = realm.cards.find((c) => c.id === request.cardId);
  if (!card || card.status !== "open") return { ok: false, reason: "NotOpen" };
  if (!canActForSeat(user, card.seat)) return { ok: false, reason: "NotYourSeat" };

  const { skills } = cardStage(card);
  const skill = skills.includes(request.skill) ? request.skill : skills[0];
  let assignee;

  if (request.type === "pc" && cardStage(card).event?.advisorOnly) return { ok: false, reason: "AdvisorOnly" };
  if (request.type === "pc") {
    const actor = fromUuidSync(request.actorUuid);
    const inParty = getPlayerCharacters().some((a) => a.uuid === actor?.uuid);
    if (!actor || (!inParty && !user.isGM && !actor.testUserPermission(user, "OWNER"))) return { ok: false, reason: "NotYourCharacter" };
    if (!actor.skills?.[request.personalSkill]) return { ok: false, reason: "NoSkill" };
    assignee = { type: "pc", actorUuid: actor.uuid, name: actor.name, skill, personalSkill: request.personalSkill };
    const own = seatsOf(actor.uuid);
    if (!own.includes(card.seat)) {
      const lockSeats = [card.seat, ...own];
      for (const seat of lockSeats) {
        const busy = busyWith(realm, `seat:${seat}`);
        if (busy) return { ok: false, reason: "DeskBusy", data: { desk: game.i18n.localize(`UKM.Seat.${seat}`), card: busy.name } };
      }
      assignee.lockSeats = lockSeats;
      assignee.helping = true;
    }
  } else {
    const event = cardStage(card).event;
    const name = event?.signature ? getCompanion(seatCompanionId(card.seat))?.name ?? seatHolderName(card.seat) : seatHolderName(card.seat);
    if (!name) return { ok: false, reason: "SeatVacant" };
    assignee = { type: "advisor", seat: card.seat, name, skill };
  }

  const lent = realm.cards.find((c) => c.status === "assigned" && c.assignee?.lockSeats?.includes(card.seat));
  if (lent) return { ok: false, reason: "DeskBusy", data: { desk: game.i18n.localize(`UKM.Seat.${card.seat}`), card: lent.name } };
  const busy = busyWith(realm, assigneeKey(assignee));
  if (busy) return { ok: false, reason: "Busy", data: { name: assignee.name, card: busy.name } };

  const days = card.project?.days ?? cardWorkDays(cardLevelMod(card, realm));
  await updateRealm((r) => {
    const target = r.cards.find((c) => c.id === card.id);
    if (!target || target.status !== "open") return;
    target.status = "assigned";
    target.assignee = { ...assignee, by: user.id };
    target.assignedAt = game.time.worldTime;
    target.workUntil = game.time.worldTime + days * secondsPerDay();
    addLog(r, { type: "card-assigned", card: card.id, seat: card.seat, text: `${card.name} — ${assignee.name}` });
  });
  if (assignee.helping) {
    const desks = assignee.lockSeats.map((s) => game.i18n.localize(`UKM.Seat.${s}`)).join(", ");
    await ChatMessage.create({
      speaker: { alias: getKingdom()?.name || game.i18n.localize("UKM.Manager.Unnamed") },
      content: `<div class="ukm-chat"><h3>${Handlebars.escapeExpression(card.name)}</h3><p>${game.i18n.format("UKM.Card.HelpingChat", { name: Handlebars.escapeExpression(assignee.name), seat: game.i18n.localize(`UKM.Seat.${card.seat}`), days, desks })}</p></div>`
    });
  }
  return { ok: true, days };
}

export async function unassignCard({ cardId, userId }) {
  const user = game.users.get(userId) ?? game.user;
  const card = getRealm().cards.find((c) => c.id === cardId);
  if (!card || card.status !== "assigned" || !canCallBack(user, card)) return { ok: false, reason: "NotAssigned" };
  await updateRealm((r) => {
    const target = r.cards.find((c) => c.id === cardId);
    target.status = "open";
    target.assignee = null;
    target.workUntil = null;
  });
  return { ok: true };
}

/** Send a card to the table: the party deals with it in play, and the GM records the result. */
export async function escalateCard({ cardId, userId }) {
  const user = game.users.get(userId) ?? game.user;
  const card = getRealm().cards.find((c) => c.id === cardId);
  if (!card || !["open", "assigned"].includes(card.status) || !canActForSeat(user, card.seat)) return { ok: false, reason: "NotOpen" };
  await updateRealm((r) => {
    const target = r.cards.find((c) => c.id === cardId);
    target.status = "escalated";
    target.assignee = null;
    target.workUntil = null;
    target.pausedDays = Math.max(0, Math.ceil((target.deadline - game.time.worldTime) / secondsPerDay()));
    addLog(r, { type: "card-escalated", card: cardId, seat: card.seat, text: card.name });
  });
  return { ok: true };
}

function timedModifiers(realm, skill, eventId) {
  const now = game.time.worldTime;
  const ability = SKILL_ABILITY[skill];
  return realm.timedModifiers
    .filter((m) => m.expires > now)
    .filter((m) => [m.selector].flat().some((s) => s === "events" || s === ability || s === skill))
    .map((m) => ({ slug: `ukm-${m.id}`, label: m.label, modifier: m.value, type: m.type }));
}

function companionModifiers(realm, card) {
  const eventId = card.eventId;
  const seat = card.seat;
  const companionId = seatCompanionId(seat);
  const companion = companionId ? getCompanion(companionId) : null;
  if (!companion) return [];
  const mods = [];
  const level = getPartyLevel();
  if (companion.seats?.includes(seat)) {
    mods.push({ slug: `ukm-advisor-${companion.id}`, label: companion.name, modifier: level >= 16 ? 3 : level >= 8 ? 2 : 1, type: "status" });
  }
  for (const bonus of companion.eventBonus ?? []) {
    if (bonus.event === eventId) mods.push({ slug: `ukm-advisor-${companion.id}-${eventId}`, label: companion.name, modifier: bonus.value, type: bonus.type });
  }
  return mods;
}

function advisorModifiers(realm, card, stat) {
  const mods = companionModifiers(realm, card);
  if (hiredOnly(card.seat)) mods.push({ slug: "ukm-hired", label: game.i18n.localize("UKM.Hired.Name"), modifier: HIRED_PENALTY, type: "untyped" });
  const bonus = rankBonus(realm.stats[stat]?.rank ?? 0);
  if (bonus) mods.push({ slug: `ukm-rank-${stat}`, label: game.i18n.format("UKM.Bonus.RankLabel", { stat: game.i18n.localize(`UKM.Stat.${stat}`) }), modifier: bonus, type: "circumstance" });
  return mods;
}

/** Highest of each bonus type and lowest of each penalty type, as PF2e stacks them. */
function stackedTotal(list) {
  const best = {};
  let untyped = 0;
  for (const m of list) {
    if (!m.type || m.type === "untyped") {
      untyped += m.modifier;
      continue;
    }
    const key = `${m.type}:${m.modifier >= 0 ? "bonus" : "penalty"}`;
    best[key] = key.endsWith("bonus") ? Math.max(best[key] ?? 0, m.modifier) : Math.min(best[key] ?? 0, m.modifier);
  }
  return untyped + Object.values(best).reduce((a, b) => a + b, 0);
}

/** Chance of at least a success on d20 + mod against dc, with PF2e's natural 1 and 20 rules. */
export function successChance(mod, dc) {
  let hits = 0;
  for (let die = 1; die <= 20; die++) {
    const total = die + mod;
    let degree = total >= dc + 10 ? 3 : total >= dc ? 2 : total <= dc - 10 ? 0 : 1;
    if (die === 20) degree = Math.min(3, degree + 1);
    if (die === 1) degree = Math.max(0, degree - 1);
    if (degree >= 2) hits++;
  }
  return hits / 20;
}

export function difficultyLabel(chance) {
  if (chance >= 0.8) return "veryEasy";
  if (chance >= 0.6) return "easy";
  if (chance >= 0.4) return "even";
  if (chance >= 0.2) return "hard";
  return "veryHard";
}

/**
 * How a check would likely go before anyone commits to it.
 * choice: { type: "advisor", skill } or { type: "pc", actorUuid, personalSkill }
 */
export function estimateCheck(card, choice, realm = getRealm()) {
  const kingdom = getKingdom();
  const skill = choice.skill ?? cardStage(card).skills[0];
  const mod = cardLevelMod(card, realm) + (card.dcAdjust ?? 0);
  const extras = timedModifiers(realm, skill, card.eventId);
  let base;
  let dc;
  let personal = false;
  if (choice.type === "pc") {
    const statistic = fromUuidSync(choice.actorUuid)?.skills?.[choice.personalSkill];
    if (!statistic) return null;
    base = statistic.mod;
    extras.push(...structureModifiers(realm, card, skill));
    dc = (LEVEL_DC[Math.clamp(kingdom?.level ?? 1, 0, 20)] ?? 14) + mod;
    personal = true;
  } else {
    const statistic = kingdom?.skills?.[skill];
    if (!statistic) return null;
    base = statistic.mod;
    extras.push(...advisorModifiers(realm, card, SKILL_TO_STAT[skill]), ...structureModifiers(realm, card, skill));
    dc = getControlDC() + mod;
  }
  const total = base + stackedTotal(extras);
  const chance = successChance(total, dc);
  const key = difficultyLabel(chance);
  return { skill, total, dc, chance, personal, key, label: game.i18n.localize(`UKM.Difficulty.${key}`) };
}

/** Rerolls the realm holds for a skill (a reroll with no skills listed works on any check). */
export function fortunesFor(realm, skill) {
  const now = game.time.worldTime;
  return (realm.fortunes ?? []).filter((f) => f.expires > now && f.uses > 0 && (!(f.skills ?? []).length || f.skills.includes(skill)));
}

export function fortuneUses(realm, skill) {
  return fortunesFor(realm, skill).reduce((n, f) => n + f.uses, 0);
}

function takeFortune(realm, skill) {
  const now = game.time.worldTime;
  const fortune = fortunesFor(realm, skill).sort((a, b) => a.expires - b.expires)[0];
  if (!fortune) return false;
  fortune.uses -= 1;
  realm.fortunes = realm.fortunes.filter((f) => f.uses > 0 && f.expires > now);
  return true;
}

/** Spend 1 Fame to reroll a waiting result, as the book allows. The new result stands. */
export async function useFame({ cardId, userId }) {
  const user = game.users.get(userId) ?? game.user;
  const card = getRealm().cards.find((c) => c.id === cardId);
  if (!card || card.status !== "rolled" || !card.pendingRoll) return { ok: false, reason: "NotRolled" };
  if (!canCallBack(user, card)) return { ok: false, reason: "NotYourSeat" };
  if (card.pendingRoll.fortuneUsed) return { ok: false, reason: "AlreadyRerolled" };
  const kingdom = getKingdom();
  const fame = getFame();
  if (!kingdom || fame.value < 1) return { ok: false, reason: "NoFame" };
  await kingdom.update({ "resources.fame.value": fame.value - 1 });
  let done = false;
  await updateRealm(async (realm) => {
    const target = realm.cards.find((c) => c.id === cardId);
    if (!target?.pendingRoll) return;
    const check = await rollCheck(target, realm, { reroll: true });
    if (!check) return;
    target.pendingRoll = { ...check, rolledAt: game.time.worldTime, fortuneUsed: true };
    done = true;
  });
  if (!done) return { ok: false, reason: "NoReroll" };
  await handRollToPlayer(card);
  return { ok: true };
}

/**
 * Spend one of the realm's rerolls on a result that's waiting to be accepted.
 * The check is rolled again and the new result stands (one reroll per check).
 */
export async function useFortune({ cardId, userId }) {
  const user = game.users.get(userId) ?? game.user;
  const card = getRealm().cards.find((c) => c.id === cardId);
  if (!card || card.status !== "rolled" || !card.pendingRoll) return { ok: false, reason: "NotRolled" };
  if (!canCallBack(user, card)) return { ok: false, reason: "NotYourSeat" };
  if (card.pendingRoll.fortuneUsed) return { ok: false, reason: "AlreadyRerolled" };
  let done = false;
  await updateRealm(async (realm) => {
    const target = realm.cards.find((c) => c.id === cardId);
    if (!target?.pendingRoll || !takeFortune(realm, target.pendingRoll.skill)) return;
    const check = await rollCheck(target, realm, { reroll: true });
    if (!check) return;
    target.pendingRoll = { ...check, rolledAt: game.time.worldTime, fortuneUsed: true };
    done = true;
  });
  if (!done) return { ok: false, reason: "NoReroll" };
  await handRollToPlayer(card);
  return { ok: true };
}

function toModifiers(list) {
  return list.map((m) => new game.pf2e.Modifier(m));
}

async function rollCheck(card, realm, { reroll = false } = {}) {
  const kingdom = getKingdom();
  const { skills } = cardStage(card);
  const skill = card.assignee?.skill ?? skills[0];
  const mod = cardLevelMod(card, realm) + (card.dcAdjust ?? 0);
  const stat = SKILL_TO_STAT[skill];
  const modifiers = timedModifiers(realm, skill, card.eventId);
  const label = `${card.name}${card.assignee ? ` — ${card.assignee.name}` : ""}`;
  const options = { skipDialog: true, label: reroll ? `${label} (${game.i18n.localize("UKM.Fortune.Rerolled")})` : label, extraRollOptions: [`ukm:event:${card.eventId}`, `ukm:card:${card.id}`] };

  if (card.assignee?.type === "pc") {
    const actor = fromUuidSync(card.assignee.actorUuid);
    const statistic = actor?.skills?.[card.assignee.personalSkill];
    if (!statistic) return null;
    const dc = (LEVEL_DC[Math.clamp(kingdom?.level ?? 1, 0, 20)] ?? 14) + mod;
    modifiers.push(...structureModifiers(realm, card, skill));
    const roll = await statistic.roll({ ...options, dc: { value: dc }, modifiers: toModifiers(modifiers) });
    if (!roll) return null;
    return { degree: roll.degreeOfSuccess, skill, stat, personal: true, total: roll.total, dc };
  }

  const statistic = kingdom?.skills?.[skill];
  if (!statistic) return null;
  modifiers.push(...advisorModifiers(realm, card, stat), ...structureModifiers(realm, card, skill));
  const dc = getControlDC() + mod;
  const roll = await statistic.roll({ ...options, dc: { value: dc }, modifiers: toModifiers(modifiers) });
  if (!roll) return null;
  return { degree: roll.degreeOfSuccess, skill, stat, personal: false, total: roll.total, dc };
}

function endsOn(event, card, degreeName) {
  const rules = event?.continuous?.endOn ?? [];
  return rules.some((rule) => {
    if (rule === degreeName) return true;
    const [scope, result] = rule.split(":");
    if (scope.startsWith("stage")) return Number(scope.slice(5)) - 1 === (card.stage ?? 0) && result === degreeName;
    if (result === "twiceInARow") return scope === degreeName && card.lastOutcome === degreeName;
    return false;
  });
}

function closeCard(realm, card, degreeName) {
  card.status = "resolved";
  card.outcome = degreeName;
  card.resolvedAt = game.time.worldTime;
  card.assignee = null;
  realm.consumptionAdjustments = realm.consumptionAdjustments.filter((c) => c.until !== card.id);
}

function reopenCard(card, degreeName, days) {
  card.status = "open";
  card.lastOutcome = degreeName;
  card.assignee = null;
  card.workUntil = null;
  card.months = (card.months ?? 1) + 1;
  card.deadline = game.time.worldTime + days * secondsPerDay();
}

/**
 * Apply an outcome to a card and decide what happens to it next.
 * Mutates the realm; the caller commits the context to the kingdom afterwards.
 */
async function settleCard(realm, card, degreeName, { points = true, skill = null } = {}) {
  const { event, outcomes } = cardStage(card);
  const stageBefore = card.stage ?? 0;
  const ctx = new EffectContext({ realm, card, event });
  await applyEffects(ctx, outcomes[degreeName] ?? []);

  const stat = SKILL_TO_STAT[skill ?? cardStage(card).skills[0]];
  if (points && stat) addStatPoints(realm, stat, DEGREE_POINTS[degreeName] ?? 0, getKingdom()?.level ?? 1);
  if (points && degreeName === "criticalSuccess" && card.kind !== "audience") {
    const windfall = Math.max(1, Math.round(weeklyIncome(realm).base / 7));
    realm.treasury += windfall;
    ctx.note(loc("Windfall", { bp: windfall }));
  }

  const advancedStage = (card.stage ?? 0) !== stageBefore && event?.stages?.[card.stage];
  const continuous = !!event?.continuous || ctx.continueCard;
  if (ctx.ended || (!advancedStage && (!continuous || endsOn(event, { ...card, stage: stageBefore }, degreeName)))) {
    closeCard(realm, card, degreeName);
  } else {
    const days = ctx.continueCard || (event?.deadlineDays ?? 30);
    reopenCard(card, degreeName, days);
  }

  for (const task of ctx.gmTasks) realm.gmTasks.push(task);
  if (points && ["success", "criticalSuccess"].includes(degreeName)) {
    realm.seatRecord ??= {};
    realm.seatRecord[card.seat] = (realm.seatRecord[card.seat] ?? 0) + 1;
  }
  addLog(realm, { type: "card-resolved", card: card.id, seat: card.seat, text: `${card.name}: ${game.i18n.localize(`UKM.Degree.${degreeName}`)}` });
  return ctx;
}

async function postSummary(card, degreeName, ctx, check) {
  const kingdom = getKingdom();
  const lines = ctx.lines.map((l) => `<li>${l}</li>`).join("");
  const by = check?.personal ? loc("HandledBy", { name: check.name }) : card.assignee?.name ? loc("AdvisedBy", { name: card.assignee.name }) : "";
  const status = card.status === "open" ? `<p class="hint">${loc("Continues")}</p>` : "";
  const result = card.kind === "audience" ? loc("Ignored") : game.i18n.localize(`UKM.Degree.${degreeName}`);
  const advisor = card.assignee?.name ?? getCompanion(seatCompanionId(card.seat))?.name ?? game.i18n.localize("UKM.Ability.TheAdvisor");
  const story = card.kind === "audience" ? null : getStory(card.eventId, degreeName, card.tier)?.replaceAll("{advisor}", advisor);
  const content = `<div class="ukm-chat"><h3>${card.name}</h3><p><strong>${result}</strong>${by ? ` · ${by}` : ""}</p>${story ? `<p class="ukm-story">${Handlebars.escapeExpression(story)}</p>` : ""}${lines ? `<ul>${lines}</ul>` : ""}${status}</div>`;
  await ChatMessage.create({ content, speaker: { alias: kingdom?.name || game.i18n.localize("UKM.Manager.Unnamed") } });

  if (ctx.gmTasks.length) {
    const tasks = ctx.gmTasks.map((t) => `<li>${t.text}</li>`).join("");
    await ChatMessage.create({
      content: `<div class="ukm-chat"><h3>${loc("GmTasks", { name: card.name })}</h3><ul>${tasks}</ul></div>`,
      whisper: ChatMessage.getWhisperRecipients("GM").map((u) => u.id),
      speaker: { alias: game.i18n.localize("UKM.Manager.Title") }
    });
  }
}

async function finish(card, degreeName, ctx, check) {
  await commitKingdomChanges(ctx);
  await postSummary(card, degreeName, ctx, check);
  Hooks.callAll(`${MODULE_ID}.cardResolved`, { card, degree: degreeName });
}

/**
 * Roll a card whose work time is up. The result waits on the card so it can
 * still be rerolled from its chat card; it applies when accepted, when a
 * reroll comes in, or a day later.
 */
export async function rollCard(cardId) {
  const original = getRealm().cards.find((c) => c.id === cardId);
  if (!original || original.status !== "assigned") return null;

  let check = null;
  await updateRealm(async (realm) => {
    const card = realm.cards.find((c) => c.id === cardId);
    check = await rollCheck(card, realm);
    if (!check) return;
    card.status = "rolled";
    card.pendingRoll = { ...check, rolledAt: game.time.worldTime };
  });
  if (!check) {
    ui.notifications.warn(loc("RollFailed", { name: original.name }));
    return null;
  }
  await handRollToPlayer(original);
  return DEGREES[check.degree];
}

function rollMessageFor(cardId) {
  const option = `ukm:card:${cardId}`;
  return game.messages.contents.findLast((m) => [m.flags?.pf2e?.context?.options ?? []].flat().includes(option)) ?? null;
}

/** Let the player who asked for the work reroll it with their own hero points. */
async function handRollToPlayer(card) {
  const user = game.users.get(card.assignee?.by);
  if (!user || user.isGM) return;
  const message = rollMessageFor(card.id);
  if (message && message.author?.id !== user.id) await message.update({ author: user.id });
}

function finalDegree(roll) {
  let degree = roll.personal && roll.degree === 2 ? 3 : roll.degree;
  if (roll.anarchy) degree = Math.max(0, degree - 1);
  return degree;
}

/** Apply a rolled card's result. A new degree replaces the pending one (after a reroll). */
export async function acceptRoll(cardId, rerolledDegree = null) {
  let ctx = null;
  let card = null;
  let roll = null;
  let assignee = null;
  await updateRealm(async (realm) => {
    card = realm.cards.find((c) => c.id === cardId);
    if (!card || card.status !== "rolled" || !card.pendingRoll) return;
    roll = { ...card.pendingRoll };
    if (Number.isInteger(rerolledDegree)) roll.degree = rerolledDegree;
    assignee = card.assignee;
    card.pendingRoll = null;
    roll.anarchy = inAnarchy();
    const degreeName = DEGREES[finalDegree(roll)];
    ctx = await settleCard(realm, card, degreeName, { skill: roll.skill });
    if (roll.anarchy) ctx.lines.unshift(loc("AnarchyWorse"));
    if (roll.personal && roll.degree === 3) ctx.fame += 1;
  });
  if (!ctx) return null;
  card.assignee = assignee;
  const degreeName = DEGREES[finalDegree(roll)];
  await finish(card, degreeName, ctx, { personal: roll.personal, name: assignee?.name });
  return degreeName;
}

export async function acceptRequest({ cardId, userId }) {
  const user = game.users.get(userId) ?? game.user;
  const card = getRealm().cards.find((c) => c.id === cardId);
  if (!card || card.status !== "rolled" || !canActForSeat(user, card.seat)) return { ok: false, reason: "NotOpen" };
  await acceptRoll(cardId);
  return { ok: true };
}

const DEGREE_NAMES = ["criticalFailure", "failure", "success", "criticalSuccess"];

/** A card's check was rerolled from its chat card: use the kept result. */
export function onRerollMessage(message) {
  if (!isLeader()) return;
  const context = message.flags?.pf2e?.context;
  if (!context?.isReroll) return;
  const options = [context.options ?? []].flat();
  const cardOption = options.find((o) => typeof o === "string" && o.startsWith("ukm:card:"));
  if (!cardOption) return;
  const degree = DEGREE_NAMES.indexOf(context.outcome);
  acceptRoll(cardOption.slice("ukm:card:".length), degree >= 0 ? degree : null);
}

/** GM records an outcome directly: an escalated card the party played out, or an override. */
export async function recordOutcome(cardId, degreeName) {
  let ctx = null;
  let card = null;
  await updateRealm(async (realm) => {
    card = realm.cards.find((c) => c.id === cardId);
    if (!card || !["open", "assigned", "escalated", "rolled"].includes(card.status)) return;
    card.pendingRoll = null;
    const wasEscalated = card.status === "escalated";
    ctx = await settleCard(realm, card, degreeName);
    if (wasEscalated && card.status === "open") card.deadline = game.time.worldTime + (card.pausedDays ?? 30) * secondsPerDay();
  });
  if (ctx) await finish(card, degreeName, ctx, null);
}

export async function dismissCard(cardId) {
  await updateRealm((realm) => {
    const card = realm.cards.find((c) => c.id === cardId);
    if (!card) return;
    closeCard(realm, card, "dismissed");
    addLog(realm, { type: "card-dismissed", card: cardId, seat: card.seat, text: card.name });
  });
}

/** Apply the failure outcome of problems that ran out of time. */
async function applyMissedProblems() {
  const pending = getRealm().cards.filter((c) => c.pendingEffects);
  for (const pendingCard of pending) {
    let ctx = null;
    let card = null;
    await updateRealm(async (realm) => {
      card = realm.cards.find((c) => c.id === pendingCard.id);
      if (!card?.pendingEffects) return;
      card.pendingEffects = false;
      ctx = await settleCard(realm, card, "failure", { points: false });
    });
    if (ctx) await finish(card, "failure", ctx, null);
  }
}

/** Turn scheduled follow-ups into cards once their day arrives. */
async function releaseScheduled() {
  const now = game.time.worldTime;
  if (!getRealm().scheduled.some((s) => s.at <= now)) return [];
  const spawned = [];
  await updateRealm((realm) => {
    const due = realm.scheduled.filter((s) => s.at <= now);
    realm.scheduled = realm.scheduled.filter((s) => s.at > now);
    for (const entry of due) {
      const event = getEvent(entry.eventId);
      if (!event) continue;
      const card = createCard(event);
      for (const effect of event.onSpawn ?? []) {
        if (effect.endEvent) {
          for (const other of realm.cards) {
            if (other.eventId === effect.endEvent && ACTIVE.includes(other.status)) closeCard(realm, other, "ended");
          }
        }
      }
      realm.cards.push(card);
      spawned.push(card);
      addLog(realm, { type: "event-drawn", card: card.id, seat: card.seat, text: card.name });
    }
  });
  return spawned;
}

/** Everything time-driven on cards: missed problems, follow-ups and finished work. */
export async function resolveDue() {
  if (!isLeader()) return;
  await applyMissedProblems();
  await releaseScheduled();
  const now = game.time.worldTime;
  const due = getRealm().cards.filter((c) => c.status === "assigned" && c.workUntil && c.workUntil <= now);
  for (const card of due.sort((a, b) => a.workUntil - b.workUntil)) await rollCard(card.id);
  const waiting = getRealm().cards.filter((c) => c.status === "rolled" && c.pendingRoll && c.pendingRoll.rolledAt + secondsPerDay() <= now);
  for (const card of waiting) await acceptRoll(card.id);
}

export async function completeGmTask(taskId, done = true) {
  await updateRealm((realm) => {
    const task = realm.gmTasks.find((t) => t.id === taskId);
    if (task) task.done = done;
    realm.gmTasks = realm.gmTasks.filter((t) => !t.done || game.time.worldTime - (t.created ?? 0) < 30 * secondsPerDay());
  });
}

export function outcomePreview(card) {
  const { outcomes } = cardStage(card);
  return DEGREES.slice()
    .reverse()
    .map((degree) => ({
      degree,
      label: game.i18n.localize(`UKM.Degree.${degree}`),
      effects: (outcomes[degree] ?? []).map(describeEffect).filter(Boolean)
    }));
}
