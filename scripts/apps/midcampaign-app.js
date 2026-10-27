import { MODULE_ID, REALM_STATS } from "../constants.js";
import { getKingdom } from "../integrations/party.js";
import { suggestedRanks, suggestedTreasury } from "../realm/midcampaign.js";
import { rankCap } from "../realm/rules.js";
import { getRealm } from "../realm/state.js";
import { sendRequest } from "../realm/requests.js";
import { SHEET_CLASSES, bannerContext } from "./dialog.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class MidCampaignApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "ukm-midcampaign",
    tag: "form",
    classes: [...SHEET_CLASSES, "ukm-setup", "ukm-midcampaign"],
    window: { title: "UKM.Start.Title", icon: "fa-solid fa-forward", resizable: true },
    position: { width: 620, height: 700 },
    form: { handler: MidCampaignApp.#onSubmit, closeOnSubmit: true }
  };

  static PARTS = {
    banner: { template: `modules/${MODULE_ID}/templates/common/banner.hbs` },
    form: { template: `modules/${MODULE_ID}/templates/setup/midcampaign.hbs`, scrollable: [".ukm-setup-body"] },
    footer: { template: "templates/generic/form-footer.hbs" }
  };

  async _preparePartContext(partId, context, options) {
    context = await super._preparePartContext(partId, context, options);
    if (partId === "banner") context.banner = bannerContext("UKM.Start.Title");
    return context;
  }

  async _prepareContext() {
    const kingdom = getKingdom();
    const realm = getRealm();
    const level = kingdom?.level ?? 1;
    const suggested = suggestedRanks(level, realm);
    const founding = new Set(realm.founding?.stats ?? []);
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
      buttons: [{ type: "submit", icon: "fa-solid fa-check", label: "UKM.Start.Apply" }]
    };
  }

  static async #onSubmit(event, form, formData) {
    const data = foundry.utils.expandObject(formData.object);
    await sendRequest("gm", {
      op: "startingPoint",
      data: { ranks: data.ranks ?? {}, treasury: Number(data.treasury) }
    });
  }
}
