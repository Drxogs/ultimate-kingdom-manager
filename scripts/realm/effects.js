import { COMMODITY_BP, RUINS, RUIN_ABILITY } from "../constants.js";
import { getEvent } from "../content/data.js";
import { getKingdom } from "../integrations/party.js";
import { resourceDieValue, weeklyIncome } from "./rules.js";
import { isKingmakerActive, summarizeRealm } from "../integrations/kingmaker.js";
import { getRealm, newId } from "./state.js";
import { secondsPerDay } from "./time.js";
import { completeProject, refundProject } from "./projects.js";
import { syncKingdomSettlements } from "./settlements.js";
import { announceAnarchy, guardWithFame } from "./standing.js";
import { grantFavour } from "./royal.js";
import { UkmDialog } from "../apps/dialog.js";
import { postFlatCheck, queueFlatCheck } from "./flat.js";


const loc = (key, data) => (data ? game.i18n.format(`UKM.Effect.${key}`, data) : game.i18n.localize(`UKM.Effect.${key}`));

/** Roll a number or dice formula such as "1d4", "-1d6" or "1d4+1". */
export async function rollAmount(value) {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return 0;
  const negative = value.trim().startsWith("-");
  const formula = negative ? value.trim().slice(1) : value;
  if (!Roll.validate(formula)) return 0;
  const roll = await new Roll(formula).evaluate();
  return negative ? -roll.total : roll.total;
}

function formatAmount(value) {
  if (typeof value === "number") return value > 0 ? `+${value}` : value < 0 ? `−${Math.abs(value)}` : "0";
  return value.startsWith("-") ? `−${value.slice(1)}` : `+${value}`;
}

/** A short readable line for one effect, used on cards, choice buttons and chat. */
export function describeEffect(effect) {
  const [key, value] = Object.entries(effect)[0] ?? [];
  switch (key) {
    case "unrest":
      return loc("Unrest", { amount: formatAmount(value) });
    case "fame":
      return loc("Fame", { amount: formatAmount(value) });
    case "bpDice":
      return value === "halfOrMinus4" ? loc("IncomeHalved") : loc("BpDice", { amount: formatAmount(value) });
    case "bp":
      return loc("Bp", { amount: formatAmount(value) });
    case "luxuries":
    case "food":
    case "commodities":
      return loc("Commodity", { amount: formatAmount(value), kind: game.i18n.localize(`UKM.Effect.Kind.${key}`) });
    case "consumption":
      return value === "skip" ? loc("ConsumptionSkip") : loc("Consumption", { amount: formatAmount(value) });
    case "ruin":
      return describeRuin(value);
    case "modifier":
      return loc("Modifier", {
        value: formatAmount(value.value),
        days: value.days ?? 30,
        selector: [value.selector].flat().map((s) => (game.i18n.has?.(`UKM.Effect.Selector.${s}`) ? game.i18n.localize(`UKM.Effect.Selector.${s}`) : game.i18n.localize(`UKM.Skill.${s}`))).join(" & ")
      });
    case "favour":
      return loc("Favour", { name: value?.name ?? "" });
    case "reroll":
      return value?.uses > 1 ? loc("RerollMany", { uses: value.uses, days: value.days ?? 30 }) : loc("Reroll");
    case "tradeAgreement":
      return loc("TradeAgreement");
    case "completeProject":
      return loc("ProjectDone");
    case "refund":
      return loc("Refund", { percent: Math.round(value * 100) });
    case "income":
      return loc("Income", { amount: formatAmount(value.perWeek), weeks: value.weeks });
    case "end":
      return loc("End");
    case "flat":
      return loc("FlatPreview", { dc: value.dc });
    case "choose":
      return loc("ChoosePreview", { n: value.n ?? 1, options: (value.from ?? []).map((o) => o.map(describeEffect).join(", ")).join(" / ") });
    case "spawn":
    case "repeat":
      return loc("Spawn", { name: getEvent(key === "repeat" ? null : value)?.name ?? game.i18n.localize("UKM.Effect.ThisEvent") });
    case "spawnOneOf":
      return loc("SpawnOneOf");
    case "revealPin":
      return loc("Revealed");
    case "nextStage":
      return loc("NextStage");
    case "endEvent":
    case "endEventOneOf":
      return loc("EndsOther");
    case "becomeContinuous":
      return loc("BecomesOngoing");
    case "eventDc":
    case "nextLevelMod":
    case "dcAdjust":
      return loc("Harder");
    case "gm":
    case "note":
      return value;
    default:
      return loc("Manual");
  }
}

function describeRuin(value) {
  if (value.all) return loc("RuinAll", { amount: formatAmount(value.all) });
  if (value.choice) {
    const count = value.count ?? 1;
    return loc(count > 1 ? "RuinChoiceMany" : "RuinChoice", { amount: formatAmount(value.choice), count });
  }
  if (value.split) return loc("RuinSplit");
  return Object.entries(value)
    .map(([ruin, amount]) => loc("RuinNamed", { amount: formatAmount(amount), ruin: game.i18n.localize(`UKM.Ruin.${ruin}`) }))
    .join(", ");
}

/**
 * Collects everything an outcome does, so the realm and the PF2e kingdom are
 * each written once at the end.
 */
export class EffectContext {
  constructor({ realm, card, event }) {
    this.realm = realm;
    this.card = card;
    this.event = event;
    this.unrest = 0;
    this.fame = 0;
    this.ruin = Object.fromEntries(RUINS.map((r) => [r, 0]));
    this.lines = [];
    this.continueCard = false;
    this.gmTasks = [];
    this.ended = false;
  }

  note(line) {
    if (line) this.lines.push(line);
  }

  gmTask(text) {
    this.gmTasks.push({
      id: newId(),
      text,
      card: this.card?.id ?? null,
      hexKey: this.card?.target?.hexKey ?? null,
      created: game.time.worldTime,
      done: false
    });
  }
}

async function chooseRuin(ctx, amount, { exclude = [], count = 1 } = {}) {
  const options = RUINS.filter((r) => !exclude.includes(r));
  const chosen = [];
  for (let i = 0; i < count; i++) {
    const remaining = options.filter((r) => !chosen.includes(r));
    const pick = await UkmDialog.wait({
      window: { title: ctx.card?.name ?? game.i18n.localize("UKM.Effect.ChooseRuinTitle") },
      content: `<p>${loc(amount > 0 ? "ChooseRuinUp" : "ChooseRuinDown", { amount: Math.abs(amount) })}</p>`,
      buttons: remaining.map((r) => ({ action: r, label: game.i18n.localize(`UKM.Ruin.${r}`) })),
      rejectClose: false
    });
    chosen.push(pick ?? remaining[0]);
  }
  return chosen;
}

async function chooseOption(ctx, n, options) {
  const picked = [];
  for (let i = 0; i < n; i++) {
    const remaining = options.map((o, index) => ({ o, index })).filter(({ index }) => !picked.includes(index));
    if (!remaining.length) break;
    const pick = await UkmDialog.wait({
      window: { title: ctx.card?.name ?? "" },
      content: `<p>${loc(n > 1 ? "ChooseMany" : "ChooseOne", { n, i: i + 1 })}</p>`,
      buttons: remaining.map(({ o, index }) => ({ action: String(index), label: o.map(describeEffect).join("; ") })),
      rejectClose: false
    });
    picked.push(pick === null || pick === undefined ? remaining[0].index : Number(pick));
  }
  return picked.map((i) => options[i]);
}

function spreadIncome(realm, total, weeks = 4) {
  if (!total) return;
  realm.incomeAdjustments.push({ id: newId(), perWeek: total / weeks, weeks });
}

async function applyRuin(ctx, value) {
  if (value.all) {
    for (const ruin of RUINS) ctx.ruin[ruin] += value.all;
    return;
  }
  if (value.choice) {
    const amount = await rollAmount(value.choice);
    const picks = await chooseRuin(ctx, amount, { exclude: value.exclude, count: value.count ?? 1 });
    for (const ruin of picks) ctx.ruin[ruin] += amount;
    return;
  }
  if (value.split) {
    const [first, second] = value.split.of;
    const [small, large] = value.split.amounts;
    const picks = await chooseRuin(ctx, large, { exclude: RUINS.filter((r) => !value.split.of.includes(r)) });
    ctx.ruin[picks[0]] += large;
    ctx.ruin[picks[0] === first ? second : first] += small;
    return;
  }
  for (const [ruin, amount] of Object.entries(value)) {
    if (!RUINS.includes(ruin)) continue;
    if (typeof amount === "string" && !Roll.validate(amount.replace(/^-/, ""))) {
      ctx.gmTask(loc("RuinManual", { ruin: game.i18n.localize(`UKM.Ruin.${ruin}`), detail: amount }));
      continue;
    }
    ctx.ruin[ruin] += await rollAmount(amount);
  }
}

function testCondition(ctx, condition = {}) {
  const built = new Set(ctx.realm.structures ?? []);
  if (condition.structure) return built.has(condition.structure);
  if (condition.noStructure) return !built.has(condition.noStructure);
  return null;
}

async function askGM(ctx, question) {
  return UkmDialog.confirm({
    window: { title: ctx.card?.name ?? "" },
    content: `<p>${question}</p>`,
    rejectClose: false
  });
}

function endCards(realm, eventIds) {
  const now = game.time.worldTime;
  const ended = [];
  for (const card of realm.cards) {
    if (!eventIds.includes(card.eventId) || !["open", "assigned", "rolled"].includes(card.status)) continue;
    card.status = "resolved";
    card.outcome = "ended";
    card.resolvedAt = now;
    ended.push(card.name);
  }
  return ended;
}

function claimedCount() {
  return isKingmakerActive() ? summarizeRealm().size : getKingdom()?.size ?? 0;
}

/** Plain instructions for effects the GM applies by hand. */
function gmText(ctx, key, value, effect) {
  const where = ctx.card?.target?.settlement ?? "";
  const days = value?.days ?? value?.withinDays ?? effect.withinDays ?? 30;
  const k = `UKM.Effect.Gm.${key}`;
  if (!game.i18n.has(k)) return loc("ManualDetail", { key, detail: ctx.card?.name ?? "" });
  const list = (v) => [v].flat().map((s) => String(s).replace(/-/g, " ")).join(" or ");
  return game.i18n.format(k, {
    where,
    days,
    card: ctx.card?.name ?? "",
    structures: list(Array.isArray(value) ? value : value?.oneOf ?? []),
    skill: value?.skill ? game.i18n.localize(`UKM.Skill.${value.skill}`) : "",
    count: value?.count ?? 1,
    cost: value?.costBpDice ?? ""
  });
}

/** Conditions that resolve later: "claim a hex within 30 days, or else". */
export async function checkWatchers(realm) {
  const now = game.time.worldTime;
  const keep = [];
  const ctx = new EffectContext({ realm, card: null, event: null });
  for (const w of realm.watchers ?? []) {
    if (w.type === "claim" && claimedCount() > w.size) {
      ctx.note(loc("ClaimMet", { card: w.card }));
      continue;
    }
    if (w.until <= now) {
      await applyEffects(ctx, w.else);
      continue;
    }
    keep.push(w);
  }
  realm.watchers = keep;
  return ctx;
}

function settlementCount(realm = getRealm()) {
  return Math.max(1, (realm.settlements ?? []).length);
}

/** Apply a list of effects. Anything the module can't do itself becomes a GM task. */
export async function applyEffects(ctx, effects = []) {
  const { realm } = ctx;
  const day = secondsPerDay();
  const now = game.time.worldTime;

  for (const effect of effects) {
    const [key, value] = Object.entries(effect)[0] ?? [];
    switch (key) {
      case "unrest": {
        const amount = await rollAmount(value);
        ctx.unrest += amount;
        ctx.note(loc("Unrest", { amount: formatAmount(amount) }));
        break;
      }
      case "fame": {
        ctx.fame += value;
        ctx.note(loc("Fame", { amount: formatAmount(value) }));
        break;
      }
      case "ruin": {
        await applyRuin(ctx, value);
        ctx.note(describeRuin(value));
        break;
      }
      case "bpDice": {
        if (value === "halfOrMinus4") {
          const monthly = weeklyIncome(realm).total * 4;
          const loss = Math.max(4 * resourceDieValue(), monthly / 2);
          spreadIncome(realm, -loss);
          ctx.note(loc("IncomeHalved"));
        } else {
          const dice = await rollAmount(value);
          spreadIncome(realm, dice * resourceDieValue());
          ctx.note(loc("BpDice", { amount: formatAmount(dice) }));
        }
        break;
      }
      case "bp": {
        const amount = await rollAmount(value);
        realm.treasury = Math.max(0, realm.treasury + amount);
        ctx.note(loc("Bp", { amount: formatAmount(amount) }));
        break;
      }
      case "luxuries":
      case "food":
      case "commodities": {
        const count = await rollAmount(value);
        const bp = count * (COMMODITY_BP[key === "commodities" ? "lumber" : key] ?? 2);
        realm.treasury += bp;
        ctx.note(loc("CommodityBp", { count, kind: game.i18n.localize(`UKM.Effect.Kind.${key}`), bp }));
        break;
      }
      case "consumption": {
        const weeks = Math.ceil((effect.days ?? 30) / 7);
        const until = effect.monthlyUntilEnd ? ctx.card?.id ?? null : null;
        if (value === "skip") realm.consumptionAdjustments.push({ id: newId(), skip: true, amount: 0, weeks });
        else {
          const amount = value === "perSettlement" ? settlementCount(realm) : await rollAmount(value);
          realm.consumptionAdjustments.push({ id: newId(), amount, weeks: until ? 9999 : weeks, until });
        }
        ctx.note(describeEffect(effect));
        break;
      }
      case "modifier": {
        realm.timedModifiers.push({
          id: newId(),
          type: value.type,
          value: value.value,
          selector: value.selector,
          label: ctx.card?.name ?? "",
          expires: now + (value.days ?? 30) * day
        });
        ctx.note(describeEffect(effect));
        break;
      }
      case "favour": {
        // A one-use favour the ruler keeps until they spend it (Realm tab, The Crown).
        grantFavour(realm, value ?? {}, ctx.card?.name ?? "");
        ctx.note(describeEffect(effect));
        break;
      }
      case "reroll": {
        realm.fortunes.push({
          id: newId(),
          skills: value.skills ?? [],
          projects: value.projects ?? [],
          uses: value.uses ?? 1,
          label: ctx.card?.name ?? "",
          expires: now + (value.days ?? 30) * day
        });
        ctx.note(describeEffect(effect));
        break;
      }
      case "flat": {
        // Rolled at the table: chat gets a button any player can press (see flat.js).
        const flat = queueFlatCheck(realm, {
          dc: value.dc ?? 11,
          success: value.success ?? [],
          failure: value.failure ?? [],
          title: ctx.card?.name ?? "",
          why: loc("FlatWhy", { dc: value.dc ?? 11 }),
          cardId: ctx.card?.id ?? null,
          hexKey: ctx.card?.target?.hexKey ?? null
        });
        ctx.flatChecks ??= [];
        ctx.flatChecks.push(flat);
        ctx.note(loc("FlatPending", { dc: value.dc ?? 11 }));
        break;
      }
      case "choose": {
        const picks = await chooseOption(ctx, value.n ?? 1, value.from ?? []);
        for (const pick of picks) await applyEffects(ctx, pick);
        break;
      }
      case "spawnOneOf": {
        const eventId = value[Math.floor(Math.random() * value.length)];
        realm.scheduled ??= [];
        realm.scheduled.push({ id: newId(), eventId, at: now + (effect.days ?? 0) * day });
        ctx.note(loc("Spawn", { name: getEvent(eventId)?.name ?? eventId }));
        break;
      }
      case "endEventOneOf": {
        const active = realm.cards.filter((c) => value.includes(c.eventId) && ["open", "assigned", "rolled"].includes(c.status));
        if (!active.length) break;
        const pick = await UkmDialog.wait({
          window: { title: ctx.card?.name ?? "" },
          content: `<p>${loc("ChooseEnd")}</p>`,
          buttons: active.map((c) => ({ action: c.id, label: c.name })),
          rejectClose: false
        });
        const target = active.find((c) => c.id === pick) ?? active[0];
        ctx.note(loc("Ended", { name: endCards(realm, [target.eventId]).join(", ") }));
        break;
      }
      case "endEvent": {
        const names = endCards(realm, [value]);
        if (names.length) ctx.note(loc("Ended", { name: names.join(", ") }));
        break;
      }
      case "if": {
        const result = testCondition(ctx, value);
        if (result === null) ctx.gmTask(loc("ManualDetail", { key, detail: JSON.stringify(effect) }));
        else await applyEffects(ctx, result ? effect.then ?? [] : effect.else ?? []);
        break;
      }
      case "ifRepeat": {
        if (ctx.card?.lastOutcome === value) await applyEffects(ctx, effect.then ?? []);
        break;
      }
      case "ifFirstMonth": {
        if ((ctx.card?.months ?? 1) <= 1) await applyEffects(ctx, value);
        break;
      }
      case "ifRevealed": {
        if (ctx.card?.revealed) await applyEffects(ctx, value);
        break;
      }
      case "ifSettlementBreached": {
        const breached = await askGM(ctx, loc("AskBreached", { place: ctx.card?.target?.settlement ?? "" }));
        await applyEffects(ctx, breached ? value : effect.else ?? []);
        break;
      }
      case "hidePin": {
        ctx.card.revealed = false;
        if (effect.moveHex) ctx.card.moveHex = true;
        break;
      }
      case "becomeContinuous": {
        ctx.continueCard = value?.everyDays ?? 1;
        break;
      }
      case "spawn": {
        const at = effect.now ? now : now + (effect.days ?? effect.inDays ?? 0) * day;
        realm.scheduled ??= [];
        realm.scheduled.push({ id: newId(), eventId: value, at, placement: effect.placement ?? null });
        ctx.note(loc("Spawn", { name: getEvent(value)?.name ?? value }));
        break;
      }
      case "repeat": {
        realm.scheduled ??= [];
        realm.scheduled.push({ id: newId(), eventId: ctx.card.eventId, at: now + 30 * day });
        ctx.note(loc("Repeat"));
        break;
      }
      case "end": {
        ctx.ended = true;
        break;
      }
      case "nextStage": {
        ctx.card.stage = (ctx.card.stage ?? 0) + 1;
        if (effect.dcAdjust) ctx.card.dcAdjust = (ctx.card.dcAdjust ?? 0) + effect.dcAdjust;
        break;
      }
      case "revealPin": {
        ctx.card.revealed = true;
        ctx.note(loc("Revealed"));
        break;
      }
      case "eventDc": {
        ctx.card.dcAdjust = value === "reset" ? 0 : (ctx.card.dcAdjust ?? 0) + value;
        break;
      }
      case "nextLevelMod": {
        realm.levelModBoosts ??= {};
        realm.levelModBoosts[ctx.card.eventId] = (realm.levelModBoosts[ctx.card.eventId] ?? 0) + value;
        break;
      }
      case "completeProject": {
        completeProject(ctx);
        break;
      }
      case "refund": {
        refundProject(ctx, value);
        break;
      }
      case "income": {
        realm.incomeAdjustments.push({ id: newId(), perWeek: value.perWeek, weeks: value.weeks });
        ctx.note(describeEffect(effect));
        break;
      }
      case "tradeAgreement": {
        realm.tradeAgreements.push({ id: newId(), name: ctx.card?.name ?? "", weekly: Math.max(1, Math.round(resourceDieValue() / 2)) });
        ctx.note(loc("TradeAgreement"));
        break;
      }
      case "note": {
        ctx.note(value);
        break;
      }
      case "gm": {
        ctx.gmTask(value);
        break;
      }
      case "requireClaim": {
        realm.watchers ??= [];
        realm.watchers.push({
          id: newId(),
          type: "claim",
          card: ctx.card?.name ?? "",
          size: claimedCount(),
          until: now + (value.days ?? 30) * day,
          else: value.else ?? []
        });
        ctx.note(loc("RequireClaim", { days: value.days ?? 30 }));
        break;
      }
      default: {
        ctx.gmTask(gmText(ctx, key, value, effect));
      }
    }
  }
}

/** Write Unrest, Ruin and Fame changes to the PF2e kingdom. Ruin rolls over into its penalty at the threshold. */
export async function commitKingdomChanges(ctx) {
  const kingdom = getKingdom();
  if (!kingdom) return;
  const update = {};

  if (ctx.unrest) update["unrest.value"] = Math.max(0, (kingdom.unrest?.value ?? 0) + ctx.unrest);

  for (const ruin of RUINS) {
    const delta = ctx.ruin[ruin];
    if (!delta) continue;
    const ability = RUIN_ABILITY[ruin];
    const data = kingdom.abilities?.[ability] ?? {};
    const max = data.ruin?.max ?? 10;
    let value = (data.ruin?.value ?? 0) + delta;
    let penalty = data.penalty ?? 0;
    while (value >= max) {
      value -= max;
      penalty -= 1;
    }
    value = Math.max(0, value);
    update[`abilities.${ability}.ruin.value`] = value;
    if (penalty !== (data.penalty ?? 0)) update[`abilities.${ability}.penalty`] = penalty;
  }

  if (ctx.fame) {
    const fame = kingdom.resources?.fame ?? { value: 0, max: 3 };
    update["resources.fame.value"] = Math.clamp(fame.value + ctx.fame, 0, fame.max);
  }

  if (Object.keys(update).length) await kingdom.update(await guardWithFame(update));
  if ("unrest.value" in update) await announceAnarchy();
  if (ctx.syncSettlements) await syncKingdomSettlements();
  if (!ctx.deferFlats) await postFlatChecks(ctx);
}

/** Post the chat buttons for flat checks an outcome called for. */
export async function postFlatChecks(ctx) {
  for (const flat of ctx.flatChecks ?? []) await postFlatCheck(flat);
  ctx.flatChecks = [];
}
