import { MODULE_ID, REALM_STATS, SEATS } from "../constants.js";
import { getCompanion, getEvent } from "../content/data.js";
import { getImportedPage } from "../content/story-import.js";
import { focusHex, getHexDefinitions, getZone } from "../integrations/kingmaker.js";
import { getControlDC, getFame, getKingdom, getRuin, getUnrest } from "../integrations/party.js";
import { drawMonthlyEvents } from "../realm/deck.js";
import { syncPins } from "../realm/pins.js";
import { canRankUp, rankBonus, statProgress, weeklyIncome } from "../realm/rules.js";
import { getRealm, updateRealm } from "../realm/state.js";
import { daysUntil, formatDate } from "../realm/time.js";
import { getSetting, setSetting, SETTINGS } from "../settings.js";
import { SetupWizard } from "./setup-wizard.js";
import { StoryImportApp } from "./story-import-app.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const LOG_SHOWN = 40;

export class KingdomManager extends HandlebarsApplicationMixin(ApplicationV2) {
  static #instance = null;

  static open() {
    this.#instance ??= new KingdomManager();
    this.#instance.render({ force: true });
    return this.#instance;
  }

  static refresh() {
    if (this.#instance?.rendered) this.#instance.render();
  }

  static DEFAULT_OPTIONS = {
    id: "ukm-manager",
    classes: ["ukm", "ukm-manager"],
    window: { title: "UKM.Manager.Title", icon: "fa-solid fa-chess-rook", resizable: true },
    position: { width: 860, height: 720 },
    actions: {
      openCard: KingdomManager.#openCard,
      focusHex: KingdomManager.#focusHex,
      drawEvents: KingdomManager.#drawEvents,
      openSetup: KingdomManager.#openSetup,
      openImport: KingdomManager.#openImport,
      toggleBetweenSessions: KingdomManager.#toggleBetweenSessions
    }
  };

  static PARTS = {
    tabs: { template: "templates/generic/tab-navigation.hbs" },
    overview: { template: `modules/${MODULE_ID}/templates/manager/overview.hbs`, scrollable: [""] },
    desks: { template: `modules/${MODULE_ID}/templates/manager/desks.hbs`, scrollable: [""] },
    log: { template: `modules/${MODULE_ID}/templates/manager/log.hbs`, scrollable: [""] }
  };

  static TABS = {
    primary: {
      tabs: [
        { id: "overview", icon: "fa-solid fa-landmark", label: "UKM.Manager.Tab.Overview" },
        { id: "desks", icon: "fa-solid fa-inbox", label: "UKM.Manager.Tab.Desks" },
        { id: "log", icon: "fa-solid fa-scroll", label: "UKM.Manager.Tab.Log" }
      ],
      initial: "desks"
    }
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.tabs ??= this._prepareTabs?.("primary");
    const kingdom = getKingdom();
    const realm = getRealm();
    const level = kingdom?.level ?? 1;
    const income = weeklyIncome(realm);

    context.isGM = game.user.isGM;
    context.kingdomActive = !!kingdom?.active;
    context.storyImported = getSetting(SETTINGS.storyImported);
    context.betweenSessions = getSetting(SETTINGS.betweenSessions);
    context.kingdom = {
      name: kingdom?.name || game.i18n.localize("UKM.Manager.Unnamed"),
      level,
      size: kingdom?.size ?? 0,
      controlDC: getControlDC(),
      unrest: getUnrest(),
      fame: getFame(),
      ruin: Object.entries(getRuin()).map(([key, r]) => ({
        key,
        label: game.i18n.localize(`UKM.Ruin.${key}`),
        ...r,
        percent: Math.round((r.value / Math.max(r.max, 1)) * 100)
      }))
    };
    context.treasury = realm.treasury;
    context.income = income;
    context.debt = realm.debt;
    context.stats = Object.entries(REALM_STATS).map(([key, def]) => {
      const stat = realm.stats[key];
      return {
        key,
        label: game.i18n.localize(`UKM.Stat.${key}`),
        seat: game.i18n.localize(`UKM.Seat.${def.seat}`),
        skills: def.skills.map((s) => game.i18n.localize(`UKM.Skill.${s}`)).join(", "),
        rank: stat.rank,
        points: stat.points,
        bonus: rankBonus(stat.rank),
        progress: statProgress(stat),
        ready: canRankUp(stat, level)
      };
    });
    context.desks = this.#prepareDesks(realm, kingdom);
    context.log = realm.log
      .slice(-LOG_SHOWN)
      .reverse()
      .map((entry) => ({ ...entry, date: formatDate(entry.time), text: this.#logText(entry) }));
    return context;
  }

  async _preparePartContext(partId, context) {
    context = await super._preparePartContext(partId, context);
    if (context.tabs?.[partId]) context.tab = context.tabs[partId];
    return context;
  }

  #prepareDesks(realm, kingdom) {
    const assignments = getSetting(SETTINGS.seatAssignments) ?? {};
    const hexes = new Map(getHexDefinitions().map((h) => [h.key, h]));
    const now = game.time.worldTime;

    return SEATS.map((seat) => {
      const leaderUuid = kingdom?.leadership?.[seat]?.uuid;
      const leader = leaderUuid ? fromUuidSync(leaderUuid) : null;
      const assignment = assignments[seat] ?? {};
      const companion = assignment.companion ? getCompanion(assignment.companion) : null;
      const supervisor = assignment.supervisor ? fromUuidSync(assignment.supervisor) : null;
      const mine =
        (leader?.isOwner && !game.user.isGM) || (supervisor?.isOwner && !game.user.isGM) || false;

      const cards = realm.cards
        .filter((c) => c.seat === seat && ["open", "assigned"].includes(c.status))
        .sort((a, b) => a.deadline - b.deadline)
        .map((card) => {
          const event = getEvent(card.eventId);
          const hex = card.target?.hexKey ? hexes.get(card.target.hexKey) : null;
          const zone = hex ? getZone(hex.zone) : null;
          const showPlace = game.user.isGM || !card.target?.hidden || card.revealed;
          const days = daysUntil(card.deadline, now);
          return {
            ...card,
            hook: event?.hook ?? "",
            skill: (event?.skill ?? []).map((s) => game.i18n.localize(`UKM.Skill.${s}`)).join(" / "),
            mod: event?.mod ?? 0,
            continuous: event?.traits?.includes("continuous"),
            escalate: !!event?.escalate,
            daysLeft: days,
            urgent: days <= 7,
            place: showPlace
              ? card.target?.settlement || (zone ? `${zone.label} (${game.i18n.localize("UKM.Manager.Level")} ${zone.level})` : null)
              : game.i18n.localize("UKM.Manager.Unknown"),
            canFocus: showPlace && !!card.target?.hexKey,
            hasPage: game.user.isGM && !!getImportedPage(`event-${card.eventId}`)
          };
        });

      return {
        seat,
        label: game.i18n.localize(`UKM.Seat.${seat}`),
        holder: leader?.name ?? companion?.name ?? null,
        isCompanion: !leader && !!companion,
        supervisor: supervisor?.name ?? null,
        mine,
        cards,
        empty: !cards.length
      };
    });
  }

  #logText(entry) {
    const key = `UKM.Log.${entry.type}`;
    const data = { name: entry.text ?? "", amount: entry.amount ?? 0 };
    return game.i18n.has(key) ? game.i18n.format(key, data) : entry.text ?? entry.type;
  }

  static #openCard(event, target) {
    const card = getRealm().cards.find((c) => c.id === target.closest("[data-card]")?.dataset.card);
    const page = card ? getImportedPage(`event-${card.eventId}`) : null;
    page?.parent.sheet.render(true, { pageId: page.id });
  }

  static async #focusHex(event, target) {
    const card = getRealm().cards.find((c) => c.id === target.closest("[data-card]")?.dataset.card);
    if (card?.target?.hexKey) await focusHex(card.target.hexKey);
  }

  static async #drawEvents() {
    if (!game.user.isActiveGM) return;
    let drawn = [];
    await updateRealm((realm) => {
      drawn = drawMonthlyEvents(realm);
    });
    await syncPins();
    const key = drawn.length === 0 ? "DrawnNone" : drawn.length === 1 ? "DrawnOne" : "Drawn";
    ui.notifications.info(game.i18n.format(`UKM.Manager.${key}`, { count: drawn.length }));
  }

  static #openSetup() {
    new SetupWizard().render(true);
  }

  static #openImport() {
    new StoryImportApp().render(true);
  }

  static async #toggleBetweenSessions() {
    await setSetting(SETTINGS.betweenSessions, !getSetting(SETTINGS.betweenSessions));
  }
}

Hooks.on(`${MODULE_ID}.refresh`, () => KingdomManager.refresh());
