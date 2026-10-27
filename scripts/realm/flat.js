import { MODULE_ID } from "../constants.js";
import { getKingdom } from "../integrations/party.js";
import { applyEffects, commitKingdomChanges, EffectContext } from "./effects.js";
import { getRealm, newId, updateRealm } from "./state.js";

/*
 * Flat checks are rolled at the table, not behind the scenes. When an outcome or the monthly Unrest
 * check calls for one, the realm keeps it waiting and chat shows a button any player can press.
 * The roll is posted to chat, then the GM's window applies whatever the result calls for.
 */

const loc = (key, data) => (data ? game.i18n.format(`UKM.Flat.${key}`, data) : game.i18n.localize(`UKM.Flat.${key}`));
const esc = (s) => Handlebars.escapeExpression(s ?? "");

function speaker() {
  return { alias: getKingdom()?.name || game.i18n.localize("UKM.Manager.Unnamed") };
}

/** A flat check waiting to be rolled. Call inside updateRealm; post it with postFlatCheck afterwards. */
export function queueFlatCheck(realm, { dc = 11, success = [], failure = [], title = "", why = "", cardId = null, hexKey = null }) {
  const flat = { id: newId(), dc, success, failure, title, why, cardId, hexKey, created: game.time.worldTime };
  realm.pendingFlats ??= [];
  realm.pendingFlats.push(flat);
  return flat;
}

/** The chat card with the roll button. */
export async function postFlatCheck(flat) {
  const content = `<div class="ukm-chat ukm-flat">
    <h3>${esc(flat.title || loc("Title"))}</h3>
    ${flat.why ? `<p>${esc(flat.why)}</p>` : ""}
    <p class="ukm-flat-slot"><button type="button" data-ukm-flat="${flat.id}" data-dc="${flat.dc}"><i class="fa-solid fa-dice-d20"></i> ${esc(loc("Roll", { dc: flat.dc }))}</button></p>
  </div>`;
  await ChatMessage.create({ content, speaker: speaker(), flags: { [MODULE_ID]: { flat: flat.id } } });
}

/** Any player presses the button: roll in the open, then hand the total to the GM's window. */
async function rollFromChat(event) {
  const button = event.currentTarget;
  // Like Foundry's own roll requests: the button goes away once someone presses it.
  const slot = button.closest(".ukm-flat-slot");
  button.remove();
  const id = button.dataset.ukmFlat;
  const dc = Number(button.dataset.dc) || 11;
  const roll = await new Roll("1d20").evaluate();
  await roll.toMessage({ flavor: loc("Flavor", { dc }), speaker: ChatMessage.getSpeaker() });
  const { sendRequest } = await import("./requests.js");
  const result = await sendRequest("resolveFlat", { id, total: roll.total });
  if (!result?.ok && result?.reason !== "AlreadyRolled") slot?.append(button);
}

export function bindFlatButtons(html) {
  const root = html instanceof HTMLElement ? html : html?.[0];
  root?.querySelectorAll?.("[data-ukm-flat]").forEach((button) => {
    if (!getRealm().pendingFlats?.some((f) => f.id === button.dataset.ukmFlat)) {
      button.remove();
      return;
    }
    button.addEventListener("click", rollFromChat);
  });
}

/** Runs on the GM's window: apply the result of a rolled flat check. */
export async function resolveFlat({ id, total }) {
  const waiting = getRealm().pendingFlats?.find((f) => f.id === id);
  if (!waiting) return { ok: false, reason: "AlreadyRolled" };
  const passed = Number(total) >= waiting.dc;
  let ctx = null;
  await updateRealm(async (realm) => {
    const flat = realm.pendingFlats?.find((f) => f.id === id);
    if (!flat) return;
    realm.pendingFlats = realm.pendingFlats.filter((f) => f.id !== id);
    const card = flat.cardId ? realm.cards.find((c) => c.id === flat.cardId) ?? null : null;
    ctx = new EffectContext({ realm, card, event: null });
    await applyEffects(ctx, passed ? flat.success : flat.failure);
    for (const task of ctx.gmTasks) {
      task.hexKey ??= flat.hexKey;
      realm.gmTasks.push(task);
    }
  });
  if (!ctx) return { ok: false, reason: "AlreadyRolled" };
  await commitKingdomChanges(ctx);

  const verdict = loc(passed ? "Passed" : "Failed", { total, dc: waiting.dc });
  const lines = ctx.lines.map((l) => `<li>${l}</li>`).join("");
  const message = game.messages?.find?.((m) => m.getFlag?.(MODULE_ID, "flat") === id);
  if (message) {
    const content = message.content.replace(/<p class="ukm-flat-slot">[\s\S]*?<\/p>/, `<p class="ukm-flat-slot"><strong>${esc(verdict)}</strong></p>${lines ? `<ul>${lines}</ul>` : ""}`);
    await message.update({ content });
  } else {
    await ChatMessage.create({ content: `<div class="ukm-chat"><h3>${esc(waiting.title || loc("Title"))}</h3><p><strong>${esc(verdict)}</strong></p>${lines ? `<ul>${lines}</ul>` : ""}</div>`, speaker: speaker() });
  }
  if (ctx.gmTasks.length) {
    await ChatMessage.create({
      content: `<div class="ukm-chat"><h3>${esc(game.i18n.localize("UKM.Manager.GmTasks"))}</h3><ul>${ctx.gmTasks.map((t) => `<li>${t.text}</li>`).join("")}</ul></div>`,
      whisper: ChatMessage.getWhisperRecipients("GM").map((u) => u.id),
      speaker: { alias: game.i18n.localize("UKM.Manager.Title") }
    });
  }
  return { ok: true, passed };
}
