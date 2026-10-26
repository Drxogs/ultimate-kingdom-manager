import { DEGREES, MODULE_ID, PERSONAL_SKILLS, REALM_STATS, SEATS } from "../constants.js";
import { getCardEvent, getCompanion } from "../content/data.js";
import { getImportedPage } from "../content/story-import.js";
import { focusHex, getHexDefinitions, getZone } from "../integrations/kingmaker.js";
import { getControlDC, getFame, getKingdom, getPlayerCharacters, getRuin, getUnrest } from "../integrations/party.js";
import { canRankUp, rankBonus, rankCap, routinePoints, seatCompanionId, statProgress, weeklyIncome } from "../realm/rules.js";
import { getRealm, updateRealm } from "../realm/state.js";
import { rankUpChoices, rankUpCost, rankUpProject } from "../realm/ranks.js";
import { buildableStructures, projectQuote, projectsForSeat, projectTargets } from "../realm/projects.js";
import { tapCostBP, tapLimit, tapMode } from "../realm/treasury.js";
import { audienceResponses } from "../realm/audiences.js";
import { proposals } from "../realm/council.js";
import { ambitionsView } from "../realm/ambitions.js";
import { openHandbook } from "../content/handbook.js";
import { getProject } from "../content/data.js";
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
      startProject: KingdomManager.#startProject,
      openHandbook: () => openHandbook(),
      tapTreasury: KingdomManager.#tapTreasury,
      hearAudience: KingdomManager.#hearAudience,
      drawAudience: KingdomManager.#drawAudience,
      vote: KingdomManager.#vote,
      fundProposal: KingdomManager.#fundProposal,
      rejectProposal: KingdomManager.#rejectProposal,
      repayDebt: KingdomManager.#repayDebt,
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
    council: { template: `modules/${MODULE_ID}/templates/manager/council.hbs`, scrollable: [""] },
    log: { template: `modules/${MODULE_ID}/templates/manager/log.hbs`, scrollable: [""] }
  };

  static TABS = {
    primary: {
      tabs: [
        { id: "overview", icon: "fa-solid fa-landmark", label: "UKM.Manager.Tab.Overview" },
        { id: "desks", icon: "fa-solid fa-inbox", label: "UKM.Manager.Tab.Desks" },
        { id: "council", icon: "fa-solid fa-landmark-dome", label: "UKM.Manager.Tab.Council" },
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
    context.canRepay = realm.debt.amount > 0 && getPlayerCharacters().some((a) => game.user.isGM || a.isOwner);
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
    context.council = this.#prepareCouncil(realm);
    context.ambitions = ambitionsView(realm);
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
      const companionId = seatCompanionId(seat);
      const companion = companionId ? getCompanion(companionId) : null;
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
            canDelegate: open && canAct && !!holderName && !advisorBusy && card.kind !== "audience",
            advisorBusy: open && !!advisorBusy,
            canHandle: open && canAct && !event?.advisorOnly && card.kind !== "audience",
            isAudience: card.kind === "audience",
            isProject: card.kind === "project",
            canHear: open && canAct && card.kind === "audience",
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
        advisor: leader && companion && !leader.name.toLowerCase().startsWith(companion.name.toLowerCase()) ? companion.name : null,
        supervisor: supervisor && supervisor.uuid !== leader?.uuid ? supervisor.name : null,
        mine,
        canStartProject: canAct && projectsForSeat(seat).length > 0,
        canTap: seat === "treasurer" && canAct && tapMode() !== "disabled",
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
    await sendRequest("gm", { op: "drawEvents" });
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

  static async #startProject(event, target) {
    const seat = target.closest("[data-seat]")?.dataset.seat;
    const defs = projectsForSeat(seat);
    if (!defs.length) return;
    const esc = Handlebars.escapeExpression;
    const type =
      defs.length === 1
        ? defs[0].id
        : await DialogV2.wait({
            window: { title: game.i18n.localize("UKM.Project.StartTitle") },
            content: `<ul class="ukm-scene-options">${defs.map((d) => `<li><strong>${esc(d.name)}</strong> ${esc(d.hook)}</li>`).join("")}</ul>`,
            buttons: defs.map((d) => ({ action: d.id, label: d.name })),
            rejectClose: false
          });
    const def = type ? getProject(type) : null;
    if (!def) return;

    const targets = projectTargets(def);
    if (!targets.length) {
      ui.notifications.warn(game.i18n.localize(`UKM.Project.NoTargets.${def.target}`));
      return;
    }
    const structures = def.target === "settlement" ? buildableStructures() : [];
    if (def.target === "settlement" && !structures.length) {
      ui.notifications.warn(game.i18n.localize("UKM.Project.NoStructures"));
      return;
    }
    const probe = { eventId: `project:${def.id}`, seat: def.seat, dcAdjust: 0 };
    const odds = estimateCheck(probe, { type: "advisor", skill: def.skill[0] });
    const quoteText = (q) => game.i18n.format("UKM.Project.Quote", { cost: q.cost, days: q.days });
    const targetOptions = targets
      .map((t, i) => `<option value="${i}">${esc(t.label)}${def.target === "settlement" ? "" : ` — ${quoteText(projectQuote(def, t))}`}</option>`)
      .join("");
    const structureField = structures.length
      ? `<div class="form-group"><label>${game.i18n.localize("UKM.Project.Structure")}</label><select name="structure">${structures
          .map((s) => `<option value="${s.slug}">${esc(s.name)}${s.level ? ` (${s.level})` : ""} — ${quoteText(projectQuote(def, null, s))}</option>`)
          .join("")}</select></div>`
      : "";
    const campField =
      def.id === "establish-work-site"
        ? `<div class="form-group"><label>${game.i18n.localize("UKM.Project.CampLabel")}</label><select name="camp">${["lumber", "quarry", "mine"]
            .map((c) => `<option value="${c}">${game.i18n.localize(`UKM.Project.Camp.${c}`)}</option>`)
            .join("")}</select><p class="hint">${game.i18n.localize("UKM.Project.CampHint")}</p></div>`
        : "";
    const content = `<p>${esc(def.hook)}</p>${odds ? `<p class="hint">${game.i18n.localize("UKM.Difficulty.Advisor")} ${odds.label}</p>` : ""}
      ${def.target === "none"
        ? `<input type="hidden" name="target" value="0"><p>${quoteText(projectQuote(def, targets[0]))}</p>`
        : `<div class="form-group"><label>${game.i18n.localize(def.target === "settlement" ? "UKM.Project.Where" : "UKM.Project.Hex")}</label><select name="target">${targetOptions}</select></div>`}
      ${structureField}${campField}<p class="hint">${game.i18n.format("UKM.Project.Treasury", { bp: getRealm().treasury })}</p>`;
    const read = (mode) => (event, button) => ({
      mode,
      target: button.form.elements.target.value,
      structure: button.form.elements.structure?.value ?? null,
      camp: button.form.elements.camp?.value ?? null
    });
    const buttons = [{ action: "start", label: game.i18n.localize("UKM.Project.Start"), icon: "fa-solid fa-hammer", default: true, callback: read("start") }];
    if (getSetting(SETTINGS.council)) buttons.push({ action: "propose", label: game.i18n.localize("UKM.Council.Propose"), icon: "fa-solid fa-landmark-dome", callback: read("propose") });
    const choice = await DialogV2.wait({ window: { title: def.name }, position: { width: 520 }, content, buttons, rejectClose: false });
    if (!choice?.mode) return;
    const picked = targets[Number(choice.target)];
    const request = { type: def.id, hexKey: picked.hexKey, structure: choice.structure, camp: choice.camp };
    await sendRequest(choice.mode === "propose" ? "proposeProject" : "startProject", request);
  }

  #prepareCouncil(realm) {
    const isRuler = game.user.isGM || canActForSeat(game.user, "ruler");
    const all = proposals(realm);
    const view = (p) => {
      const yes = Object.values(p.votes).filter((v) => v > 0).length;
      const no = Object.values(p.votes).filter((v) => v < 0).length;
      return {
        ...p,
        seatLabel: game.i18n.localize(`UKM.Seat.${p.seat}`),
        yes,
        no,
        myVote: p.votes[game.user.id] ?? 0,
        affordable: realm.treasury >= p.cost,
        canFund: isRuler && p.status === "open",
        canReject: p.status === "open" && (isRuler || p.by === game.user.id),
        statusLabel: game.i18n.localize(`UKM.Council.Status.${p.status}`)
      };
    };
    const open = all.filter((p) => p.status === "open").map(view);
    return {
      enabled: getSetting(SETTINGS.council),
      open,
      empty: !open.length,
      recent: all.filter((p) => p.status !== "open").slice(-10).reverse().map(view),
      treasury: realm.treasury,
      asked: open.reduce((sum, p) => sum + p.cost, 0),
      isRuler
    };
  }

  static async #hearAudience(event, target) {
    const card = findCard(target);
    const data = card ? audienceResponses(card) : null;
    if (!data) return;
    const esc = Handlebars.escapeExpression;
    const content = `<div class="ukm-scene"><p><strong>${esc(data.petitioner)}</strong></p><p class="ukm-scene-text">"${esc(data.request)}"</p><ul class="ukm-scene-options">${data.responses
      .map((r) => `<li><strong>${esc(r.label)}</strong>${r.lines.length ? `<br><span class="hint">${r.lines.map(esc).join("; ")}</span>` : ""}</li>`)
      .join("")}</ul></div>`;
    const response = await DialogV2.wait({
      window: { title: card.name },
      position: { width: 520 },
      content,
      buttons: data.responses.map((r) => ({ action: r.id, label: r.label })),
      rejectClose: false
    });
    if (response) await sendRequest("answerAudience", { cardId: card.id, response });
  }

  static async #drawAudience() {
    await sendRequest("gm", { op: "drawAudience" });
  }

  static async #vote(event, target) {
    const proposalId = target.closest("[data-proposal]")?.dataset.proposal;
    if (proposalId) await sendRequest("voteProposal", { proposalId, vote: Number(target.dataset.vote) });
  }

  static async #fundProposal(event, target) {
    const proposalId = target.closest("[data-proposal]")?.dataset.proposal;
    if (proposalId) await sendRequest("fundProposal", { proposalId });
  }

  static async #rejectProposal(event, target) {
    const proposalId = target.closest("[data-proposal]")?.dataset.proposal;
    if (proposalId) await sendRequest("rejectProposal", { proposalId });
  }

  static #characterOptions() {
    return getPlayerCharacters()
      .filter((a) => game.user.isGM || a.isOwner)
      .map((a) => `<option value="${a.uuid}">${Handlebars.escapeExpression(a.name)}</option>`)
      .join("");
  }

  static async #tapTreasury() {
    const options = KingdomManager.#characterOptions();
    if (!options) return;
    const limit = tapLimit();
    const cost = tapCostBP(limit);
    const debt = getRealm().debt.amount;
    const content = `<p>${game.i18n.format("UKM.Tap.Explain", { gold: limit, cost })}</p>
      ${debt ? `<p class="ukm-urgent">${game.i18n.format("UKM.Tap.DebtWarning", { debt })}</p>` : ""}
      ${tapMode() === "approval" && !game.user.isGM ? `<p class="hint">${game.i18n.localize("UKM.Tap.NeedsApproval")}</p>` : ""}
      <div class="form-group"><label>${game.i18n.localize("UKM.Tap.Recipient")}</label><select name="actor">${options}</select></div>`;
    const actorUuid = await DialogV2.prompt({
      window: { title: game.i18n.localize("UKM.Tap.Title") },
      position: { width: 480 },
      content,
      ok: { label: game.i18n.localize("UKM.Tap.Confirm"), callback: (event, button) => button.form.elements.actor.value },
      rejectClose: false
    });
    if (actorUuid) await sendRequest("tapTreasury", { actorUuid });
  }

  static async #repayDebt() {
    const options = KingdomManager.#characterOptions();
    const debt = getRealm().debt.amount;
    if (!options || !debt) return;
    const choice = await DialogV2.prompt({
      window: { title: game.i18n.localize("UKM.Tap.RepayTitle") },
      content: `<p>${game.i18n.format("UKM.Tap.RepayExplain", { debt })}</p>
        <div class="form-group"><label>${game.i18n.localize("UKM.Tap.Payer")}</label><select name="actor">${options}</select></div>
        <div class="form-group"><label>${game.i18n.localize("UKM.Tap.Amount")}</label><input type="number" name="amount" min="1" max="${debt}" value="${debt}"></div>`,
      ok: {
        label: game.i18n.localize("UKM.Tap.Repay"),
        callback: (event, button) => ({ actorUuid: button.form.elements.actor.value, amount: Number(button.form.elements.amount.value) })
      },
      rejectClose: false
    });
    if (choice) await sendRequest("repayDebt", choice);
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
    if (project) await sendRequest("gm", { op: "finishRankUp", projectId: project.id });
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
    if (card) await sendRequest("gm", { op: "rollNow", cardId: card.id });
  }

  static async #recordOutcome(event, target) {
    const card = findCard(target);
    if (!card || !game.user.isGM) return;
    const degree = await DialogV2.wait({
      window: { title: card.name },
      content: `<p>${game.i18n.localize("UKM.Card.RecordPrompt")}</p>`,
      buttons: DEGREES.slice().reverse().map((d) => ({ action: d, label: game.i18n.localize(`UKM.Degree.${d}`) })),
      rejectClose: false
    });
    if (degree) await sendRequest("gm", { op: "record", cardId: card.id, degree });
  }

  static async #dismiss(event, target) {
    const card = findCard(target);
    if (!card || !game.user.isGM) return;
    const ok = await DialogV2.confirm({
      window: { title: card.name },
      content: `<p>${game.i18n.localize("UKM.Card.DismissConfirm")}</p>`,
      rejectClose: false
    });
    if (ok) await sendRequest("gm", { op: "dismiss", cardId: card.id });
  }

  static async #toggleTask(event, target) {
    const id = target.closest("[data-task]")?.dataset.task;
    const task = getRealm().gmTasks.find((t) => t.id === id);
    if (task) await sendRequest("gm", { op: "task", taskId: id });
  }

  static async #drawMatter() {
    await sendRequest("gm", { op: "drawMatter" });
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
