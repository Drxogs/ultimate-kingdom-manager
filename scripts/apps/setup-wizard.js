import { ATTITUDES, FOUNDING_PICKS, HIRED_ADVISOR, MODULE_ID, REALM_STATS, SEATS } from "../constants.js";
import { companionForName, getCompanions } from "../content/data.js";
import { inspectSources } from "../content/story-import.js";
import { getKingdom, getPlayerCharacters, syncKingdomLevel } from "../integrations/party.js";
import { getSetting, setSetting, SETTINGS } from "../settings.js";
import { applyFounding, foundingPicks, resetFounding } from "../realm/ranks.js";
import { getRealm } from "../realm/state.js";
import { legacyAvailable } from "../realm/legacy.js";
import { sendRequest } from "../realm/requests.js";
import { StoryImportApp } from "./story-import-app.js";
import { MidCampaignApp } from "./midcampaign-app.js";
import { isKnownAdvisor } from "../realm/rules.js";
import { SHEET_CLASSES, UkmDialog, bannerContext } from "./dialog.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

function companionOfActor(actor) {
  return companionForName(actor.name);
}

function isCompanionActor(actor) {
  return !!companionOfActor(actor);
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
    classes: [...SHEET_CLASSES, "ukm-setup"],
    window: { title: "UKM.Setup.Title", icon: "fa-solid fa-crown", resizable: true },
    position: { width: 680, height: 720 },
    form: { handler: SetupWizard.#onSubmit, closeOnSubmit: true },
    actions: {
      openImport: SetupWizard.#openImport,
      toggleActors: SetupWizard.#toggleActors,
      resetFounding: SetupWizard.#resetFounding,
      importLegacy: SetupWizard.#importLegacy,
      addAdvisor: SetupWizard.#addAdvisor,
      foundCapital: SetupWizard.#foundCapital,
      removeAdvisor: SetupWizard.#removeAdvisor,
      openMidCampaign: () => new MidCampaignApp().render(true)
    }
  };

  static PARTS = {
    banner: { template: `modules/${MODULE_ID}/templates/common/banner.hbs` },
    form: { template: `modules/${MODULE_ID}/templates/setup/setup.hbs`, scrollable: [".ukm-setup-body"] },
    footer: { template: "templates/generic/form-footer.hbs" }
  };

  async _preparePartContext(partId, context, options) {
    context = await super._preparePartContext(partId, context, options);
    if (partId === "banner") context.banner = bannerContext("UKM.Setup.Title");
    return context;
  }

  async _prepareContext() {
    const kingdom = getKingdom();
    const sources = inspectSources();
    const assignments = getSetting(SETTINGS.seatAssignments) ?? {};
    const characters = getPlayerCharacters();
    const companions = getCompanions();
    const actorChoices = Object.fromEntries(characters.map((a) => [a.uuid, a.name]));
    // Each seat offers only the companions suited to it (and a hired advisor). Someone already placed
    // in a seat they don't suit stays listed, marked, so the GM can see why they no longer count.
    const draftKnown = this.#draft?.advisors;
    const known = (id) => draftKnown?.[id]?.known ?? isKnownAdvisor(id);
    // Only advisors the party has met (the GM ticks Known below) are offered.
    const companionChoicesFor = (seat, current) => {
      const choices = Object.fromEntries(companions.filter((c) => c.seats?.includes(seat) && (known(c.id) || c.id === current)).map((c) => [c.id, c.name]));
      const misplaced = current && current !== HIRED_ADVISOR && !choices[current] ? companions.find((c) => c.id === current) : null;
      if (misplaced) choices[misplaced.id] = game.i18n.format("UKM.Setup.NotSuited", { name: misplaced.name });
      choices[HIRED_ADVISOR] = game.i18n.localize("UKM.Hired.Option");
      return choices;
    };
    const attitudes = getSetting(SETTINGS.companionAttitudes) ?? {};
    const attitudeChoices = Object.fromEntries(ATTITUDES.map((a) => [a, `UKM.Attitude.${a}`]));
    const draft = this.#draft;

    const seats = SEATS.map((seat) => {
      const leader = kingdom?.leadership?.[seat] ?? {};
      const assignment = assignments[seat] ?? {};
      const saved = draft?.seats?.[seat];
      const companion = saved?.companion ?? assignment.companion ?? "";
      return {
        seat,
        label: game.i18n.localize(`UKM.Seat.${seat}`),
        holder: saved?.holder ?? leader.uuid ?? "",
        companion,
        companionChoices: companionChoicesFor(seat, companion),
        supervisor: saved?.supervisor ?? assignment.supervisor ?? ""
      };
    });

    const pcIds = new Set(characters.map((a) => a.uuid));
    const assigned = new Set(seats.map((s) => s.holder).filter(Boolean));
    const otherActors = game.actors
      .filter((a) => !pcIds.has(a.uuid) && ["npc", "character"].includes(a.type))
      .filter((a) => this.#showAllActors || assigned.has(a.uuid) || isCompanionActor(a, companions))
      .sort((a, b) => a.name.localeCompare(b.name));

    // Companion actors are offered as holders only for the seats they suit; a player character fits any seat.
    const holderGroupsFor = (seat, current) => {
      const others = otherActors.filter((a) => {
        const companion = companionOfActor(a);
        return !companion || (companion.seats?.includes(seat) && known(companion.id)) || a.uuid === current;
      });
      return [
        { label: game.i18n.localize("UKM.Setup.GroupCharacters"), choices: actorChoices },
        {
          label: game.i18n.localize(this.#showAllActors ? "UKM.Setup.GroupOthers" : "UKM.Setup.GroupCompanions"),
          choices: Object.fromEntries(others.map((a) => [a.uuid, a.name]))
        }
      ].filter((g) => Object.keys(g.choices).length);
    };

    const picked = foundingPicks(getRealm());
    const statChoices = Object.fromEntries(
      Object.entries(REALM_STATS).map(([key, def]) => [
        key,
        `${game.i18n.localize(`UKM.Stat.${key}`)} (${def.skills.map((s) => game.i18n.localize(`UKM.Skill.${s}`)).join(", ")})`
      ])
    );

    return {
      sources,
      legacy: legacyAvailable(),
      founding: {
        picked: picked.map((s) => game.i18n.localize(`UKM.Stat.${s}`)).join(", "),
        done: picked.length > 0,
        slots: Array.from({ length: FOUNDING_PICKS }, (_, i) => ({ index: i, number: i + 1, selected: draft?.founding?.[i] ?? "" })),
        choices: statChoices
      },
      kingdomActive: !!kingdom?.active,
      partyLevel: kingdom?.level ?? 1,
      suggestStart: (kingdom?.level ?? 1) >= 3 && !getRealm().startingPoint && Object.values(getRealm().stats).every((s) => s.rank === 0),
      storyImported: getSetting(SETTINGS.storyImported),
      tapTreasury: draft?.tapTreasury ?? getSetting(SETTINGS.tapTreasury),
      showAllActors: this.#showAllActors,
      tapChoices: {
        approval: "UKM.Settings.TapTreasury.Approval",
        allowed: "UKM.Settings.TapTreasury.Allowed",
        disabled: "UKM.Settings.TapTreasury.Disabled"
      },
      seats: seats.map((row) => ({ ...row, holderGroups: holderGroupsFor(row.seat, row.holder) })),
      holderGroups: [
        { label: game.i18n.localize("UKM.Setup.GroupCharacters"), choices: actorChoices },
        {
          label: game.i18n.localize(this.#showAllActors ? "UKM.Setup.GroupOthers" : "UKM.Setup.GroupCompanions"),
          choices: Object.fromEntries(otherActors.map((a) => [a.uuid, a.name]))
        }
      ].filter((g) => Object.keys(g.choices).length),
      supervisorChoices: actorChoices,
      attitudeChoices,
      advisorRows: companions.map((c) => ({
        id: c.id,
        name: c.name,
        seats: c.seats.map((x) => game.i18n.localize(`UKM.Seat.${x}`)).join(", "),
        kind: game.i18n.localize(c.custom ? "UKM.Setup.AdvisorCustom" : c.npc ? "UKM.Setup.AdvisorNpc" : "UKM.Setup.AdvisorCompanion"),
        custom: !!c.custom,
        known: known(c.id),
        attitude: draft?.advisors?.[c.id]?.attitude ?? attitudes[c.id] ?? "friendly"
      })),
      seatChoices: Object.fromEntries(SEATS.map((x) => [x, `UKM.Seat.${x}`])),
      // Any NPC in the world can be added as an advisor: their names are offered as you type.
      advisorActorNames: [...new Set(game.actors.filter((a) => a.type === "npc" || (a.type === "character" && !pcIds.has(a.uuid))).map((a) => a.name))].sort((a, b) => a.localeCompare(b)),
      kingdomName: this.#draft?.kingdomName ?? kingdom?.name ?? "",
      ruler: this.#draft?.ruler ?? getRealm().kingdom?.ruler ?? "",
      rulerChoices: actorChoices,
      capital: (getRealm().settlements ?? []).find((s) => s.capital)?.name ?? null,
      buttons: [{ type: "submit", icon: "fa-solid fa-check", label: "UKM.Setup.Save" }]
    };
  }

  static async #onSubmit(event, form, formData) {
    const data = foundry.utils.expandObject(formData.object);
    await setSetting(SETTINGS.tapTreasury, data.tapTreasury);
    if (data.advisors) {
      const attitudes = {};
      const known = {};
      for (const [id, row] of Object.entries(data.advisors)) {
        attitudes[id] = row.attitude;
        known[id] = !!row.known;
      }
      await setSetting(SETTINGS.companionAttitudes, attitudes);
      await setSetting(SETTINGS.knownAdvisors, known);
    }

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
    if (kingdom) {
      // Saving Setup is what starts the kingdom: its name, its seats, and its level from the party.
      const name = String(data.kingdomName ?? "").trim().slice(0, 40) || kingdom.name || game.i18n.localize("UKM.Manager.Unnamed");
      // The ruler is a title for one player character, never an NPC (Realm Redesign).
      const ruler = getPlayerCharacters().some((a) => a.uuid === data.ruler) ? data.ruler : null;
      await kingdom.update({ ...leadership, name, ruler, active: true });
      await syncKingdomLevel();
      const capital = (getRealm().settlements ?? []).find((x) => x.capital);
      if (capital && data.capitalName !== undefined && String(data.capitalName).trim() && String(data.capitalName).trim() !== capital.name) {
        const { renameSettlement } = await import("../realm/settlements.js");
        const renamed = await renameSettlement(capital.id, data.capitalName);
        if (!renamed.ok) ui.notifications.warn(game.i18n.localize(`UKM.Request.Reason.${renamed.reason}`));
      }
      const picks = Object.values(data.founding ?? {}).filter(Boolean);
      if (picks.length === FOUNDING_PICKS && new Set(picks).size === FOUNDING_PICKS) await applyFounding(picks);
      else if (picks.length) ui.notifications.warn(game.i18n.localize("UKM.Setup.FoundingIncomplete"));
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

  /** Test build: copy a v0.22 kingdom in this world into this module's data. */
  static async #importLegacy() {
    const ok = await UkmDialog.confirm({
      window: { title: game.i18n.localize("UKM.Legacy.Title") },
      content: `<p>${game.i18n.localize("UKM.Legacy.Confirm")}</p>`,
      rejectClose: false
    });
    if (!ok) return;
    const result = await sendRequest("gm", { op: "importLegacy" });
    if (result?.ok !== false) ui.notifications.info(game.i18n.localize("UKM.Legacy.Done"));
    this.render();
  }

  static async #resetFounding() {
    const ok = await UkmDialog.confirm({
      window: { title: game.i18n.localize("UKM.Setup.Founding") },
      content: `<p>${game.i18n.localize("UKM.Setup.FoundingResetConfirm")}</p>`,
      rejectClose: false
    });
    if (!ok) return;
    this.#draft = foundry.utils.expandObject(new foundry.applications.ux.FormDataExtended(this.element).object);
    await resetFounding();
    this.render();
  }

  /** Add an NPC of the GM's own as an advisor for one seat. Saved straight away; the rest of the form is kept. */
  static async #addAdvisor() {
    const draft = foundry.utils.expandObject(new foundry.applications.ux.FormDataExtended(this.element).object);
    const name = String(draft.newAdvisor?.name ?? "").trim();
    const seat = draft.newAdvisor?.seat;
    if (!name || !seat) {
      ui.notifications.warn(game.i18n.localize("UKM.Setup.AdvisorNeedsName"));
      return;
    }
    const list = getSetting(SETTINGS.customAdvisors) ?? [];
    const id = `custom-${foundry.utils.randomID(8)}`;
    await setSetting(SETTINGS.customAdvisors, [...list, { id, name, seats: [seat] }]);
    delete draft.newAdvisor;
    this.#draft = draft;
    this.render();
  }

  static async #removeAdvisor(event, target) {
    const id = target.closest("[data-advisor]")?.dataset.advisor;
    if (!id) return;
    const draft = foundry.utils.expandObject(new foundry.applications.ux.FormDataExtended(this.element).object);
    await setSetting(SETTINGS.customAdvisors, (getSetting(SETTINGS.customAdvisors) ?? []).filter((a) => a.id !== id));
    for (const row of Object.values(draft.seats ?? {})) if (row.companion === id) row.companion = "";
    if (draft.advisors) delete draft.advisors[id];
    this.#draft = draft;
    this.render();
  }

  static async #foundCapital() {
    const { KingdomManager } = await import("./kingdom-manager.js");
    this.#draft = foundry.utils.expandObject(new foundry.applications.ux.FormDataExtended(this.element).object);
    await KingdomManager.foundCapitalDialog();
    this.render();
  }

  static #openImport() {
    new StoryImportApp().render(true);
  }

}

Hooks.on(`${MODULE_ID}.refresh`, () => {
  const app = foundry.applications.instances.get("ukm-setup");
  if (app?.rendered) app.render();
});
