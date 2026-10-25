import { FOUNDING_PICKS, MODULE_ID, POINTS_PER_RANK, REALM_STATS } from "../constants.js";
import { getRankUpAlways, getRankUpScene } from "../content/data.js";
import { getKingdom } from "../integrations/party.js";
import { applyEffects, commitKingdomChanges, describeEffect, EffectContext } from "./effects.js";
import { canRankUp, rankBonus, weeklyIncome } from "./rules.js";
import { busyWith, canActForSeat } from "./resolve.js";
import { addLog, getRealm, newId, updateRealm } from "./state.js";
import { secondsPerDay } from "./time.js";

export const RANK_UP_DAYS = 14;

const statLabel = (stat) => game.i18n.localize(`UKM.Stat.${stat}`);

function speaker() {
  return { alias: getKingdom()?.name || game.i18n.localize("UKM.Manager.Unnamed") };
}

/** Two weeks of the kingdom's base income, so the price keeps pace with the realm. */
export function rankUpCost(realm = getRealm()) {
  return Math.max(4, Math.round(weeklyIncome(realm).base * 2));
}

export function rankUpProject(realm, stat) {
  return realm.projects.find((p) => p.type === "rankUp" && p.stat === stat && ["working", "choosing"].includes(p.status)) ?? null;
}

function band(rank) {
  if (rank >= 8) return "high";
  if (rank >= 4) return "mid";
  return "low";
}

/** The choice scene for a rank-up, with each option's effects at the new rank. */
export function rankUpChoices(project) {
  const scene = getRankUpScene(project.stat);
  if (!scene) return null;
  const level = band(project.rank);
  const always = getRankUpAlways(project.stat);
  return {
    title: scene.title,
    scene: scene.scene,
    always: always.map(describeEffect),
    options: scene.options.map((o) => ({
      id: o.id,
      label: o.label,
      text: o.text,
      effects: o.effects[level] ?? [],
      lines: (o.effects[level] ?? []).map(describeEffect)
    }))
  };
}

/** Start the two-week rank-up. The seat's advisor is busy until it's done. */
export async function startRankUp({ stat, userId }) {
  const user = game.users.get(userId) ?? game.user;
  const def = REALM_STATS[stat];
  if (!def) return { ok: false, reason: "Unknown" };
  if (!canActForSeat(user, def.seat)) return { ok: false, reason: "NotYourSeat" };
  const realm = getRealm();
  const level = getKingdom()?.level ?? 1;
  if (!canRankUp(realm.stats[stat], level)) return { ok: false, reason: "NotReady" };
  if (rankUpProject(realm, stat)) return { ok: false, reason: "AlreadyUnderway" };
  if (stat === "economy" && realm.debt.amount > 0) return { ok: false, reason: "InDebt" };
  const busy = busyWith(realm, `seat:${def.seat}`);
  if (busy) return { ok: false, reason: "AdvisorBusy", data: { card: busy.name } };
  const cost = rankUpCost(realm);
  if (realm.treasury < cost) return { ok: false, reason: "TooPoor", data: { cost } };

  const now = game.time.worldTime;
  await updateRealm((r) => {
    r.treasury -= cost;
    r.projects.push({
      id: newId(),
      type: "rankUp",
      stat,
      seat: def.seat,
      rank: r.stats[stat].rank + 1,
      name: game.i18n.format("UKM.Rank.ProjectName", { stat: statLabel(stat) }),
      status: "working",
      startedAt: now,
      until: now + RANK_UP_DAYS * secondsPerDay(),
      cost,
      by: user.id
    });
    addLog(r, { type: "rank-start", text: statLabel(stat), amount: -cost });
  });
  return { ok: true, days: RANK_UP_DAYS };
}

/** Move finished rank-ups to their choice scene. */
export async function advanceRankUps() {
  if (!game.user.isActiveGM) return;
  const now = game.time.worldTime;
  if (!getRealm().projects.some((p) => p.type === "rankUp" && p.status === "working" && p.until <= now)) return;
  const ready = [];
  await updateRealm((realm) => {
    for (const project of realm.projects) {
      if (project.type !== "rankUp" || project.status !== "working" || project.until > now) continue;
      project.status = "choosing";
      ready.push(project);
    }
  });
  for (const project of ready) {
    await ChatMessage.create({
      speaker: speaker(),
      content: `<div class="ukm-chat"><h3>${game.i18n.format("UKM.Rank.ReadyTitle", { stat: statLabel(project.stat) })}</h3><p>${game.i18n.localize("UKM.Rank.ReadyText")}</p></div>`
    });
  }
}

export async function finishRankUpNow(projectId) {
  await updateRealm((realm) => {
    const project = realm.projects.find((p) => p.id === projectId);
    if (project?.status === "working") project.until = game.time.worldTime;
  });
  await advanceRankUps();
}

/** The seat's choice is made: raise the rank and apply what was chosen. */
export async function chooseRankUp({ projectId, option, userId }) {
  const user = game.users.get(userId) ?? game.user;
  const project = getRealm().projects.find((p) => p.id === projectId);
  if (!project || project.status !== "choosing") return { ok: false, reason: "NotReady" };
  if (!canActForSeat(user, project.seat)) return { ok: false, reason: "NotYourSeat" };
  const choices = rankUpChoices(project);
  const picked = choices?.options.find((o) => o.id === option);
  if (!picked) return { ok: false, reason: "Unknown" };

  let ctx = null;
  await updateRealm(async (realm) => {
    const target = realm.projects.find((p) => p.id === projectId);
    if (!target || target.status !== "choosing") return;
    const stat = realm.stats[target.stat];
    stat.rank = Math.max(stat.rank, target.rank);
    target.status = "done";
    target.choice = option;
    target.doneAt = game.time.worldTime;
    ctx = new EffectContext({ realm, card: null, event: null });
    await applyEffects(ctx, [...getRankUpAlways(target.stat), ...picked.effects]);
    for (const task of ctx.gmTasks) realm.gmTasks.push(task);
    realm.projects = realm.projects.filter((p) => p.status !== "done" || game.time.worldTime - (p.doneAt ?? 0) < 180 * secondsPerDay());
    addLog(realm, { type: "rank-up", text: `${statLabel(target.stat)} ${target.rank} (${picked.label})` });
  });
  if (!ctx) return { ok: false, reason: "NotReady" };
  await commitKingdomChanges(ctx);

  const def = REALM_STATS[project.stat];
  const lines = ctx.lines.map((l) => `<li>${l}</li>`).join("");
  await ChatMessage.create({
    speaker: speaker(),
    content: `<div class="ukm-chat"><h3>${game.i18n.format("UKM.Rank.Raised", { stat: statLabel(project.stat), rank: project.rank })}</h3><p><strong>${picked.label}.</strong> ${picked.text}</p>${lines ? `<ul>${lines}</ul>` : ""}<p class="hint">${game.i18n.format("UKM.Rank.RaisedDetail", {
      bonus: rankBonus(project.rank),
      skills: def.skills.map((s) => game.i18n.localize(`UKM.Skill.${s}`)).join(" & ")
    })}</p></div>`
  });
  Hooks.callAll(`${MODULE_ID}.rankUp`, { stat: project.stat, rank: project.rank, choice: option });
  return { ok: true };
}

export function foundingPicks(realm = getRealm()) {
  return realm.founding?.stats ?? [];
}

/** The two stats the party chose to start at rank 1. Applied once; the GM can undo and pick again. */
export async function applyFounding(stats) {
  const picks = [...new Set(stats.filter((s) => REALM_STATS[s]))].slice(0, FOUNDING_PICKS);
  if (!picks.length || foundingPicks().length) return;
  await updateRealm((realm) => {
    for (const stat of picks) {
      const target = realm.stats[stat];
      target.points += POINTS_PER_RANK;
      target.rank = Math.max(target.rank, 1);
    }
    realm.founding = { stats: picks, time: game.time.worldTime };
    addLog(realm, { type: "founding", text: picks.map(statLabel).join(", ") });
  });
}

export async function resetFounding() {
  await updateRealm((realm) => {
    for (const stat of realm.founding?.stats ?? []) {
      const target = realm.stats[stat];
      target.points = Math.max(0, target.points - POINTS_PER_RANK);
      target.rank = Math.min(target.rank, Math.floor(target.points / POINTS_PER_RANK));
    }
    realm.founding = null;
  });
}
