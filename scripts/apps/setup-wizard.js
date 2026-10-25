import { MODULE_ID, SEATS } from "../constants.js";
import { getCompanions } from "../content/data.js";
import { inspectSources } from "../content/story-import.js";
import { getKingdom, getPlayerCharacters, syncKingdomLevel } from "../integrations/party.js";
import { getSetting, setSetting, SETTINGS } from "../settings.js";
import { StoryImportApp } from "./story-import-app.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class SetupWizard extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "ukm-setup",
    tag: "form",
    classes: ["ukm", "ukm-setup"],
    window: { title: "UKM.Setup.Title", icon: "fa-solid fa-crown", resizable: true },
    position: { width: 640, height: "auto" },
    form: { handler: SetupWizard.#onSubmit, closeOnSubmit: true },
    actions: { openImport: SetupWizard.#openImport, openKingdom: SetupWizard.#openKingdom }
  };

  static PARTS = {
    form: { template: `modules/${MODULE_ID}/templates/setup/setup.hbs`, scrollable: [""] },
    footer: { template: "templates/generic/form-footer.hbs" }
  };

  async _prepareContext() {
    const kingdom = getKingdom();
    const sources = inspectSources();
    const assignments = getSetting(SETTINGS.seatAssignments) ?? {};
    const characters = getPlayerCharacters();
    const actorChoices = Object.fromEntries(characters.map((a) => [a.uuid, a.name]));
    const npcActors = game.actors.filter((a) => a.type === "npc");
    const companionChoices = Object.fromEntries(getCompanions().map((c) => [c.id, c.name]));

    const seats = SEATS.map((seat) => {
      const leader = kingdom?.leadership?.[seat] ?? {};
      const assignment = assignments[seat] ?? {};
      return {
        seat,
        label: game.i18n.localize(`UKM.Seat.${seat}`),
        holder: leader.uuid ?? "",
        companion: assignment.companion ?? "",
        supervisor: assignment.supervisor ?? "",
        isPc: !!leader.uuid && characters.some((c) => c.uuid === leader.uuid)
      };
    });

    return {
      sources,
      kingdomActive: !!kingdom?.active,
      storyImported: getSetting(SETTINGS.storyImported),
      betweenSessions: getSetting(SETTINGS.betweenSessions),
      approval: getSetting(SETTINGS.betweenSessionsApproval),
      tapTreasury: getSetting(SETTINGS.tapTreasury),
      advisorWarnings: getSetting(SETTINGS.advisorWarnings),
      approvalChoices: { review: "UKM.Settings.Approval.Review", auto: "UKM.Settings.Approval.Auto" },
      tapChoices: {
        approval: "UKM.Settings.TapTreasury.Approval",
        allowed: "UKM.Settings.TapTreasury.Allowed",
        disabled: "UKM.Settings.TapTreasury.Disabled"
      },
      warningChoices: {
        off: "UKM.Settings.AdvisorWarnings.Off",
        subtle: "UKM.Settings.AdvisorWarnings.Subtle",
        blunt: "UKM.Settings.AdvisorWarnings.Blunt"
      },
      seats,
      holderChoices: {
        ...actorChoices,
        ...Object.fromEntries(npcActors.map((a) => [a.uuid, `${a.name} (NPC)`]))
      },
      supervisorChoices: actorChoices,
      companionChoices,
      buttons: [{ type: "submit", icon: "fa-solid fa-check", label: "UKM.Setup.Save" }]
    };
  }

  static async #onSubmit(event, form, formData) {
    const data = foundry.utils.expandObject(formData.object);
    await setSetting(SETTINGS.betweenSessions, !!data.betweenSessions);
    await setSetting(SETTINGS.betweenSessionsApproval, data.approval);
    await setSetting(SETTINGS.tapTreasury, data.tapTreasury);
    await setSetting(SETTINGS.advisorWarnings, data.advisorWarnings);

    const assignments = {};
    const leadership = {};
    for (const seat of SEATS) {
      const row = data.seats?.[seat] ?? {};
      assignments[seat] = { companion: row.companion || null, supervisor: row.supervisor || null };
      leadership[`leadership.${seat}.uuid`] = row.holder || null;
      leadership[`leadership.${seat}.vacant`] = !row.holder && !row.companion;
    }
    await setSetting(SETTINGS.seatAssignments, assignments);

    const kingdom = getKingdom();
    if (kingdom?.active) {
      await kingdom.update(foundry.utils.expandObject(leadership));
      await syncKingdomLevel();
    }

    await setSetting(SETTINGS.setupComplete, true);
    Hooks.callAll(`${MODULE_ID}.refresh`);
    ui.notifications.info(game.i18n.localize("UKM.Setup.Saved"));

    if (!getSetting(SETTINGS.storyImported) && inspectSources().adventureImported) {
      new StoryImportApp().render(true);
    }
  }

  static #openImport() {
    new StoryImportApp().render(true);
  }

  static #openKingdom() {
    getKingdom()?.actor?.sheet?.render(true, { tab: "kingdom" });
  }
}

Hooks.on(`${MODULE_ID}.refresh`, () => {
  const app = foundry.applications.instances.get("ukm-setup");
  if (app?.rendered) app.render();
});
