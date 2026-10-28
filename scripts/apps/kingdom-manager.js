import { DEGREES, MODULE_ID, PERSONAL_SKILLS, REALM_STATS, SEATS } from "../constants.js";
import { getCardEvent, getCompanion } from "../content/data.js";
import { getImportedPage } from "../content/story-import.js";
import { focusHex, getHexDefinitions, getZone } from "../integrations/kingmaker.js";
import { getControlDC, getFame, getKingdom, getPlayerCharacters, getRuin, getUnrest } from "../integrations/party.js";
import { canRankUp, companionAttitude, isHired, rankBonus, rankCap, rawSeatCompanionId, routinePoints, seatCompanionId, statProgress, weeklyIncome } from "../realm/rules.js";
import { getRealm, updateRealm } from "../realm/state.js";
import { rankUpChoices, rankUpCost, rankUpProject } from "../realm/ranks.js";
import { isHexProject, projectDiscount, projectQuote, projectsForSeat, projectTargets, trackUnderway } from "../realm/projects.js";
import { hasPinnacle, missingNeeds, nextStep, PINNACLE, sizeFor, stageDef, trackBonuses, trackStage } from "../realm/tracks.js";
import { getTracks } from "../content/data.js";
import { renderPanorama } from "./panorama.js";
import { tapCostBP, tapLimit, tapMode } from "../realm/treasury.js";
import { audienceResponses } from "../realm/audiences.js";
import { proposals } from "../realm/council.js";
import { ambitionsView } from "../realm/ambitions.js";
import { openHandbook } from "../content/handbook.js";
import {
  canFoundCapital,
  hasCapital,
  settlementHex,
  settlements,
  settlementState,
  unknownMapSettlements
} from "../realm/settlements.js";
import { getProject, getStoryEvents } from "../content/data.js";
import { sendRequest } from "../realm/requests.js";
import {
  busyWith,
  canActForSeat,
  seatOpenToAll,
  canCallBack,
  cardLevelMod,
  cardStage,
  completeGmTask,
  dismissCard,
  estimateCheck,
  fortuneUses,
  outcomePreview,
  recordOutcome,
  rollCard,
  seatsOf
} from "../realm/resolve.js";
import { daysUntil, formatDate } from "../realm/time.js";
import { getSetting, SETTINGS } from "../settings.js";
import { SetupWizard } from "./setup-wizard.js";
import { StoryImportApp } from "./story-import-app.js";
import { MidCampaignApp } from "./midcampaign-app.js";
import { UkmDialog } from "./dialog.js";
import { canUseRoyal, favourPreview, favours, ROYAL_POWERS, rulerName, usesLeft } from "../realm/royal.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

function findCard(target) {
  const id = target.closest("[data-card]")?.dataset.card;
  return getRealm().cards.find((c) => c.id === id) ?? null;
}

async function pickKingdomSkill(card) {
  const { skills } = cardStage(card);
  if (skills.length < 2) return skills[0];
  return UkmDialog.wait({
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
  const actors = getPlayerCharacters();
  return actors
    .map((actor) => {
      const own = seatsOf(actor.uuid);
      const lent = !own.includes(card.seat);
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
      const group = lent
        ? `${actor.name} (${game.i18n.format("UKM.Card.LentFrom", { desks: own.length ? own.map((s) => game.i18n.localize(`UKM.Seat.${s}`)).join(", ") : game.i18n.localize("UKM.Card.NoDesk") })})`
        : actor.name;
      return { actor, options, group };
    })
    .filter((g) => g.options.length);
}

const LOG_SHOWN = 40;
const FOLD_KEY = `${MODULE_ID}.folds`;

/** Which collapsible sections this viewer left open. Only a convenience, so failures are ignored. */
function readFold(name) {
  try {
    return !!JSON.parse(localStorage.getItem(FOLD_KEY) ?? "{}")[name];
  } catch {
    return false;
  }
}

function writeFold(name, open) {
  try {
    const folds = JSON.parse(localStorage.getItem(FOLD_KEY) ?? "{}");
    folds[name] = open;
    localStorage.setItem(FOLD_KEY, JSON.stringify(folds));
  } catch {
    /* storage unavailable */
  }
}

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
    classes: ["ukm", "ukm-sheet", "ukm-manager", "themed", "theme-light"],
    window: { title: "UKM.Manager.Title", icon: "fa-solid fa-chess-rook", resizable: true },
    position: { width: 860, height: 720 },
    actions: {
      openCard: KingdomManager.#openCard,
      focusHex: KingdomManager.#focusHex,
      drawEvents: KingdomManager.#drawEvents,
      drawMatter: KingdomManager.#drawMatter,
      storyEvent: KingdomManager.#storyEvent,
      openSetup: KingdomManager.#openSetup,
      delegate: KingdomManager.#delegate,
      handlePersonally: KingdomManager.#handlePersonally,
      unassign: KingdomManager.#unassign,
      accept: KingdomManager.#accept,
      useFortune: KingdomManager.#useFortune,
      useFame: KingdomManager.#useFame,
      royalDecree: KingdomManager.#royalDecree,
      royalCharge: KingdomManager.#royalCharge,
      royalCourt: KingdomManager.#royalCourt,
      useFavour: KingdomManager.#useFavour,
      escalate: KingdomManager.#escalate,
      rollNow: KingdomManager.#rollNow,
      recordOutcome: KingdomManager.#recordOutcome,
      dismiss: KingdomManager.#dismiss,
      toggleTask: KingdomManager.#toggleTask,
      beginRankUp: KingdomManager.#beginRankUp,
      startProject: KingdomManager.#startProject,
      openHandbook: () => openHandbook(),
      foundCapital: () => KingdomManager.foundCapitalDialog(),
      developTrack: KingdomManager.#developTrack,
      gmTrackStage: KingdomManager.#gmTrackStage,
      openMidCampaign: () => new MidCampaignApp().render(true),
      makeCapital: KingdomManager.#makeCapital,
      toggleWaterside: KingdomManager.#toggleWaterside,
      deleteSettlement: KingdomManager.#deleteSettlement,
      reveal: KingdomManager.#reveal,
      tapTreasury: KingdomManager.#tapTreasury,
      hearAudience: KingdomManager.#hearAudience,
      drawAudience: KingdomManager.#drawAudience,
      vote: KingdomManager.#vote,
      fundProposal: KingdomManager.#fundProposal,
      rejectProposal: KingdomManager.#rejectProposal,
      repayDebt: KingdomManager.#repayDebt,
      chooseRankUp: KingdomManager.#chooseRankUp,
      previewRankUp: KingdomManager.#previewRankUp,
      finishRankUp: KingdomManager.#finishRankUp,
      openImport: KingdomManager.#openImport
    }
  };

  static PARTS = {
    header: { template: `modules/${MODULE_ID}/templates/manager/header.hbs` },
    tabs: { template: "templates/generic/tab-navigation.hbs" },
    overview: { template: `modules/${MODULE_ID}/templates/manager/overview.hbs`, scrollable: [""] },
    desks: { template: `modules/${MODULE_ID}/templates/manager/desks.hbs`, scrollable: [""] },
    settlements: { template: `modules/${MODULE_ID}/templates/manager/settlements.hbs`, scrollable: [""] },
    council: { template: `modules/${MODULE_ID}/templates/manager/council.hbs`, scrollable: [""] },
    log: { template: `modules/${MODULE_ID}/templates/manager/log.hbs`, scrollable: [""] }
  };

  static TABS = {
    primary: {
      tabs: [
        { id: "overview", icon: "fa-solid fa-landmark", label: "UKM.Manager.Tab.Overview" },
        { id: "desks", icon: "fa-solid fa-inbox", label: "UKM.Manager.Tab.Desks" },
        { id: "settlements", icon: "fa-solid fa-city", label: "UKM.Manager.Tab.Settlements" },
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
    context.gmAway = !game.user.isGM && !game.users.activeGM;
    context.kingdomActive = !!kingdom?.active;
    context.storyImported = getSetting(SETTINGS.storyImported);
    const fame = getFame();
    context.kingdom = {
      name: kingdom?.name || game.i18n.localize("UKM.Manager.Unnamed"),
      img: kingdom?.img || game.actors.party?.img || "icons/svg/castle.svg",
      capital: kingdom?.capital || "",
      ruler: rulerName(realm),
      famePips: Array.from({ length: fame.max ?? 3 }, (_, i) => i < (fame.value ?? 0)),
      level,
      size: kingdom?.size ?? 0,
      controlDC: getControlDC(),
      unrest: getUnrest(),
      fame,
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
    const royal = canUseRoyal(game.user, realm);
    context.crown = {
      ruler: rulerName(realm),
      canUse: royal && !!rulerName(realm),
      powers: ROYAL_POWERS.map((power) => ({
        power,
        name: game.i18n.localize(`UKM.Royal.${power === "decree" ? "Decree" : power === "court" ? "Court" : "Charge"}Name`),
        hint: game.i18n.localize(`UKM.Royal.${power === "decree" ? "Decree" : power === "court" ? "Court" : "Charge"}Hint`),
        left: usesLeft(power, realm),
        button: power === "court" && royal && !!rulerName(realm) && usesLeft(power, realm) > 0
      })),
      favours: favours(realm).map((f) => ({ ...f, preview: favourPreview(f) }))
    };
    context.hasCapital = hasCapital(realm);
    context.canFoundCapital = !context.hasCapital && canFoundCapital(game.user);
    context.settlements = this.#prepareSettlements(realm, level);
    context.canBuild = context.hasCapital && canActForSeat(game.user, "viceroy");
    context.desks = this.#prepareDesks(realm, kingdom);
    context.council = this.#prepareCouncil(realm);
    context.ambitions = ambitionsView(realm);
    context.ambitionsDone = context.ambitions.filter((a) => a.complete).length;
    const nowTime = game.time.worldTime;
    context.fortunes = (realm.fortunes ?? [])
      .filter((f) => f.uses > 0 && f.expires > nowTime)
      .sort((a, b) => a.expires - b.expires)
      .map((f) => ({
        text: game.i18n.format("UKM.Fortune.Line", {
          uses: f.uses,
          skills: f.skills?.length ? f.skills.map((s) => game.i18n.localize(`UKM.Skill.${s}`)).join(", ") : game.i18n.localize("UKM.Fortune.AnySkill"),
          date: formatDate(f.expires)
        }),
        from: f.label ? game.i18n.format("UKM.Fortune.From", { name: f.label }) : ""
      }));
    context.foldOpen = { ambitions: readFold("ambitions") };
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

  _onRender(context, options) {
    super._onRender?.(context, options);
    for (const fold of this.element.querySelectorAll("details[data-fold]")) {
      fold.addEventListener("toggle", () => writeFold(fold.dataset.fold, fold.open));
    }
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
      const placedId = rawSeatCompanionId(seat);
      const sulking = placedId && placedId !== "hired" && !companionId ? getCompanion(placedId) : null;
      const hired = isHired(seat);
      const supervisor = assignment.supervisor ? fromUuidSync(assignment.supervisor) : null;
      const mine =
        (leader?.isOwner && !game.user.isGM) || (supervisor?.isOwner && !game.user.isGM) || false;
      const canAct = canActForSeat(game.user, seat);
      const holderName = leader?.name ?? companion?.name ?? (hired ? game.i18n.localize("UKM.Hired.Name") : null);
      const advisorBusy = busyWith(realm, `seat:${seat}`);
      const lentTo = realm.cards.find((c) => c.status === "assigned" && c.assignee?.lockSeats?.includes(seat));

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
            rerolls: card.status === "rolled" && card.pendingRoll && !card.pendingRoll.fortuneUsed && canCallBack(game.user, card) ? fortuneUses(realm, card.pendingRoll.skill) : 0,
            fameReroll: card.status === "rolled" && card.pendingRoll && !card.pendingRoll.fortuneUsed && canCallBack(game.user, card) && getFame().value > 0,
            canDecree: card.status === "rolled" && !!card.pendingRoll && !card.pendingRoll.decreeUsed && canUseRoyal(game.user, realm) && !!rulerName(realm) && usesLeft("decree", realm) > 0,
            canCharge: card.kind === "project" && card.status === "assigned" && !!card.workUntil && canUseRoyal(game.user, realm) && !!rulerName(realm) && usesLeft("charge", realm) > 0,
            rerollTag: ["open", "assigned"].includes(card.status) ? Math.max(0, ...stage.skills.map((sk) => fortuneUses(realm, sk))) : 0,
            workDays: card.workUntil ? Math.max(0, daysUntil(card.workUntil, now)) : null,
            assigneeName: card.assignee?.name ?? null,
            assigneePersonal: card.assignee?.type === "pc",
            canDelegate: open && canAct && !!holderName && !advisorBusy && card.kind !== "audience",
            advisorBusy: open && !!advisorBusy && !lentTo,
            canHandle: open && canAct && !lentTo && !event?.advisorOnly && card.kind !== "audience",
            helping: !!card.assignee?.helping,
            isAudience: card.kind === "audience",
            isProject: card.kind === "project",
            canReveal: game.user.isGM && !!card.target?.hexKey && card.kind !== "project",
            canHear: open && canAct && card.kind === "audience",
            canUnassign: card.status === "assigned" && canCallBack(game.user, card),
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

      const companionActor = companion ? game.actors.find((a) => a.name.toLowerCase().startsWith(companion.name.toLowerCase())) : null;
      return {
        seat,
        label: game.i18n.localize(`UKM.Seat.${seat}`),
        stat: game.i18n.localize(`UKM.Stat.${Object.keys(REALM_STATS).find((k) => REALM_STATS[k].seat === seat)}`),
        img: leader?.img ?? companionActor?.img ?? (holderName ? "icons/svg/mystery-man.svg" : null),
        holder: holderName,
        isCompanion: !leader && (!!companion || hired),
        sulking: sulking ? game.i18n.format("UKM.Attitude.WontAdvise", { name: sulking.name, attitude: game.i18n.localize(`UKM.Attitude.${companionAttitude(sulking.id)}`) }) : null,
        advisor: leader && companion && !leader.name.toLowerCase().startsWith(companion.name.toLowerCase()) ? companion.name : null,
        supervisor: supervisor && supervisor.uuid !== leader?.uuid ? supervisor.name : null,
        mine,
        openToAll: seatOpenToAll(seat),
        tiedUp: lentTo ? game.i18n.format("UKM.Card.DeskBusy", { card: lentTo.name }) : null,
        canStartProject: canAct && hasCapital(realm) && projectsForSeat(seat).length > 0,
        canTap: seat === "treasurer" && canAct && tapMode() !== "disabled",
        cards,
        empty: !cards.length
      };
    });
  }

  #prepareSettlements(realm, level) {
    const label = (type) => game.i18n.localize(`UKM.Settlement.Type.${type}`);
    const skill = (s) => game.i18n.localize(`UKM.Skill.${s}`);
    const all = settlements(realm);
    const hexes = new Map(getHexDefinitions().map((h) => [h.key, h]));
    return all
      .slice()
      .sort((a, b) => Number(b.capital) - Number(a.capital) || a.name.localeCompare(b.name))
      .map((s) => {
        const state = settlementState(s, realm);
        const discount = projectDiscount(s, realm);
        const hexKey = settlementHex(s);
        const tracks = getTracks().map((track) => {
          const current = hasPinnacle(s, track.id) ? PINNACLE : trackStage(s, track.id);
          const now = current >= 0 ? stageDef(track.id, current) : null;
          const underway = trackUnderway(s.id, track.id, realm);
          const step = nextStep(s, track.id, { kingdomLevel: level, others: all, working: underway });
          const bp = step.bp ? Math.max(1, Math.round(step.bp * (1 - discount / 100))) : null;
          const blocked = step.blocked && step.blocked !== "Working" ? game.i18n.format(`UKM.Track.Block.${step.blocked}`, { level: step.level ?? "" }) : null;
          return {
            id: track.id,
            name: track.name,
            basic: !!track.basic,
            seatLabel: game.i18n.localize(`UKM.Seat.${track.seat}`),
            stageLabel: current === PINNACLE ? game.i18n.localize("UKM.Track.Pinnacle") : current === 0 ? game.i18n.localize("UKM.Track.Starter") : current > 0 ? `+${current}` : "",
            pinnacle: current === PINNACLE,
            now,
            next: step.def && step.blocked !== "Done" ? step.def : null,
            nextIsPinnacle: step.stage === PINNACLE,
            cost: bp ? game.i18n.format(discount ? "UKM.Track.CostDiscount" : "UKM.Track.Cost", { bp, days: step.days, pct: discount }) : null,
            canBuild: !step.blocked && hasCapital(realm) && canActForSeat(game.user, track.seat),
            buildLabel: game.i18n.localize(current < 0 || step.stage === PINNACLE ? "UKM.Track.Build" : "UKM.Track.Upgrade"),
            underway,
            blocked,
            canUp: current < (track.pinnacle ? PINNACLE : 3),
            canDown: current > -1,
            stage: current
          };
        });
        const missing = missingNeeds(s).map(({ trackId, min }) => {
          const def = stageDef(trackId, min);
          return game.i18n.format("UKM.Track.MissingItem", { track: getTracks().find((t) => t.id === trackId)?.name ?? trackId, stage: def?.name ?? "" });
        });
        return {
          id: s.id,
          name: s.name,
          capital: s.capital,
          waterside: s.waterside,
          typeLabel: label(sizeFor(s)),
          consumption: state.consumption,
          onMap: !!hexKey,
          hexKey,
          panorama: renderPanorama(s, { terrain: hexes.get(hexKey)?.terrain ?? null }),
          bonuses: Object.entries(trackBonuses(s)).map(([k, v]) => `${skill(k)} +${v}`),
          missing: missing.length ? game.i18n.format("UKM.Track.Missing", { size: label(sizeFor(s)), list: missing.join(", ") }) : null,
          foldKey: `settlement-${s.id}`,
          foldOpen: readFold(`settlement-${s.id}`),
          tracksSummary: game.i18n.format("UKM.Track.Summary", { built: tracks.filter((t) => t.now).length, total: tracks.length, ready: tracks.filter((t) => t.canBuild).length }),
          tracks
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
    const hexKey = target.dataset.hex
      ? target.dataset.hex
      : taskId
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
      .map(({ group, options }) => `<optgroup label="${Handlebars.escapeExpression(group)}">${options.map((o) => `<option value="${o.value}">${Handlebars.escapeExpression(o.label)}</option>`).join("")}</optgroup>`)
      .join("");
    const dc = game.i18n.localize("UKM.Card.PersonalHint");
    const choice = await UkmDialog.prompt({
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
        : await UkmDialog.wait({
            window: { title: game.i18n.localize("UKM.Project.StartTitle") },
            content: `<ul class="ukm-scene-options">${defs.map((d) => `<li><strong>${esc(d.name)}</strong> ${esc(d.hook)}</li>`).join("")}</ul>`,
            buttons: defs.map((d) => ({ action: d.id, label: d.name })),
            rejectClose: false
          });
    const def = type ? getProject(type) : null;
    if (def) await KingdomManager.#projectDialog(def);
  }

  static async #projectDialog(def) {
    const esc = Handlebars.escapeExpression;
    const targets = projectTargets(def);
    if (!targets.length) {
      ui.notifications.warn(game.i18n.localize(`UKM.Project.NoTargets.${def.target}`));
      return;
    }
    const picked = targets[0];
    const probe = { eventId: `project:${def.id}`, seat: def.seat, dcAdjust: 0 };
    const odds = estimateCheck(probe, { type: "advisor", skill: def.skill[0] });
    const quoteText = (q) => game.i18n.format("UKM.Project.Quote", { cost: q.cost, days: q.days });
    let body = "";
    {
      body = `<p>${quoteText(projectQuote(def, picked))}</p>`;
      if (def.id === "found-settlement") {
        body += `<div class="form-group"><label>${game.i18n.localize("UKM.Project.SettlementName")}</label><input type="text" name="settlementName" maxlength="60" required placeholder="${esc(game.i18n.localize("UKM.Settlement.NamePlaceholder"))}"></div>
          <div class="form-group"><label>${game.i18n.localize("UKM.Settlement.Waterside")}</label><input type="checkbox" name="waterside"></div>
          <p class="hint">${game.i18n.localize("UKM.Settlement.WatersideHint")}</p>`;
      }
      if (isHexProject(def)) {
        body += `<div class="form-group"><label>${game.i18n.localize("UKM.Project.WhereNote")}</label><input type="text" name="where" maxlength="80" placeholder="${esc(game.i18n.localize("UKM.Project.WherePlaceholder"))}"></div>
          <p class="hint">${game.i18n.localize("UKM.Project.WhereHint")}</p>`;
      }
    }
    if (def.id === "establish-work-site") {
      body += `<div class="form-group"><label>${game.i18n.localize("UKM.Project.CampLabel")}</label><select name="camp">${["lumber", "quarry", "mine"]
        .map((c) => `<option value="${c}">${game.i18n.localize(`UKM.Project.Camp.${c}`)}</option>`)
        .join("")}</select><p class="hint">${game.i18n.localize("UKM.Project.CampHint")}</p></div>`;
    }
    const content = `<p>${esc(def.hook)}</p>${odds ? `<p class="hint">${game.i18n.localize("UKM.Difficulty.Advisor")} ${odds.label}</p>` : ""}
      ${body}<p class="hint">${game.i18n.format("UKM.Project.Treasury", { bp: getRealm().treasury })}</p>`;
    const read = (mode) => (event, button) => {
      const f = button.form.elements;
      return {
        mode,
        structure: button.form.querySelector("input[name=structure]:checked")?.value ?? f.structure?.value ?? null,
        camp: f.camp?.value ?? null,
        where: f.where?.value ?? "",
        settlementName: f.settlementName?.value ?? "",
        waterside: !!f.waterside?.checked
      };
    };
    const buttons = [{ action: "start", label: game.i18n.localize("UKM.Project.Start"), icon: "fa-solid fa-hammer", default: true, callback: read("start") }];
    if (getSetting(SETTINGS.council)) buttons.push({ action: "propose", label: game.i18n.localize("UKM.Council.Propose"), icon: "fa-solid fa-landmark-dome", callback: read("propose") });
    const choice = await UkmDialog.wait({ window: { title: def.name }, position: { width: 560 }, content, buttons, rejectClose: false });
    if (!choice?.mode) return;
    if (def.id === "found-settlement" && !choice.settlementName.trim()) {
      ui.notifications.warn(game.i18n.localize("UKM.Request.Reason.NoName"));
      return;
    }
    const request = {
      type: def.id,
      hexKey: picked.hexKey,
      settlementId: picked.settlementId ?? null,
      structure: choice.structure,
      camp: choice.camp,
      where: choice.where,
      settlementName: choice.settlementName,
      waterside: choice.waterside
    };
    await sendRequest(choice.mode === "propose" ? "proposeProject" : "startProject", request);
  }

  /** The GM picks or names the capital. Used by the Settlements tab and by Setup. */
  static async foundCapitalDialog() {
    const esc = Handlebars.escapeExpression;
    const onMap = unknownMapSettlements();
    const mapChoices = onMap.length
      ? `<p>${game.i18n.localize("UKM.Settlement.UseMap")}</p>${onMap
          .map((h, i) => `<label class="ukm-radio"><input type="radio" name="choice" value="${h.key}" ${i === 0 ? "checked" : ""}> ${esc(h.name)} (${game.i18n.localize(`UKM.Settlement.Type.${h.type}`)})</label>`)
          .join("")}<label class="ukm-radio"><input type="radio" name="choice" value=""> ${game.i18n.localize("UKM.Settlement.NewVillage")}</label><hr>`
      : `<input type="hidden" name="choice" value="">`;
    const content = `<p>${game.i18n.localize("UKM.Settlement.FirstStep")}</p>${mapChoices}
      <div class="form-group"><label>${game.i18n.localize("UKM.Settlement.Name")}</label><input type="text" name="name" maxlength="60" placeholder="${esc(game.i18n.localize("UKM.Settlement.NamePlaceholder"))}"></div>
      <div class="form-group"><label>${game.i18n.localize("UKM.Settlement.Waterside")}</label><input type="checkbox" name="waterside"></div>
      <p class="hint">${game.i18n.localize("UKM.Settlement.WatersideHint")}</p>
      <div class="form-group"><label>${game.i18n.localize("UKM.Project.WhereNote")}</label><input type="text" name="where" maxlength="80" placeholder="${esc(game.i18n.localize("UKM.Project.WherePlaceholder"))}"></div>
      <p class="hint">${game.i18n.localize("UKM.Project.WhereHint")}</p>`;
    const choice = await UkmDialog.prompt({
      window: { title: game.i18n.localize("UKM.Settlement.FoundCapital") },
      position: { width: 480 },
      content,
      ok: {
        label: game.i18n.localize("UKM.Settlement.FoundCapital"),
        icon: "fa-solid fa-flag",
        callback: (event, button) => {
          const f = button.form.elements;
          const mapHex = button.form.querySelector("input[name=choice]:checked")?.value ?? f.choice?.value ?? "";
          return { mapHex: mapHex || null, name: f.name.value, waterside: f.waterside.checked, where: f.where.value };
        }
      },
      rejectClose: false
    });
    if (!choice) return;
    if (!choice.mapHex && !choice.name.trim()) {
      ui.notifications.warn(game.i18n.localize("UKM.Request.Reason.NoName"));
      return;
    }
    await sendRequest("foundCapital", choice);
  }

  static async #developTrack(event, target) {
    const settlementId = target.closest("[data-settlement]")?.dataset.settlement;
    const trackId = target.closest("[data-track]")?.dataset.track;
    if (!settlementId || !trackId) return;
    const request = { type: "develop-settlement", settlementId, track: trackId };
    if (getSetting(SETTINGS.council)) {
      const mode = await UkmDialog.wait({
        window: { title: game.i18n.localize("UKM.Track.Build") },
        content: `<p>${game.i18n.localize("UKM.Council.ProposeOrStart")}</p>`,
        buttons: [
          { action: "start", label: game.i18n.localize("UKM.Project.Start"), icon: "fa-solid fa-hammer", default: true },
          { action: "propose", label: game.i18n.localize("UKM.Council.Propose"), icon: "fa-solid fa-landmark-dome" }
        ],
        rejectClose: false
      });
      if (!mode) return;
      await sendRequest(mode === "propose" ? "proposeProject" : "startProject", request);
      return;
    }
    await sendRequest("startProject", request);
  }

  static async #gmTrackStage(event, target) {
    const settlementId = target.closest("[data-settlement]")?.dataset.settlement;
    const row = target.closest("[data-track]");
    if (!settlementId || !row || !game.user.isGM) return;
    const stage = Number(row.dataset.stage) + Number(target.dataset.step);
    await sendRequest("gm", { op: "trackStage", settlementId, trackId: row.dataset.track, stage });
  }

  static async #makeCapital(event, target) {
    const settlementId = target.closest("[data-settlement]")?.dataset.settlement;
    if (settlementId) await sendRequest("gm", { op: "settlement", settlementId, capital: true });
  }

  static async #toggleWaterside(event, target) {
    const settlementId = target.closest("[data-settlement]")?.dataset.settlement;
    const settlement = settlements().find((s) => s.id === settlementId);
    if (settlement) await sendRequest("gm", { op: "settlement", settlementId, waterside: !settlement.waterside });
  }

  static async #deleteSettlement(event, target) {
    const settlementId = target.closest("[data-settlement]")?.dataset.settlement;
    const settlement = settlements().find((s) => s.id === settlementId);
    if (!settlement) return;
    const ok = await UkmDialog.confirm({
      window: { title: settlement.name },
      content: `<p>${game.i18n.format("UKM.Settlement.DeleteConfirm", { name: Handlebars.escapeExpression(settlement.name) })}</p>`,
      rejectClose: false
    });
    if (ok) await sendRequest("gm", { op: "settlement", settlementId, remove: true });
  }


  #prepareCouncil(realm) {
    const isRuler = canUseRoyal(game.user, realm);
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
    const response = await UkmDialog.wait({
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
    const actorUuid = await UkmDialog.prompt({
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
    const choice = await UkmDialog.prompt({
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
    const ok = await UkmDialog.confirm({
      window: { title: game.i18n.format("UKM.Rank.ProjectName", { stat: game.i18n.localize(`UKM.Stat.${stat}`) }) },
      content: `<p>${game.i18n.format("UKM.Rank.BeginConfirm", { cost, days: 14 })}</p>`,
      rejectClose: false
    });
    if (ok) await sendRequest("startRankUp", { stat });
  }

  static #choicesHtml(choices, intro = "") {
    const esc = Handlebars.escapeExpression;
    const always = choices.always.length ? `<p class="hint">${game.i18n.format("UKM.Rank.Always", { effects: choices.always.join(", ") })}</p>` : "";
    return `<div class="ukm-scene">${intro}<p class="ukm-scene-text">${esc(choices.scene)}</p>${always}<ul class="ukm-scene-options">${choices.options
      .map((o) => `<li><strong>${esc(o.label)}</strong> ${esc(o.text)}<br><span class="hint">${o.lines.map(esc).join("; ")}</span>${o.warning ? `<br><span class="ukm-urgent">${esc(o.warning)}</span>` : ""}</li>`)
      .join("")}</ul></div>`;
  }

  static async #previewRankUp(event, target) {
    const stat = target.closest("[data-stat]")?.dataset.stat;
    const current = stat ? getRealm().stats[stat] : null;
    if (!current) return;
    const rank = current.rank + 1;
    const choices = rankUpChoices({ stat, rank });
    if (!choices) return;
    const label = game.i18n.localize(`UKM.Stat.${stat}`);
    const intro = `<p class="hint">${game.i18n.format("UKM.Rank.PreviewHint", { stat: label, rank })}</p>`;
    await UkmDialog.prompt({
      window: { title: game.i18n.format("UKM.Rank.PreviewTitle", { stat: label, rank }) },
      position: { width: 520 },
      content: KingdomManager.#choicesHtml(choices, intro),
      ok: { label: game.i18n.localize("Close") },
      rejectClose: false
    });
  }

  static async #chooseRankUp(event, target) {
    const stat = target.closest("[data-stat]")?.dataset.stat;
    const project = stat ? rankUpProject(getRealm(), stat) : null;
    const choices = project ? rankUpChoices(project) : null;
    if (!choices) return;
    const content = KingdomManager.#choicesHtml(choices);
    const option = await UkmDialog.wait({
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

  static async #reveal(event, target) {
    const card = findCard(target);
    if (card && game.user.isGM) await sendRequest("gm", { op: "reveal", cardId: card.id, revealed: !card.revealed });
  }

  static async #useFame(event, target) {
    const card = findCard(target);
    if (card) await sendRequest("useFame", { cardId: card.id });
  }

  static async #royalDecree(event, target) {
    const card = findCard(target);
    if (card) await sendRequest("royalDecree", { cardId: card.id });
  }

  static async #royalCharge(event, target) {
    const card = findCard(target);
    if (card) await sendRequest("royalCharge", { cardId: card.id });
  }

  static async #royalCourt() {
    await sendRequest("royalCourt", {});
  }

  static async #useFavour(event, target) {
    const favourId = target.closest("[data-favour]")?.dataset.favour;
    if (favourId) await sendRequest("useFavour", { favourId });
  }

  static async #useFortune(event, target) {
    const card = findCard(target);
    if (card) await sendRequest("useFortune", { cardId: card.id });
  }

  static async #accept(event, target) {
    const card = findCard(target);
    if (card) await sendRequest("accept", { cardId: card.id });
  }

  static async #escalate(event, target) {
    const card = findCard(target);
    if (!card) return;
    const ok = await UkmDialog.confirm({
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
    const degree = await UkmDialog.wait({
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
    const ok = await UkmDialog.confirm({
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

  static async #storyEvent() {
    const events = getStoryEvents();
    if (!events.length) return;
    const esc = Handlebars.escapeExpression;
    const eventId = await UkmDialog.wait({
      window: { title: game.i18n.localize("UKM.Manager.StoryEvents") },
      content: `<p class="hint">${game.i18n.localize("UKM.Manager.StoryEventsHint")}</p><ul class="ukm-scene-options">${events
        .map((e) => `<li><strong>${esc(e.name)}</strong> ${esc(e.hook ?? "")}</li>`)
        .join("")}</ul>`,
      buttons: events.map((e) => ({ action: e.id, label: e.name })),
      rejectClose: false
    });
    if (eventId) await sendRequest("gm", { op: "storyEvent", eventId });
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

}

Hooks.on(`${MODULE_ID}.refresh`, () => KingdomManager.refresh());
