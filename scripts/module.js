import { MODULE_ID } from "./constants.js";
import { registerSettings, getSetting, SETTINGS } from "./settings.js";
import { preloadData } from "./content/data.js";
import { inspectSources } from "./content/story-import.js";
import { onRegionChange } from "./integrations/kingmaker.js";
import { getParty, syncKingdomLevel } from "./integrations/party.js";
import { registerClock, tick } from "./realm/clock.js";
import { getRealm } from "./realm/state.js";
import { processQueuedRequests, registerRequests } from "./realm/requests.js";
import { onRerollMessage } from "./realm/resolve.js";
import { buildStructureCatalog, structureCatalog } from "./realm/projects.js";
import { ensureHandbook, openHandbook } from "./content/handbook.js";
import { isLeader, leaderSettled, startLeader } from "./realm/leader.js";
import { cardsOnHex } from "./realm/pins.js";
import { daysUntil } from "./realm/time.js";
import { KingdomManager } from "./apps/kingdom-manager.js";
import { SetupWizard } from "./apps/setup-wizard.js";
import { StoryImportApp } from "./apps/story-import-app.js";

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
  onRegionChange(() => KingdomManager.refresh());

  if (!game.user.isGM) return;

  await leaderSettled();
  if (isLeader()) {
    await syncKingdomLevel();
    await tick();
    await processQueuedRequests();
    if (getSetting(SETTINGS.storyImported)) await buildStructureCatalog();
    await ensureHandbook().catch((err) => console.error(`${MODULE_ID} |`, err));
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

function addHexHudLine(app, html) {
  const root = html instanceof HTMLElement ? html : html?.[0] ?? app?.element;
  const key = app?.hex?.key;
  if (!root || key === undefined) return;
  root.querySelector(".ukm-hex-hud")?.remove();
  const cards = cardsOnHex(key);
  if (!cards.length) return;
  const esc = Handlebars.escapeExpression;
  const items = cards
    .map((c) => {
      const when = c.kind === "project" ? game.i18n.localize("UKM.Pins.HudProject") : game.i18n.format("UKM.Pins.HudDays", { days: Math.max(0, daysUntil(c.deadline)) });
      return `<li>${esc(c.name)} <span class="hint">· ${esc(when)}</span></li>`;
    })
    .join("");
  const section = document.createElement("section");
  section.className = "ukm-hex-hud";
  section.innerHTML = `<h4>${game.i18n.localize("UKM.Pins.HudTitle")}</h4><ul>${items}</ul>`;
  root.append(section);
}

Hooks.on("renderHexHUD", addHexHudLine);
Hooks.on("renderKingmakerHexHUD", addHexHudLine);

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
