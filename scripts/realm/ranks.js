import { FOUNDING_PICKS, MODULE_ID, POINTS_PER_RANK, REALM_STATS } from "../constants.js";
import { getKingdom } from "../integrations/party.js";
import { canRankUp, rankBonus } from "./rules.js";
import { canActForSeat } from "./resolve.js";
import { addLog, getRealm, updateRealm } from "./state.js";

/** Raise a realm stat one rank once its bar is full and the kingdom's level allows it. */
export async function raiseRank({ stat, userId }) {
  const user = game.users.get(userId) ?? game.user;
  const def = REALM_STATS[stat];
  if (!def) return { ok: false, reason: "Unknown" };
  if (!canActForSeat(user, def.seat)) return { ok: false, reason: "NotYourSeat" };
  const level = getKingdom()?.level ?? 1;
  if (!canRankUp(getRealm().stats[stat], level)) return { ok: false, reason: "NotReady" };

  let rank = 0;
  await updateRealm((realm) => {
    const target = realm.stats[stat];
    if (!canRankUp(target, level)) return;
    target.rank += 1;
    rank = target.rank;
    addLog(realm, { type: "rank-up", text: `${game.i18n.localize(`UKM.Stat.${stat}`)} ${rank}` });
  });
  if (!rank) return { ok: false, reason: "NotReady" };

  const label = game.i18n.localize(`UKM.Stat.${stat}`);
  const content = `<div class="ukm-chat"><h3>${game.i18n.format("UKM.Rank.Raised", { stat: label, rank })}</h3><p>${game.i18n.format("UKM.Rank.RaisedDetail", {
    bonus: rankBonus(rank),
    skills: def.skills.map((s) => game.i18n.localize(`UKM.Skill.${s}`)).join(" & ")
  })}</p></div>`;
  await ChatMessage.create({ content, speaker: { alias: getKingdom()?.name || game.i18n.localize("UKM.Manager.Unnamed") } });
  Hooks.callAll(`${MODULE_ID}.rankUp`, { stat, rank });
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
    addLog(realm, { type: "founding", text: picks.map((s) => game.i18n.localize(`UKM.Stat.${s}`)).join(", ") });
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
