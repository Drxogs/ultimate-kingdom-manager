import { MODULE_ID, SEATS } from "../constants.js";
import { getCompanions } from "../content/data.js";
import { inspectSources } from "../content/story-import.js";
import { getKingdom, getPlayerCharacters, syncKingdomLevel } from "../integrations/party.js";
import { getSetting, setSetting, SETTINGS } from "../settings.js";
import { StoryImportApp } from "./story-import-app.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

function isCompanionActor(actor, companions) {
  const name = actor.name.toLowerCase();
  return companions.some((c) => {
    const target = c.name.toLowerCase();
    return name === target || name.startsWith(`${target} `) || name.startsWith(`${target},`) || name.startsWith(`${target} (`);
  });
}

export class SetupWizard extends HandlebarsApplicationMixin(ApplicationV2) {
  #showAllActors = false;
  #draft = null;

  constructor(options = {}) {
    const height = Math.min(760, Math.max(420, window.innerHeight - 80));
    super(foundry.utils.mergeObject({ position: { height } }, options));
  }

  static DEFAULT_OPTIONS = {
    id: "ukm-setup",
    tag: "form",
    classes: ["ukm", "ukm-setup"],
    window: { title: "UKM.Setup.Title", icon: "fa-solid fa-crown", resizable: true },
    position: { width: 680, height: 720 },
    form: { handler: SetupWizard.#onSubmit, closeOnSubmit: true },
    actions: {
      openImport: SetupWizard.#openImport,
      openKingdom: SetupWizard.#openKingdom,
      toggleActors: SetupWizard.#toggleActors
    }
  };

  static PARTS = {
    form: { template: `modules/${MODULE_ID}/templates/setup/setup.hbs`, scrollable: [".ukm-setup-body"] },
    footer: { template: "templates/generic/form-footer.hbs" }
  };

  async _prepareContext() {
    const kingdom = getKingdom();
    const sources = inspectSources();
    const assignments = getSetting(SETTINGS.seatAssignments) ?? {};
    const characters = getPlayerCharacters();
    const companions = getCompanions();
    const actorChoices = Object.fromEntries(characters.map((a) => [a.uuid, a.name]));
    const companionChoices = Object.fromEntries(companions.map((c) => [c.id, c.name]));
    const draft = this.#draft;

    const seats = SEATS.map((seat) => {
      const leader = kingdom?.leadership?.[seat] ?? {};
      const assignment = assignments[seat] ?? {};
      const saved = draft?.seats?.[seat];
      return {
        seat,
        label: game.i18n.localize(`UKM.Seat.${seat}`),
        holder: saved?.holder ?? leader.uuid ?? "",
        companion: saved?.companion ?? assignment.companion ?? "",
        supervisor: saved?.supervisor ?? assignment.supervisor ?? ""
      };
    });

    const pcIds = new Set(characters.map((a) => a.uuid));
    const assigned = new Set(seats.map((s) => s.holder).filter(Boolean));
    const otherActors = game.actors
      .filter((a) => !pcIds.has(a.uuid) && ["npc", "character"].includes(a.type))
      .filter((a) => this.#showAllActors || assigned.has(a.uuid) || isCompanionActor(a, companions))
      .sort((a, b) => a.name.localeCompare(b.name));

    return {
      sources,
      kingdomActive: !!kingdom?.active,
      storyImported: getSetting(SETTINGS.storyImported),
      betweenSessions: draft ? !!draft.betweenSessions : getSetting(SETTINGS.betweenSessions),
      approval: draft?.approval ?? getSetting(SETTINGS.betweenSessionsApproval),
      tapTreasury: draft?.tapTreasury ?? getSetting(SETTINGS.tapTreasury),
      advisorWarnings: draft?.advisorWarnings ?? getSetting(SETTINGS.advisorWarnings),
      showAllActors: this.#showAllActors,
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
      holderGroups: [
        { label: game.i18n.localize("UKM.Setup.GroupCharacters"), choices: actorChoices },
        {
          label: game.i18n.localize(this.#showAllActors ? "UKM.Setup.GroupOthers" : "UKM.Setup.GroupCompanions"),
          choices: Object.fromEntries(otherActors.map((a) => [a.uuid, a.name]))
        }
      ].filter((g) => Object.keys(g.choices).length),
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

  static #toggleActors() {
    this.#draft = foundry.utils.expandObject(new foundry.applications.ux.FormDataExtended(this.element).object);
    this.#showAllActors = !this.#showAllActors;
    this.render();
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
