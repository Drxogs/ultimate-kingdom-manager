import { drawAudience } from "./audiences.js";
import { createCard, drawMonthlyEvents, drawWeeklyMatter } from "./deck.js";
import { getStoryEvents } from "../content/data.js";
import { setRevealed, syncPins } from "./pins.js";
import { finishRankUpNow } from "./ranks.js";
import { buildableStructures, setFortified } from "./projects.js";
import { addBuilding, fitSize, refreshDerived, removeBuilding, settlements, syncKingdomSettlements } from "./settlements.js";
import { getKingdom } from "../integrations/party.js";
import { applyStartingPoint } from "./midcampaign.js";
import { completeGmTask, dismissCard, recordOutcome, rollCard } from "./resolve.js";
import { addLog, getRealm, updateRealm } from "./state.js";

function drawnNotice(card) {
  return card ? game.i18n.format("UKM.Manager.MatterDrawn", { name: card.name }) : game.i18n.localize("UKM.Manager.MatterNone");
}

const OPS = {
  rollNow: async ({ cardId }) => {
    await rollCard(cardId);
    return {};
  },
  record: async ({ cardId, degree }) => {
    await recordOutcome(cardId, degree);
    return {};
  },
  dismiss: async ({ cardId }) => {
    await dismissCard(cardId);
    return {};
  },
  reveal: async ({ cardId, revealed }) => {
    await setRevealed(cardId, !!revealed);
    return {};
  },
  task: async ({ taskId }) => {
    const task = getRealm().gmTasks.find((t) => t.id === taskId);
    if (task) await completeGmTask(taskId, !task.done);
    return {};
  },
  fortify: async ({ hexKey, on }) => {
    if (hexKey === undefined || hexKey === null) return { ok: false, reason: "Unknown" };
    await setFortified(hexKey, !!on);
    return {};
  },
  startingPoint: async ({ data }) => {
    await applyStartingPoint(data ?? {});
    return { notice: game.i18n.format("UKM.Start.Applied", { level: getKingdom()?.level ?? 1 }) };
  },
  placeBuilding: async ({ settlementId, key }) => {
    const settlement = settlements().find((s) => s.id === settlementId);
    const structure = settlement ? buildableStructures(settlement).find((s) => s.key === key) : null;
    if (!structure) return { ok: false, reason: "NoStructure" };
    await updateRealm((realm) => {
      addBuilding(realm, settlementId, structure, null);
      const target = settlements(realm).find((s) => s.id === settlementId);
      if (target) fitSize(target);
      addLog(realm, { type: "placed", text: `${structure.name}, ${settlement.name}` });
    });
    await syncKingdomSettlements();
    return { notice: game.i18n.format("UKM.Settlement.Placed", { name: structure.name, settlement: settlement.name }) };
  },
  removeBuilding: async ({ settlementId, index }) => {
    await updateRealm((realm) => removeBuilding(realm, settlementId, Number(index)));
    await syncKingdomSettlements();
    return {};
  },
  settlement: async ({ settlementId, waterside, capital, remove }) => {
    let capitalName = null;
    await updateRealm((realm) => {
      const target = settlements(realm).find((s) => s.id === settlementId);
      if (!target) return;
      if (waterside !== undefined) target.waterside = !!waterside;
      if (capital) {
        for (const s of settlements(realm)) s.capital = s.id === settlementId;
        capitalName = target.name;
      }
      if (remove) {
        realm.settlements = settlements(realm).filter((s) => s.id !== settlementId);
        realm.settlementsStarted = true;
        refreshDerived(realm);
      }
    });
    const kingdom = getKingdom();
    if (remove && kingdom) await kingdom.update({ [`settlements.-=${settlementId}`]: null });
    await syncKingdomSettlements();
    if (capitalName && kingdom) await kingdom.update({ capital: capitalName });
    return {};
  },
  finishRankUp: async ({ projectId }) => {
    await finishRankUpNow(projectId);
    return {};
  },
  drawEvents: async () => {
    let drawn = [];
    await updateRealm((realm) => {
      drawn = drawMonthlyEvents(realm);
    });
    await syncPins();
    const key = drawn.length === 0 ? "DrawnNone" : drawn.length === 1 ? "DrawnOne" : "Drawn";
    return { notice: game.i18n.format(`UKM.Manager.${key}`, { count: drawn.length }) };
  },
  drawMatter: async () => {
    let card = null;
    await updateRealm((realm) => {
      card = drawWeeklyMatter(realm);
    });
    return { notice: drawnNotice(card) };
  },
  storyEvent: async ({ eventId }) => {
    const event = getStoryEvents().find((e) => e.id === eventId);
    if (!event) return { ok: false, reason: "Unknown" };
    let card = null;
    await updateRealm((realm) => {
      card = createCard(event);
      realm.cards.push(card);
      addLog(realm, { type: "event-drawn", card: card.id, seat: card.seat, text: card.name });
    });
    await syncPins();
    return { notice: drawnNotice(card) };
  },
  drawAudience: async () => {
    let card = null;
    await updateRealm((realm) => {
      card = drawAudience(realm);
    });
    return { notice: drawnNotice(card) };
  }
};

/** GM-only actions from the Kingdom Manager, run by whichever window keeps the realm. */
export async function gmAction({ op, userId, ...payload }) {
  const user = game.users.get(userId) ?? game.user;
  if (!user.isGM) return { ok: false, reason: "NotGM" };
  const fn = OPS[op];
  if (!fn) return { ok: false, reason: "Unknown" };
  return { ok: true, ...(await fn(payload)) };
}
