import { DEGREE_POINTS, DEGREES, LEVEL_DC, MODULE_ID, SKILL_ABILITY, SKILL_TO_STAT } from "../constants.js";
import { getCompanion, getEvent } from "../content/data.js";
import { getControlDC, getKingdom, getPartyLevel } from "../integrations/party.js";
import { getSetting, SETTINGS } from "../settings.js";
import { createCard } from "./deck.js";
import { applyEffects, commitKingdomChanges, describeEffect, EffectContext } from "./effects.js";
import { rankBonus, cardWorkDays } from "./rules.js";
import { addLog, getRealm, updateRealm } from "./state.js";
import { secondsPerDay } from "./time.js";

const ACTIVE = ["open", "assigned"];

const loc = (key, data) => (data ? game.i18n.format(`UKM.Resolve.${key}`, data) : game.i18n.localize(`UKM.Resolve.${key}`));

export function cardStage(card) {
  const event = getEvent(card.eventId);
  const stage = event?.stages?.[card.stage ?? 0] ?? null;
  return {
    event,
    stage,
    skills: stage?.skill ?? event?.skill ?? [],
    outcomes: stage?.outcomes ?? event?.outcomes ?? {}
  };
}

export function cardLevelMod(card, realm = getRealm()) {
  const event = getEvent(card.eventId);
  return (event?.mod ?? 0) + (realm.levelModBoosts?.[card.eventId] ?? 0);
}

function assigneeKey(assignee) {
  if (!assignee) return null;
  return assignee.type === "pc" ? assignee.actorUuid : `seat:${assignee.seat}`;
}

/** Who is already working a card. An advisor or PC takes on one card at a time. */
export function busyWith(realm, key) {
  return realm.cards.find((c) => c.status === "assigned" && assigneeKey(c.assignee) === key) ?? null;
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
  const companionId = getSetting(SETTINGS.seatAssignments)?.[seat]?.companion;
  return companionId ? getCompanion(companionId)?.name ?? null : null;
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

  if (request.type === "pc") {
    const actor = fromUuidSync(request.actorUuid);
    if (!actor || (!user.isGM && !actor.testUserPermission(user, "OWNER"))) return { ok: false, reason: "NotYourCharacter" };
    if (!actor.skills?.[request.personalSkill]) return { ok: false, reason: "NoSkill" };
    assignee = { type: "pc", actorUuid: actor.uuid, name: actor.name, skill, personalSkill: request.personalSkill };
  } else {
    const name = seatHolderName(card.seat);
    if (!name) return { ok: false, reason: "SeatVacant" };
    assignee = { type: "advisor", seat: card.seat, name, skill };
  }

  const busy = busyWith(realm, assigneeKey(assignee));
  if (busy) return { ok: false, reason: "Busy", data: { name: assignee.name, card: busy.name } };

  const days = cardWorkDays(cardLevelMod(card, realm));
  await updateRealm((r) => {
    const target = r.cards.find((c) => c.id === card.id);
    if (!target || target.status !== "open") return;
    target.status = "assigned";
    target.assignee = { ...assignee, by: user.id };
    target.assignedAt = game.time.worldTime;
    target.workUntil = game.time.worldTime + days * secondsPerDay();
    addLog(r, { type: "card-assigned", card: card.id, seat: card.seat, text: `${card.name} — ${assignee.name}` });
  });
  return { ok: true, days };
}

export async function unassignCard({ cardId, userId }) {
  const user = game.users.get(userId) ?? game.user;
  const card = getRealm().cards.find((c) => c.id === cardId);
  if (!card || card.status !== "assigned" || !canActForSeat(user, card.seat)) return { ok: false, reason: "NotAssigned" };
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
  if (!card || !ACTIVE.includes(card.status) || !canActForSeat(user, card.seat)) return { ok: false, reason: "NotOpen" };
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
    .map((m) => ({ slug: `ukm-${m.id}`, label: m.label, modifier: m.value, type: m.type }))
    .concat(companionModifiers(realm, eventId));
}

function companionModifiers(realm, eventId) {
  const event = getEvent(eventId);
  const assignments = getSetting(SETTINGS.seatAssignments) ?? {};
  const companionId = assignments[event?.seat]?.companion;
  const companion = companionId ? getCompanion(companionId) : null;
  if (!companion) return [];
  const mods = [];
  const level = getPartyLevel();
  if (companion.seats?.includes(event.seat)) {
    mods.push({ slug: `ukm-advisor-${companion.id}`, label: companion.name, modifier: level >= 16 ? 3 : level >= 8 ? 2 : 1, type: "status" });
  }
  for (const bonus of companion.eventBonus ?? []) {
    if (bonus.event === eventId) mods.push({ slug: `ukm-advisor-${companion.id}-${eventId}`, label: companion.name, modifier: bonus.value, type: bonus.type });
  }
  return mods;
}

function takeFortune(realm, skill) {
  const now = game.time.worldTime;
  const fortune = realm.fortunes.find((f) => f.expires > now && f.uses > 0 && (f.skills ?? []).includes(skill));
  if (!fortune) return false;
  fortune.uses -= 1;
  realm.fortunes = realm.fortunes.filter((f) => f.uses > 0 && f.expires > now);
  return true;
}

function toModifiers(list) {
  return list.map((m) => new game.pf2e.Modifier(m));
}

async function rollCheck(card, realm) {
  const kingdom = getKingdom();
  const { skills } = cardStage(card);
  const skill = card.assignee?.skill ?? skills[0];
  const mod = cardLevelMod(card, realm) + (card.dcAdjust ?? 0);
  const stat = SKILL_TO_STAT[skill];
  const modifiers = timedModifiers(realm, skill, card.eventId);
  const fortune = takeFortune(realm, skill);
  const label = `${card.name}${card.assignee ? ` — ${card.assignee.name}` : ""}`;
  const options = { skipDialog: true, rollTwice: fortune ? "keep-higher" : false, label, extraRollOptions: [`ukm:event:${card.eventId}`] };

  if (card.assignee?.type === "pc") {
    const actor = fromUuidSync(card.assignee.actorUuid);
    const statistic = actor?.skills?.[card.assignee.personalSkill];
    if (!statistic) return null;
    const dc = (LEVEL_DC[Math.clamp(kingdom?.level ?? 1, 0, 20)] ?? 14) + mod;
    const roll = await statistic.roll({ ...options, dc: { value: dc }, modifiers: toModifiers(modifiers) });
    if (!roll) return null;
    let degree = roll.degreeOfSuccess;
    if (degree === 2) degree = 3;
    return { degree, skill, stat, personal: true, fame: roll.degreeOfSuccess === 3 ? 1 : 0, total: roll.total, dc };
  }

  const statistic = kingdom?.skills?.[skill];
  if (!statistic) return null;
  const bonus = rankBonus(realm.stats[stat]?.rank ?? 0);
  if (bonus) modifiers.push({ slug: `ukm-rank-${stat}`, label: game.i18n.localize(`UKM.Stat.${stat}`), modifier: bonus, type: "circumstance" });
  const dc = getControlDC() + mod;
  const roll = await statistic.roll({ ...options, dc: { value: dc }, modifiers: toModifiers(modifiers) });
  if (!roll) return null;
  return { degree: roll.degreeOfSuccess, skill, stat, personal: false, fame: 0, total: roll.total, dc };
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
  if (points && stat && realm.stats[stat]) {
    realm.stats[stat].points = Math.max(0, realm.stats[stat].points + (DEGREE_POINTS[degreeName] ?? 0));
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
  addLog(realm, { type: "card-resolved", card: card.id, seat: card.seat, text: `${card.name}: ${game.i18n.localize(`UKM.Degree.${degreeName}`)}` });
  return ctx;
}

async function postSummary(card, degreeName, ctx, check) {
  const kingdom = getKingdom();
  const lines = ctx.lines.map((l) => `<li>${l}</li>`).join("");
  const by = check?.personal ? loc("HandledBy", { name: check.name }) : card.assignee?.name ? loc("AdvisedBy", { name: card.assignee.name }) : "";
  const status = card.status === "open" ? `<p class="hint">${loc("Continues")}</p>` : "";
  const content = `<div class="ukm-chat"><h3>${card.name}</h3><p><strong>${game.i18n.localize(`UKM.Degree.${degreeName}`)}</strong>${by ? ` · ${by}` : ""}</p>${lines ? `<ul>${lines}</ul>` : ""}${status}</div>`;
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

/** Roll a card whose work time is up. */
export async function rollCard(cardId) {
  const before = getRealm();
  const original = before.cards.find((c) => c.id === cardId);
  if (!original || original.status !== "assigned") return null;
  const assignee = original.assignee;

  let ctx = null;
  let check = null;
  let card = null;
  await updateRealm(async (realm) => {
    card = realm.cards.find((c) => c.id === cardId);
    check = await rollCheck(card, realm);
    if (!check) return;
    check.name = assignee?.name;
    ctx = await settleCard(realm, card, DEGREES[check.degree], { skill: check.skill });
    ctx.fame += check.fame;
  });
  if (!ctx) {
    ui.notifications.warn(loc("RollFailed", { name: original.name }));
    return null;
  }
  card.assignee = assignee;
  await finish(card, DEGREES[check.degree], ctx, check);
  return DEGREES[check.degree];
}

/** GM records an outcome directly: an escalated card the party played out, or an override. */
export async function recordOutcome(cardId, degreeName) {
  let ctx = null;
  let card = null;
  await updateRealm(async (realm) => {
    card = realm.cards.find((c) => c.id === cardId);
    if (!card || !["open", "assigned", "escalated"].includes(card.status)) return;
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
  if (!game.user.isActiveGM) return;
  await applyMissedProblems();
  await releaseScheduled();
  const now = game.time.worldTime;
  const due = getRealm().cards.filter((c) => c.status === "assigned" && c.workUntil && c.workUntil <= now);
  for (const card of due.sort((a, b) => a.workUntil - b.workUntil)) await rollCard(card.id);
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
