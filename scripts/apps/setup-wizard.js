import { ATTITUDES, FOUNDING_PICKS, HIRED_ADVISOR, MODULE_ID, REALM_STATS, SEATS } from "../constants.js";
import { companionForName, getCompanions } from "../content/data.js";
import { inspectSources } from "../content/story-import.js";
import { getKingdom, getPlayerCharacters, syncKingdomLevel } from "../integrations/party.js";
import { getSetting, setSetting, SETTINGS } from "../settings.js";
import { applyFounding, foundingPicks, resetFounding } from "../realm/ranks.js";
import { getRealm } from "../realm/state.js";
import { StoryImportApp } from "./story-import-app.js";
import { MidCampaignApp } from "./midcampaign-app.js";
import { FOUNDING_TRAINED, trainFoundingSkills } from "../realm/leadership.js";
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
      openKingdom: SetupWizard.#openKingdom,
      toggleActors: SetupWizard.#toggleActors,
      resetFounding: SetupWizard.#resetFounding,
      addAdvisor: SetupWizard.#addAdvisor,
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
      seatChoices: Object.fromEntries(SEATS.filter((x) => x !== "ruler").map((x) => [x, `UKM.Seat.${x}`])),
      training: this.#trainingContext(kingdom),
      buttons: [{ type: "submit", icon: "fa-solid fa-check", label: "UKM.Setup.Save" }]
    };
  }

  #trainingContext(kingdom) {
    const government = new Set(kingdom?.build?.government?.skills ?? []);
    const skills = Object.values(REALM_STATS).flatMap((def) => def.skills);
    const trained = skills.filter((s) => !government.has(s) && (kingdom?.build?.skills?.[s]?.rank ?? 0) >= 1);
    const choices = Object.fromEntries(skills.filter((s) => !government.has(s)).map((s) => [s, game.i18n.localize(`UKM.Skill.${s}`)]));
    return {
      count: FOUNDING_TRAINED,
      government: [...government].map((s) => game.i18n.localize(`UKM.Skill.${s}`)).join(", "),
      slots: Array.from({ length: FOUNDING_TRAINED }, (_, i) => ({ index: i, number: i + 1, selected: this.#draft?.training?.[i] ?? trained[i] ?? "" })),
      choices
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
    if (kingdom?.active) {
      await kingdom.update(foundry.utils.expandObject(leadership));
      await syncKingdomLevel();
      const training = Object.values(data.training ?? {}).filter(Boolean);
      if (new Set(training).size < training.length) ui.notifications.warn(game.i18n.localize("UKM.Setup.TrainingDuplicate"));
      await trainFoundingSkills(training);
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
