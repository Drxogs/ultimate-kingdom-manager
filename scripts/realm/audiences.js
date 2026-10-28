import { MODULE_ID, REALM_STATS, SEATS } from "../constants.js";
import { chatClass, chatKicker } from "./chat-style.js";
import { getAudience, getAudiences } from "../content/data.js";
import { getKingdom } from "../integrations/party.js";
import { applyEffects, commitKingdomChanges, describeEffect, EffectContext } from "./effects.js";
import { addStatPoints } from "./rules.js";
import { canActForSeat } from "./resolve.js";
import { addLog, getRealm, newId, updateRealm } from "./state.js";
import { secondsPerDay } from "./time.js";

const COOLDOWN_DAYS = 365;
const ACTIVE = ["open", "assigned", "rolled", "escalated"];

function statForSeat(seat) {
  return Object.entries(REALM_STATS).find(([, def]) => def.seat === seat)?.[0] ?? null;
}

function seatHolder(seat) {
  const uuid = getKingdom()?.leadership?.[seat]?.uuid;
  return uuid ? fromUuidSync(uuid)?.name ?? null : null;
}

/** One petitioner a month, addressed to a seat that hasn't had one in a while. */
export function drawAudience(realm, { now = game.time.worldTime } = {}) {
  const history = (realm.audienceHistory ??= {});
  const cooldown = COOLDOWN_DAYS * secondsPerDay();
  const lastBySeat = Object.fromEntries(SEATS.map((s) => [s, 0]));
  for (const card of realm.cards) if (card.kind === "audience") lastBySeat[card.seat] = Math.max(lastBySeat[card.seat], card.drawnAt);

  const pool = getAudiences().filter(
    (a) => !(history[a.id] && now - history[a.id] < cooldown) && !realm.cards.some((c) => c.eventId === `audience:${a.id}` && ACTIVE.includes(c.status))
  );
  if (!pool.length) return null;
  const seats = [...new Set(pool.map((a) => a.seat))].sort((a, b) => lastBySeat[a] - lastBySeat[b] || Math.random() - 0.5);
  const options = pool.filter((a) => a.seat === seats[0]);
  const audience = options[Math.floor(Math.random() * options.length)];
  history[audience.id] = now;
  const card = {
    id: newId(),
    eventId: `audience:${audience.id}`,
    tier: null,
    matter: false,
    name: game.i18n.format("UKM.Audience.Name", { petitioner: audience.petitioner }),
    kind: "audience",
    seat: audience.seat,
    stage: 0,
    status: "open",
    drawnAt: now,
    deadline: now + (audience.deadlineDays ?? 14) * secondsPerDay(),
    target: { hidden: false },
    revealed: true,
    assignee: null,
    workUntil: null,
    months: 1,
    noteId: null
  };
  realm.cards.push(card);
  addLog(realm, { type: "event-drawn", card: card.id, seat: card.seat, text: card.name });
  Hooks.callAll(`${MODULE_ID}.eventsDrawn`, [card]);
  return card;
}

export function audienceResponses(card) {
  const audience = getAudience(card.eventId.slice("audience:".length));
  if (!audience) return null;
  return {
    petitioner: audience.petitioner,
    request: audience.request,
    responses: audience.responses.map((r) => ({ ...r, lines: r.effects.map(describeEffect).filter(Boolean) }))
  };
}

/** The seat holder answers in person. The choice is the outcome; there's no roll. */
export async function answerAudience({ cardId, response, userId }) {
  const user = game.users.get(userId) ?? game.user;
  const card = getRealm().cards.find((c) => c.id === cardId);
  if (!card || card.kind !== "audience" || card.status !== "open") return { ok: false, reason: "NotOpen" };
  if (!canActForSeat(user, card.seat)) return { ok: false, reason: "NotYourSeat" };
  const data = audienceResponses(card);
  const answer = data?.responses.find((r) => r.id === response);
  if (!answer) return { ok: false, reason: "Unknown" };

  let ctx = null;
  await updateRealm(async (realm) => {
    const target = realm.cards.find((c) => c.id === cardId);
    if (!target || target.status !== "open") return;
    ctx = new EffectContext({ realm, card: target, event: null });
    await applyEffects(ctx, answer.effects);
    const stat = statForSeat(target.seat);
    if (stat) addStatPoints(realm, stat, 1, getKingdom()?.level ?? 1);
    target.status = "resolved";
    target.outcome = answer.id;
    target.resolvedAt = game.time.worldTime;
    for (const task of ctx.gmTasks) realm.gmTasks.push(task);
    realm.audienceRecord ??= {};
    realm.audienceRecord[target.seat] = (realm.audienceRecord[target.seat] ?? 0) + 1;
    addLog(realm, { type: "audience", card: target.id, seat: target.seat, text: `${target.name}: ${answer.label}` });
  });
  if (!ctx) return { ok: false, reason: "NotOpen" };
  await commitKingdomChanges(ctx);

  const esc = Handlebars.escapeExpression;
  const holder = seatHolder(card.seat) ?? game.i18n.localize(`UKM.Seat.${card.seat}`);
  const lines = ctx.lines.map((l) => `<li>${l}</li>`).join("");
  await ChatMessage.create({
    speaker: { alias: getKingdom()?.name || game.i18n.localize("UKM.Manager.Unnamed") },
    content: `<div class="ukm-chat${chatClass(card)}">${chatKicker(card)}<h3>${esc(card.name)}</h3><p><em>"${esc(data.request)}"</em></p><p>${game.i18n.format("UKM.Audience.Answered", {
      holder: esc(holder),
      answer: `<strong>${esc(answer.label)}</strong>`
    })}</p>${lines ? `<ul>${lines}</ul>` : ""}</div>`
  });
  return { ok: true };
}
