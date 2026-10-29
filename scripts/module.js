import { MODULE_ID } from "./constants.js";
import { registerSettings, getSetting, setSetting, SETTINGS } from "./settings.js";
import { preloadData } from "./content/data.js";
import { inspectSources } from "./content/story-import.js";
import { onRegionChange } from "./integrations/kingmaker.js";
import { getParty, syncKingdomLevel } from "./integrations/party.js";
import { registerClock, tick } from "./realm/clock.js";
import { getRealm, migrateSixSeats, REALM_FLAG } from "./realm/state.js";
import { registerRequests, sendRequest } from "./realm/requests.js";
import { onRerollMessage } from "./realm/resolve.js";
import { buildStructureCatalog, isFortified, structureCatalog } from "./realm/projects.js";
import { ensureHandbook, openHandbook } from "./content/handbook.js";
import { isLeader, leaderSettled, startLeader } from "./realm/leader.js";
import { adoptMapSettlements, repairSettlements } from "./realm/settlements.js";
import { importPf2eKingdom } from "./realm/pf2e-kingdom.js";
import { cardsOnHex } from "./realm/pins.js";
import { daysUntil } from "./realm/time.js";
import { KingdomManager } from "./apps/kingdom-manager.js";
import { SetupWizard } from "./apps/setup-wizard.js";
import { StoryImportApp } from "./apps/story-import-app.js";
import { bindFlatButtons } from "./realm/flat.js";
import { announceAnarchy, noteUnrest } from "./realm/standing.js";

const TEMPLATES = [
  "setup/setup.hbs",
  "import/import.hbs",
  "manager/overview.hbs",
  "manager/desks.hbs",
  "manager/council.hbs",
  "manager/log.hbs"
].map((t) => `modules/${MODULE_ID}/templates/${t}`);

Hooks.once("init", () => {
  registerSettings();
  foundry.applications.handlebars.loadTemplates(TEMPLATES);

  Handlebars.registerHelper("ukmSigned", (n) => (n > 0 ? `+${n}` : `${n}`));

  game.modules.get(MODULE_ID).api = {
    open: () => KingdomManager.open(),
    setup: () => new SetupWizard().render(true),
    importStory: () => new StoryImportApp().render(true),
    realm: () => getRealm(),
    handbook: (book) => openHandbook(book),
    tick: () => tick()
  };
});

Hooks.once("ready", async () => {
  await preloadData();
  startLeader();
  registerRequests();
  registerClock();
  // A settlement drawn on the map joins the realm as soon as the map is saved (the leader GM does it).
  onRegionChange(async () => {
    await adoptMapSettlements();
    KingdomManager.refresh();
  });

  if (!game.user.isGM) return;

  await leaderSettled();
  if (isLeader()) {
    await syncKingdomLevel();
    await importPf2eKingdom();
    await migrateSixSeats();
    await repairSettlements();
    noteUnrest();
    await tick();
    if (getSetting(SETTINGS.storyImported)) await buildStructureCatalog();
    await ensureHandbook().catch((err) => console.error(`${MODULE_ID} |`, err));
  }

  if (game.modules.get("pf2e-kingmaker-tools")?.active && !getSetting(SETTINGS.toolsNotice)) {
    await ChatMessage.create({
      whisper: [game.user.id],
      speaker: { alias: game.i18n.localize("UKM.Manager.Title") },
      content: `<div class="ukm-chat"><p>${game.i18n.localize("UKM.Setup.ToolsNotice")}</p></div>`
    });
    await setSetting(SETTINGS.toolsNotice, true);
  }

  if (!getSetting(SETTINGS.setupComplete)) {
    new SetupWizard().render(true);
    return;
  }

  const remindAt = getSetting(SETTINGS.importReminder);
  if (!getSetting(SETTINGS.storyImported) && Date.now() > remindAt && inspectSources().kingmaker) {
    new StoryImportApp().render(true);
  }
});

Hooks.on("updateActor", (actor, changes) => {
  const party = getParty();
  if (!party) return;
  if (actor.id === party.id) {
    if (foundry.utils.hasProperty(changes, "system.details.members")) syncKingdomLevel();
    KingdomManager.refresh();
    return;
  }
  const levelChanged = foundry.utils.hasProperty(changes, "system.details.level");
  if (levelChanged && party.members.some((m) => m.id === actor.id)) syncKingdomLevel();
});

Hooks.on("createChatMessage", (message) => onRerollMessage(message));

Hooks.on("userConnected", () => KingdomManager.refresh());

function hexCardList(key) {
  const esc = Handlebars.escapeExpression;
  return cardsOnHex(key)
    .map((c) => {
      const when = c.kind === "project" ? game.i18n.localize("UKM.Pins.HudProject") : game.i18n.format("UKM.Pins.HudDays", { days: Math.max(0, daysUntil(c.deadline)) });
      return `<li>${esc(c.name)} <span class="hint">· ${esc(when)}</span></li>`;
    })
    .join("");
}

/** The Kingmaker hover panel: what's going on in the hex, and whether it's fortified. */
function addHexHudLine(app, html) {
  const root = html instanceof HTMLElement ? html : html?.[0] ?? app?.element;
  const key = app?.hex?.key;
  if (!root || key === undefined) return;
  root.querySelector(".ukm-hex-hud")?.remove();
  const items = hexCardList(key);
  const fortified = isFortified(key);
  if (!items && !fortified) return;
  const section = document.createElement("section");
  section.className = "ukm-hex-hud";
  const fortLine = fortified ? `<p class="ukm-fortified"><i class="fa-solid fa-shield-halved"></i> ${game.i18n.localize("UKM.Pins.Fortified")}</p>` : "";
  section.innerHTML = `<h4>${game.i18n.localize("UKM.Pins.HudTitle")}</h4>${items ? `<ul>${items}</ul>` : ""}${fortLine}`;
  root.append(section);
}

/** The GM's hex editor (double-click a hex with the hex tool on): a Fortified tick box and the hex's cards. */
function addHexEditorSection(app, html) {
  if (!game.user.isGM) return;
  const root = html instanceof HTMLElement ? html : html?.[0] ?? app?.element;
  const key = app?.options?.hex?.key ?? globalThis.kingmaker?.region?.hoveredHex?.key;
  if (!root || key === undefined) return;
  root.querySelector(".ukm-hex-edit")?.remove();
  const esc = Handlebars.escapeExpression;
  const items = hexCardList(key);
  const section = document.createElement("fieldset");
  section.className = "ukm-hex-edit";
  section.innerHTML = `<legend>${game.i18n.localize("UKM.Pins.HudTitle")}</legend>
    <div class="form-group"><label>${game.i18n.localize("UKM.Pins.Fortified")}</label><input type="checkbox" class="ukm-fortify" ${isFortified(key) ? "checked" : ""}><p class="hint">${esc(game.i18n.localize("UKM.Pins.FortifiedHint"))}</p></div>
    ${items ? `<ul>${items}</ul>` : ""}`;
  section.querySelector(".ukm-fortify").addEventListener("change", (event) => {
    event.stopPropagation();
    sendRequest("gm", { op: "fortify", hexKey: String(key), on: event.currentTarget.checked });
  });
  const footer = root.querySelector(".form-footer");
  if (footer) footer.before(section);
  else (root.querySelector(".window-content") ?? root).append(section);
}

// Anarchy starts or ends whenever Unrest changes in the realm.
Hooks.on("updateActor", (actor, changes) => {
  if (actor.type === "party" && foundry.utils.hasProperty(changes, `flags.${MODULE_ID}.${REALM_FLAG}`)) announceAnarchy().catch((err) => console.error(`${MODULE_ID} |`, err));
});

/**
 * The kingdom's numbers live in this module now, so the PF2e Kingdom tab on the party sheet is
 * hidden: typing there would change nothing. The Kingdom Manager button stays in the header.
 */
function hidePartyKingdomTab(app, html) {
  const root = html instanceof HTMLElement ? html : html?.[0] ?? app?.element;
  if (!root) return;
  const tabs = root.querySelectorAll('[data-tab="kingdom"]');
  if (!tabs.length) return;
  const wasActive = [...tabs].some((el) => el.classList.contains("active"));
  tabs.forEach((el) => el.remove());
  if (wasActive) root.querySelector('nav [data-tab]')?.click();
}
Hooks.on("renderPartySheetPF2e", hidePartyKingdomTab);

/**
 * The party's folder in the Actors sidebar has a "Create Kingdom" button (a crown) that opens the
 * PF2e kingdom builder. The kingdom is set up in our Setup now, so that button opens the Kingdom
 * Manager instead.
 */
function swapCreateKingdomButton(app, html) {
  const root = html instanceof HTMLElement ? html : html?.[0] ?? app?.element;
  if (!root) return;
  const buttons = root.querySelectorAll('[data-tooltip="Create Kingdom"], [data-tooltip="PF2E.Kingmaker.Kingdom.CreateKingdom"], [data-action="createKingdom"], [data-action="openKingdomBuilder"]');
  for (const old of buttons) {
    if (old.dataset.ukmSwapped) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.className = old.className;
    button.dataset.ukmSwapped = "1";
    button.dataset.tooltip = game.i18n.localize("UKM.Manager.Open");
    button.setAttribute("aria-label", game.i18n.localize("UKM.Manager.Open"));
    button.innerHTML = '<i class="fa-solid fa-chess-rook" inert></i>';
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      KingdomManager.open();
    });
    old.replaceWith(button);
  }
}
Hooks.on("renderActorDirectory", (app, html) => {
  swapCreateKingdomButton(app, html);
  // Some modules add their sidebar buttons after us; check again once they've run.
  setTimeout(() => swapCreateKingdomButton(app, html), 0);
});
Hooks.on("renderActorSheet", (app, html) => {
  if (app.actor?.type === "party") hidePartyKingdomTab(app, html);
});

// Flat-check buttons in chat: any player can roll them.
Hooks.on("renderChatMessageHTML", (message, html) => bindFlatButtons(html));

Hooks.on("renderHexHUD", addHexHudLine);
Hooks.on("renderKingmakerHexHUD", addHexHudLine);
Hooks.on("renderHexEditor", addHexEditorSection);

Hooks.on("updateSetting", (setting) => {
  if (setting.key.startsWith(`${MODULE_ID}.`)) Hooks.callAll(`${MODULE_ID}.refresh`);
});

Hooks.on("getSceneControlButtons", (controls) => {
  const tokens = controls.tokens;
  if (!tokens?.tools) return;
  tokens.tools.ukmKingdom = {
    name: "ukmKingdom",
    title: "UKM.Manager.Open",
    icon: "fa-solid fa-chess-rook",
    order: Object.keys(tokens.tools).length,
    button: true,
    visible: true,
    onChange: () => KingdomManager.open()
  };
});

Hooks.on("getActorSheetHeaderButtons", (sheet, buttons) => {
  if (sheet.actor?.type !== "party") return;
  buttons.unshift({
    label: "UKM.Manager.Short",
    class: "ukm-open",
    icon: "fa-solid fa-chess-rook",
    onclick: () => KingdomManager.open()
  });
});
