import { MODULE_ID } from "./constants.js";
import { SetupWizard } from "./apps/setup-wizard.js";

export const SETTINGS = {
  setupComplete: "setupComplete",
  storyImported: "storyImported",
  importReminder: "importReminder",
  betweenSessions: "betweenSessions",
  betweenSessionsApproval: "betweenSessionsApproval",
  courtOverride: "courtOverride",
  tapTreasury: "tapTreasury",
  levelGravity: "levelGravity",
  advisorWarnings: "advisorWarnings",
  costGradient: "costGradient",
  pinResolved: "pinResolved",
  clock: "clock",
  seatAssignments: "seatAssignments",
  deskMatters: "deskMatters"
};

export function registerSettings() {
  const world = (key, data) => game.settings.register(MODULE_ID, key, { scope: "world", ...data });

  game.settings.registerMenu(MODULE_ID, "setupMenu", {
    name: "UKM.Settings.Setup.Name",
    label: "UKM.Settings.Setup.Label",
    hint: "UKM.Settings.Setup.Hint",
    icon: "fa-solid fa-crown",
    type: SetupWizard,
    restricted: true
  });

  world(SETTINGS.betweenSessions, {
    name: "UKM.Settings.BetweenSessions.Name",
    hint: "UKM.Settings.BetweenSessions.Hint",
    config: true,
    type: Boolean,
    default: false,
    onChange: () => Hooks.callAll(`${MODULE_ID}.refresh`)
  });

  world(SETTINGS.betweenSessionsApproval, {
    name: "UKM.Settings.Approval.Name",
    hint: "UKM.Settings.Approval.Hint",
    config: true,
    type: String,
    choices: {
      review: "UKM.Settings.Approval.Review",
      auto: "UKM.Settings.Approval.Auto"
    },
    default: "review"
  });

  world(SETTINGS.deskMatters, {
    name: "UKM.Settings.DeskMatters.Name",
    hint: "UKM.Settings.DeskMatters.Hint",
    config: true,
    type: Boolean,
    default: true
  });

  world(SETTINGS.tapTreasury, {
    name: "UKM.Settings.TapTreasury.Name",
    hint: "UKM.Settings.TapTreasury.Hint",
    config: true,
    type: String,
    choices: {
      approval: "UKM.Settings.TapTreasury.Approval",
      allowed: "UKM.Settings.TapTreasury.Allowed",
      disabled: "UKM.Settings.TapTreasury.Disabled"
    },
    default: "approval"
  });

  world(SETTINGS.advisorWarnings, {
    name: "UKM.Settings.AdvisorWarnings.Name",
    hint: "UKM.Settings.AdvisorWarnings.Hint",
    config: true,
    type: String,
    choices: {
      off: "UKM.Settings.AdvisorWarnings.Off",
      subtle: "UKM.Settings.AdvisorWarnings.Subtle",
      blunt: "UKM.Settings.AdvisorWarnings.Blunt"
    },
    default: "subtle"
  });

  world(SETTINGS.pinResolved, {
    name: "UKM.Settings.PinResolved.Name",
    hint: "UKM.Settings.PinResolved.Hint",
    config: true,
    type: String,
    choices: {
      remove: "UKM.Settings.PinResolved.Remove",
      keep: "UKM.Settings.PinResolved.Keep"
    },
    default: "remove"
  });

  world(SETTINGS.costGradient, {
    config: false,
    type: Object,
    default: { below: -0.25, near: 0, plusTwo: 0.5, plusThree: 1, perHexBeyondBorder: 0.1 }
  });

  world(SETTINGS.levelGravity, { config: false, type: Number, default: 1 });
  world(SETTINGS.courtOverride, { config: false, type: String, default: "auto" });
  world(SETTINGS.setupComplete, { config: false, type: Boolean, default: false });
  world(SETTINGS.storyImported, { config: false, type: Boolean, default: false });
  world(SETTINGS.importReminder, { config: false, type: Number, default: 0 });
  world(SETTINGS.clock, { config: false, type: Object, default: {} });
  world(SETTINGS.seatAssignments, { config: false, type: Object, default: {} });
}

export function getSetting(key) {
  return game.settings.get(MODULE_ID, key);
}

export function setSetting(key, value) {
  return game.settings.set(MODULE_ID, key, value);
}
