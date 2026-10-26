import { MODULE_ID, REALM_STATS } from "../constants.js";
import { getKingdom } from "../integrations/party.js";
import { boostPlan, skillPlan, suggestedRanks, suggestedTreasury } from "../realm/midcampaign.js";
import { rankCap } from "../realm/rules.js";
import { getRealm } from "../realm/state.js";
import { sendRequest } from "../realm/requests.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class MidCampaignApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "ukm-midcampaign",
    tag: "form",
    classes: ["ukm", "ukm-setup", "ukm-midcampaign"],
    window: { title: "UKM.Start.Title", icon: "fa-solid fa-forward", resizable: true },
    position: { width: 620, height: 700 },
    form: { handler: MidCampaignApp.#onSubmit, closeOnSubmit: true }
  };

  static PARTS = {
    form: { template: `modules/${MODULE_ID}/templates/setup/midcampaign.hbs`, scrollable: [".ukm-setup-body"] },
    footer: { template: "templates/generic/form-footer.hbs" }
  };

  async _prepareContext() {
    const kingdom = getKingdom();
    const realm = getRealm();
    const level = kingdom?.level ?? 1;
    const suggested = suggestedRanks(level, realm);
    const founding = new Set(realm.founding?.stats ?? []);
    const rank = (n) => game.i18n.localize(`UKM.Start.Prof${n}`);
    return {
      level,
      cap: rankCap(level),
      stats: Object.entries(REALM_STATS).map(([key, def]) => ({
        key,
        label: game.i18n.localize(`UKM.Stat.${key}`),
        seat: game.i18n.localize(`UKM.Seat.${def.seat}`),
        current: realm.stats[key].rank,
        value: Math.max(realm.stats[key].rank, suggested[key]),
        founding: founding.has(key)
      })),
      treasury: suggestedTreasury(realm),
      skills: skillPlan(level, kingdom).map((row) => ({
        label: game.i18n.localize(`UKM.Skill.${row.skill}`),
        now: rank(row.now),
        planned: rank(row.planned),
        changed: row.changed
      })),
      boosts: boostPlan(level, kingdom).map((row) => ({
        level: row.level,
        text: row.boosts.map((a) => game.i18n.localize(`UKM.Ability.${a}`)).join(", ")
      })),
      buttons: [{ type: "submit", icon: "fa-solid fa-check", label: "UKM.Start.Apply" }]
    };
  }

  static async #onSubmit(event, form, formData) {
    const data = foundry.utils.expandObject(formData.object);
    await sendRequest("gm", {
      op: "startingPoint",
      data: { ranks: data.ranks ?? {}, treasury: Number(data.treasury), skills: !!data.skills, boosts: !!data.boosts }
    });
  }
}
