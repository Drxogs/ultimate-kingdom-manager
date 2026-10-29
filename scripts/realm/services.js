import { ATTITUDES, MODULE_ID } from "../constants.js";
import { getCompanion, getCompanions, getServices, getTrack } from "../content/data.js";
import { getKingdom, getPlayerCharacters } from "../integrations/party.js";
import { getSetting, setSetting, SETTINGS } from "../settings.js";
import { companionAttitude, isKnownAdvisor, rankBonus, weeklyIncome } from "./rules.js";
import { canUseRoyal } from "./royal.js";
import { addLog, getRealm, newId, updateRealm } from "./state.js";
import { secondsPerDay } from "./time.js";
import { PINNACLE, trackStage } from "./tracks.js";

/*
 * Crown services: things the realm does for the party, bought with BP. Healing, travel, knowledge,
 * a feast. None of them give items, runes, spells or lasting bonuses, so the PF2e game's wealth
 * stays as it is. Each needs a settlement track at some stage and a kingdom level, and costs a
 * share of a week's income. Anyone can ask; the ruler (or the GM) approves on the Council tab or
 * under The crown. The GM applies the effect on the character sheet from a GM task.
 */

const loc = (key, data) => (data ? game.i18n.format(`UKM.Service.${key}`, data) : game.i18n.localize(`UKM.Service.${key}`));
const esc = (s) => Handlebars.escapeExpression(s ?? "");

/** The best settlement for a track: highest stage, the capital on ties. */
function provider(realm, trackId) {
  let best = null;
  let bestStage = -1;
  for (const s of realm.settlements ?? []) {
    const stage = (s.pinnacles ?? []).includes(trackId) ? PINNACLE : trackStage(s, trackId);
    if (stage > bestStage || (stage === bestStage && s.capital)) {
      best = s;
      bestStage = stage;
    }
  }
  return { settlement: best, stage: bestStage };
}

export function serviceCost(service, realm = getRealm()) {
  return Math.max(2, Math.round(weeklyIncome(realm).total * (service.costWeeks ?? 1)));
}

/** The rank the realm's casters work at: half the kingdom level, rounded up. */
export function serviceRank(level = getKingdom()?.level ?? 1) {
  return Math.ceil(level / 2);
}

/** Their counteract modifier, made like an advisor's Folklore check (Culture's rank). */
export function serviceModifier(realm = getRealm(), level = getKingdom()?.level ?? 1) {
  return level + rankBonus(realm.stats?.culture?.rank ?? 0, level);
}

function lastUse(realm, key) {
  return realm.services?.used?.[key] ?? 0;
}

/** Why a service can't be asked for now, or null. */
export function serviceBlock(service, realm = getRealm()) {
  const level = getKingdom()?.level ?? 1;
  if (service.setting && !getSetting(SETTINGS[service.setting])) return { reason: "Off" };
  if (level < (service.minLevel ?? 1)) return { reason: "Level", data: { level: service.minLevel } };
  const { stage } = provider(realm, service.track);
  if (stage < service.stage) {
    const track = getTrack(service.track);
    return { reason: "Track", data: { stage: track?.stages?.[service.stage]?.name ?? "" } };
  }
  const day = secondsPerDay();
  const until = lastUse(realm, service.id) + (service.cooldownDays ?? 0) * day;
  if (service.cooldownDays && until > game.time.worldTime) return { reason: "Cooldown", data: { days: Math.ceil((until - game.time.worldTime) / day) } };
  if (realm.treasury < serviceCost(service, realm)) return { reason: "TooCostly" };
  return null;
}

/** Companions a feast could warm: met, and not yet helpful (or past their 90 days). */
export function feastTargets(service, realm = getRealm()) {
  const day = secondsPerDay();
  return getCompanions().filter((c) => {
    if (!isKnownAdvisor(c.id)) return false;
    if (companionAttitude(c.id) === "helpful") return false;
    return lastUse(realm, `${service.id}:${c.id}`) + (service.targetCooldownDays ?? 0) * day <= game.time.worldTime;
  });
}

/** Every service, with what it costs and whether it can be asked for, for the Realm tab. */
export function servicesView(realm = getRealm(), user = game.user) {
  const pending = new Set((realm.council?.proposals ?? []).filter((p) => p.status === "open" && p.request?.type === "service").map((p) => p.request.serviceId));
  return getServices()
    .filter((s) => !s.setting || getSetting(SETTINGS[s.setting]))
    .map((s) => {
      const block = serviceBlock(s, realm) ?? (s.detail === "companion" && !feastTargets(s, realm).length ? { reason: "NoTarget" } : null);
      const track = getTrack(s.track);
      return {
        id: s.id,
        name: s.name,
        hook: s.hook,
        cost: serviceCost(s, realm),
        needs: loc("Needs", { stage: track?.stages?.[s.stage]?.name ?? "", level: s.minLevel ?? 1 }),
        blocked: block ? loc(`Block.${block.reason}`, block.data ?? {}) : null,
        pending: pending.has(s.id),
        canAsk: !block && !pending.has(s.id) && !!user,
        buyNow: canUseRoyal(user, realm)
      };
    });
}

function describe(service, details, realm) {
  const { settlement } = provider(realm, service.track);
  const target = details.actorUuid ? fromUuidSync(details.actorUuid)?.name : details.companionId ? getCompanion(details.companionId)?.name : "";
  const from = (realm.settlements ?? []).find((s) => s.id === details.from)?.name ?? "";
  const to = (realm.settlements ?? []).find((s) => s.id === details.to)?.name ?? "";
  const level = getKingdom()?.level ?? 1;
  const data = { settlement: settlement?.name ?? "", target: target ?? "", from, to, note: details.note || loc("Unspecified"), rank: serviceRank(level), mod: serviceModifier(realm, level) };
  const fill = (text) => String(text ?? "").replace(/\{(\w+)\}/g, (_, k) => data[k] ?? "");
  const label = target || (to ? `${from} → ${to}` : details.note || "");
  return { chat: fill(service.chat), task: fill(service.task), label, data };
}

function cleanDetails(service, details = {}, realm = getRealm()) {
  const clean = { note: String(details.note ?? "").trim().slice(0, 120) };
  if (service.detail === "character") {
    if (!getPlayerCharacters().some((a) => a.uuid === details.actorUuid)) return null;
    clean.actorUuid = details.actorUuid;
  } else if (service.detail === "route") {
    const ids = new Set((realm.settlements ?? []).map((s) => s.id));
    if (!ids.has(details.from) || !ids.has(details.to) || details.from === details.to) return null;
    clean.from = details.from;
    clean.to = details.to;
  } else if (service.detail === "companion") {
    if (!feastTargets(service, realm).some((c) => c.id === details.companionId)) return null;
    clean.companionId = details.companionId;
  } else if (service.detail === "subject" && !clean.note) return null;
  return clean;
}

/**
 * Ask for a service. The ruler and the GM get it straight away; anyone else's request waits
 * for the ruler on the Council tab.
 * request: { serviceId, details, userId }
 */
export async function requestService({ serviceId, details, userId }) {
  const user = game.users.get(userId) ?? game.user;
  const service = getServices().find((s) => s.id === serviceId);
  if (!service) return { ok: false, reason: "Unknown" };
  const realm = getRealm();
  const block = serviceBlock(service, realm);
  if (block) return { ok: false, reason: `Service${block.reason}`, data: block.data };
  const clean = cleanDetails(service, details, realm);
  if (!clean) return { ok: false, reason: "ServiceTarget" };
  if (canUseRoyal(user, realm)) return performService({ serviceId, details: clean, byName: user.character?.name ?? user.name });

  const { label } = describe(service, clean, realm);
  await updateRealm((r) => {
    r.council ??= { proposals: [] };
    r.council.proposals.push({
      id: newId(),
      request: { type: "service", serviceId, details: clean },
      name: label ? `${service.name}: ${label}` : service.name,
      seat: getTrack(service.track)?.seat ?? "ruler",
      cost: serviceCost(service, r),
      days: null,
      by: user.id,
      byName: user.character?.name ?? user.name,
      votes: { [user.id]: 1 },
      created: game.time.worldTime,
      status: "open"
    });
    addLog(r, { type: "proposal", text: label ? `${service.name}: ${label}` : service.name });
  });
  return { ok: true, pending: true };
}

/** Pay for a service and carry it out. Runs on the active GM. */
export async function performService({ serviceId, details, byName = "" }) {
  const service = getServices().find((s) => s.id === serviceId);
  if (!service) return { ok: false, reason: "Unknown" };
  const realm = getRealm();
  const block = serviceBlock(service, realm);
  if (block) return { ok: false, reason: `Service${block.reason}`, data: block.data };
  const clean = cleanDetails(service, details, realm);
  if (!clean) return { ok: false, reason: "ServiceTarget" };
  const cost = serviceCost(service, realm);
  const { chat, task, label } = describe(service, clean, realm);
  const now = game.time.worldTime;

  await updateRealm((r) => {
    r.treasury -= cost;
    r.services ??= { used: {} };
    r.services.used[service.id] = now;
    if (clean.companionId) r.services.used[`${service.id}:${clean.companionId}`] = now;
    if (task) r.gmTasks.push({ id: newId(), text: `${service.name}: ${task}`, card: null, hexKey: null, created: now, done: false });
    addLog(r, { type: "service", text: label ? `${service.name}: ${label}` : service.name, amount: cost });
  });

  const lines = [loc("Paid", { cost })];
  if (clean.companionId) {
    const attitudes = { ...(getSetting(SETTINGS.companionAttitudes) ?? {}) };
    const before = companionAttitude(clean.companionId);
    const after = ATTITUDES[Math.min(ATTITUDES.length - 1, ATTITUDES.indexOf(before) + 1)];
    attitudes[clean.companionId] = after;
    await setSetting(SETTINGS.companionAttitudes, attitudes);
    lines.push(loc("Warmer", { name: getCompanion(clean.companionId)?.name ?? "", attitude: game.i18n.localize(`UKM.Attitude.${after}`) }));
  }
  if (byName) lines.push(loc("AskedBy", { name: byName }));
  await ChatMessage.create({
    speaker: { alias: getKingdom()?.name || game.i18n.localize("UKM.Manager.Unnamed") },
    content: `<div class="ukm-chat ukm-royal"><h3><i class="fa-solid fa-hand-holding-heart"></i> ${esc(service.name)}</h3><p class="ukm-story">${esc(chat)}</p><ul>${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul></div>`
  });
  Hooks.callAll(`${MODULE_ID}.refresh`);
  return { ok: true };
}
