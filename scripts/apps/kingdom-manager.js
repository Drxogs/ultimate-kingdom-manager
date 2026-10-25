import { DEGREES, MODULE_ID, PERSONAL_SKILLS, REALM_STATS, SEATS } from "../constants.js";
import { getCardEvent, getCompanion } from "../content/data.js";
import { getImportedPage } from "../content/story-import.js";
import { focusHex, getHexDefinitions, getZone } from "../integrations/kingmaker.js";
import { getControlDC, getFame, getKingdom, getPlayerCharacters, getRuin, getUnrest } from "../integrations/party.js";
import { drawMonthlyEvents, drawWeeklyMatter } from "../realm/deck.js";
import { syncPins } from "../realm/pins.js";
import { canRankUp, rankBonus, rankCap, routinePoints, statProgress, weeklyIncome } from "../realm/rules.js";
import { getRealm, updateRealm } from "../realm/state.js";
import { finishRankUpNow, rankUpChoices, rankUpCost, rankUpProject } from "../realm/ranks.js";
import { sendRequest } from "../realm/requests.js";
import {
  canActForSeat,
  cardLevelMod,
  cardStage,
  completeGmTask,
  dismissCard,
  estimateCheck,
  outcomePreview,
  recordOutcome,
  rollCard
} from "../realm/resolve.js";
import { daysUntil, formatDate } from "../realm/time.js";
import { getSetting, setSetting, SETTINGS } from "../settings.js";
import { SetupWizard } from "./setup-wizard.js";
import { StoryImportApp } from "./story-import-app.js";

const { ApplicationV2, DialogV2, HandlebarsApplicationMixin } = foundry.applications.api;

function findCard(target) {
  const id = target.closest("[data-card]")?.dataset.card;
  return getRealm().cards.find((c) => c.id === id) ?? null;
}

async function pickKingdomSkill(card) {
  const { skills } = cardStage(card);
  if (skills.length < 2) return skills[0];
  return DialogV2.wait({
    window: { title: card.name },
    content: `<p>${game.i18n.localize("UKM.Card.ChooseSkill")}</p>`,
    buttons: skills.map((s) => {
      const odds = estimateCheck(card, { type: "advisor", skill: s });
      return { action: s, label: `${game.i18n.localize(`UKM.Skill.${s}`)}${odds ? ` — ${odds.label}` : ""}` };
    }),
    rejectClose: false
  });
}

function oddsView(odds) {
  if (!odds) return null;
  const sign = odds.total >= 0 ? "+" : "";
  return {
    key: odds.key,
    label: odds.label,
    skill: game.i18n.localize(`UKM.Skill.${odds.skill}`),
    detail: game.user.isGM ? game.i18n.format("UKM.Difficulty.Detail", { mod: `${sign}${odds.total}`, dc: odds.dc, chance: Math.round(odds.chance * 100) }) : ""
  };
}

function personalChoices(card) {
  const { skills } = cardStage(card);
  const actors = getPlayerCharacters().filter((a) => game.user.isGM || a.isOwner);
  return actors
    .map((actor) => {
      const options = [];
      for (const kingdomSkill of skills) {
        for (const slug of PERSONAL_SKILLS[kingdomSkill] ?? []) {
          const statistic = actor.skills?.[slug];
          if (!statistic) continue;
          const odds = estimateCheck(card, { type: "pc", actorUuid: actor.uuid, personalSkill: slug, skill: kingdomSkill });
          options.push({
            value: `${actor.uuid}|${kingdomSkill}|${slug}`,
            label: `${statistic.label} (${statistic.mod >= 0 ? "+" : ""}${statistic.mod}) — ${game.i18n.localize(`UKM.Skill.${kingdomSkill}`)}${odds ? ` — ${odds.label}` : ""}`,
            mod: statistic.mod
          });
        }
      }
      options.sort((a, b) => b.mod - a.mod);
      return { actor, options };
    })
    .filter((g) => g.options.length);
}

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
      drawMatter: KingdomManager.#drawMatter,
      openSetup: KingdomManager.#openSetup,
      delegate: KingdomManager.#delegate,
      handlePersonally: KingdomManager.#handlePersonally,
      unassign: KingdomManager.#unassign,
      accept: KingdomManager.#accept,
      escalate: KingdomManager.#escalate,
      rollNow: KingdomManager.#rollNow,
      recordOutcome: KingdomManager.#recordOutcome,
      dismiss: KingdomManager.#dismiss,
      toggleTask: KingdomManager.#toggleTask,
      beginRankUp: KingdomManager.#beginRankUp,
      chooseRankUp: KingdomManager.#chooseRankUp,
      finishRankUp: KingdomManager.#finishRankUp,
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
        ...this.#rankUpView(realm, key, def, stat, level),
        routine: Math.round(routinePoints(realm, key, level) * 100) / 100,
        atCap: stat.rank >= rankCap(level)
      };
    });
    context.desks = this.#prepareDesks(realm, kingdom);
    context.gmTasks = game.user.isGM
      ? realm.gmTasks
          .slice()
          .sort((a, b) => Number(a.done) - Number(b.done) || b.created - a.created)
          .map((t) => ({
            ...t,
            date: formatDate(t.created),
            cardName: realm.cards.find((c) => c.id === t.card)?.name ?? "",
            canFocus: !!t.hexKey
          }))
      : [];
    context.openTasks = context.gmTasks.filter((t) => !t.done).length;
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
      const canAct = canActForSeat(game.user, seat);
      const holderName = leader?.name ?? companion?.name ?? null;
      const advisorBusy =
        realm.cards.find((c) => c.status === "assigned" && c.assignee?.type === "advisor" && c.assignee.seat === seat) ??
        realm.projects.find((p) => p.status === "working" && p.seat === seat);

      const cards = realm.cards
        .filter((c) => c.seat === seat && ["open", "assigned", "escalated", "rolled"].includes(c.status))
        .sort((a, b) => a.deadline - b.deadline)
        .map((card) => {
          const event = getCardEvent(card);
          const hex = card.target?.hexKey ? hexes.get(card.target.hexKey) : null;
          const zone = hex ? getZone(hex.zone) : null;
          const showPlace = game.user.isGM || !card.target?.hidden || card.revealed;
          const days = daysUntil(card.deadline, now);
          const stage = cardStage(card);
          const open = card.status === "open";
          return {
            ...card,
            stageLabel: stage.stage?.label ?? null,
            isOpen: open,
            isAssigned: card.status === "assigned",
            isEscalated: card.status === "escalated",
            isRolled: card.status === "rolled",
            rolledResult: card.pendingRoll ? game.i18n.localize(`UKM.Degree.${DEGREES[card.pendingRoll.personal && card.pendingRoll.degree === 2 ? 3 : card.pendingRoll.degree]}`) : null,
            canAccept: card.status === "rolled" && canAct,
            workDays: card.workUntil ? Math.max(0, daysUntil(card.workUntil, now)) : null,
            assigneeName: card.assignee?.name ?? null,
            assigneePersonal: card.assignee?.type === "pc",
            canDelegate: open && canAct && !!holderName && !advisorBusy,
            advisorBusy: open && !!advisorBusy,
            canHandle: open && canAct,
            canUnassign: card.status === "assigned" && canAct,
            canEscalate: open && canAct && !!event?.escalate,
            outcomes: outcomePreview(card),
            advisorOdds: open && holderName ? stage.skills.map((sk) => oddsView(estimateCheck(card, { type: "advisor", skill: sk }, realm))).filter(Boolean) : [],
            currentOdds: card.status === "assigned" && card.assignee ? oddsView(estimateCheck(card, card.assignee, realm)) : null,
            hook: event?.hook ?? "",
            skill: stage.skills.map((s) => game.i18n.localize(`UKM.Skill.${s}`)).join(" / "),
            mod: cardLevelMod(card, realm) + (card.dcAdjust ?? 0),
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
        holder: holderName,
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
    const taskId = target.closest("[data-task]")?.dataset.task;
    const hexKey = taskId
      ? getRealm().gmTasks.find((t) => t.id === taskId)?.hexKey
      : findCard(target)?.target?.hexKey;
    if (hexKey) await focusHex(hexKey);
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

  static async #delegate(event, target) {
    const card = findCard(target);
    if (!card) return;
    const skill = await pickKingdomSkill(card);
    if (!skill) return;
    await sendRequest("assign", { cardId: card.id, type: "advisor", skill });
  }

  static async #handlePersonally(event, target) {
    const card = findCard(target);
    if (!card) return;
    const groups = personalChoices(card);
    if (!groups.length) {
      ui.notifications.warn(game.i18n.localize("UKM.Card.NoPersonalSkill"));
      return;
    }
    const select = groups
      .map(({ actor, options }) => `<optgroup label="${Handlebars.escapeExpression(actor.name)}">${options.map((o) => `<option value="${o.value}">${Handlebars.escapeExpression(o.label)}</option>`).join("")}</optgroup>`)
      .join("");
    const dc = game.i18n.localize("UKM.Card.PersonalHint");
    const choice = await DialogV2.prompt({
      window: { title: card.name },
      content: `<p class="hint">${dc}</p><div class="form-group"><label>${game.i18n.localize("UKM.Card.Who")}</label><select name="choice">${select}</select></div>`,
      ok: { label: game.i18n.localize("UKM.Card.HandlePersonally"), callback: (event, button) => button.form.elements.choice.value },
      rejectClose: false
    });
    if (!choice) return;
    const [actorUuid, skill, personalSkill] = choice.split("|");
    await sendRequest("assign", { cardId: card.id, type: "pc", actorUuid, skill, personalSkill });
  }

  static async #unassign(event, target) {
    const card = findCard(target);
    if (card) await sendRequest("unassign", { cardId: card.id });
  }

  #rankUpView(realm, key, def, stat, level) {
    const project = rankUpProject(realm, key);
    const canAct = canActForSeat(game.user, def.seat);
    const ready = canRankUp(stat, level);
    return {
      ready: ready && !project,
      rankUpWorking: project?.status === "working",
      rankUpChoosing: project?.status === "choosing",
      rankUpDays: project?.status === "working" ? Math.max(0, daysUntil(project.until)) : null,
      projectId: project?.id ?? null,
      canBegin: ready && !project && canAct,
      canChoose: project?.status === "choosing" && canAct,
      cost: rankUpCost(realm)
    };
  }

  static async #beginRankUp(event, target) {
    const stat = target.closest("[data-stat]")?.dataset.stat;
    if (!stat) return;
    const cost = rankUpCost();
    const ok = await DialogV2.confirm({
      window: { title: game.i18n.format("UKM.Rank.ProjectName", { stat: game.i18n.localize(`UKM.Stat.${stat}`) }) },
      content: `<p>${game.i18n.format("UKM.Rank.BeginConfirm", { cost, days: 14 })}</p>`,
      rejectClose: false
    });
    if (ok) await sendRequest("startRankUp", { stat });
  }

  static async #chooseRankUp(event, target) {
    const stat = target.closest("[data-stat]")?.dataset.stat;
    const project = stat ? rankUpProject(getRealm(), stat) : null;
    const choices = project ? rankUpChoices(project) : null;
    if (!choices) return;
    const esc = Handlebars.escapeExpression;
    const always = choices.always.length ? `<p class="hint">${game.i18n.format("UKM.Rank.Always", { effects: choices.always.join(", ") })}</p>` : "";
    const content = `<div class="ukm-scene"><p class="ukm-scene-text">${esc(choices.scene)}</p>${always}<ul class="ukm-scene-options">${choices.options
      .map((o) => `<li><strong>${esc(o.label)}</strong> ${esc(o.text)}<br><span class="hint">${o.lines.map(esc).join("; ")}</span></li>`)
      .join("")}</ul></div>`;
    const option = await DialogV2.wait({
      window: { title: `${choices.title} — ${game.i18n.format("UKM.Rank.ToRank", { stat: game.i18n.localize(`UKM.Stat.${stat}`), rank: project.rank })}` },
      position: { width: 520 },
      content,
      buttons: choices.options.map((o) => ({ action: o.id, label: o.label })),
      rejectClose: false
    });
    if (option) await sendRequest("chooseRankUp", { projectId: project.id, option });
  }

  static async #finishRankUp(event, target) {
    const stat = target.closest("[data-stat]")?.dataset.stat;
    const project = stat ? rankUpProject(getRealm(), stat) : null;
    if (project && game.user.isActiveGM) await finishRankUpNow(project.id);
  }

  static async #accept(event, target) {
    const card = findCard(target);
    if (card) await sendRequest("accept", { cardId: card.id });
  }

  static async #escalate(event, target) {
    const card = findCard(target);
    if (!card) return;
    const ok = await DialogV2.confirm({
      window: { title: card.name },
      content: `<p>${game.i18n.localize("UKM.Card.EscalateConfirm")}</p>`,
      rejectClose: false
    });
    if (ok) await sendRequest("escalate", { cardId: card.id });
  }

  static async #rollNow(event, target) {
    const card = findCard(target);
    if (card && game.user.isActiveGM) await rollCard(card.id);
  }

  static async #recordOutcome(event, target) {
    const card = findCard(target);
    if (!card || !game.user.isActiveGM) return;
    const degree = await DialogV2.wait({
      window: { title: card.name },
      content: `<p>${game.i18n.localize("UKM.Card.RecordPrompt")}</p>`,
      buttons: DEGREES.slice().reverse().map((d) => ({ action: d, label: game.i18n.localize(`UKM.Degree.${d}`) })),
      rejectClose: false
    });
    if (degree) await recordOutcome(card.id, degree);
  }

  static async #dismiss(event, target) {
    const card = findCard(target);
    if (!card || !game.user.isActiveGM) return;
    const ok = await DialogV2.confirm({
      window: { title: card.name },
      content: `<p>${game.i18n.localize("UKM.Card.DismissConfirm")}</p>`,
      rejectClose: false
    });
    if (ok) await dismissCard(card.id);
  }

  static async #toggleTask(event, target) {
    const id = target.closest("[data-task]")?.dataset.task;
    const task = getRealm().gmTasks.find((t) => t.id === id);
    if (task && game.user.isActiveGM) await completeGmTask(id, !task.done);
  }

  static async #drawMatter() {
    if (!game.user.isActiveGM) return;
    let card = null;
    await updateRealm((realm) => {
      card = drawWeeklyMatter(realm);
    });
    ui.notifications.info(card ? game.i18n.format("UKM.Manager.MatterDrawn", { name: card.name }) : game.i18n.localize("UKM.Manager.MatterNone"));
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
