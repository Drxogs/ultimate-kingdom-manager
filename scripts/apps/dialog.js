/**
 * The module's dialogs, dressed like the Kingdom Manager (parchment, red serif headings, sheet buttons).
 * Same calls as foundry's DialogV2; this only adds the look.
 */
const { DialogV2 } = foundry.applications.api;

export const SHEET_CLASSES = ["ukm", "ukm-sheet", "themed", "theme-light"];

const dress = (config = {}) => ({ ...config, classes: [...(config.classes ?? []), ...SHEET_CLASSES, "ukm-dialog"] });

export const UkmDialog = {
  wait: (config) => DialogV2.wait(dress(config)),
  confirm: (config) => DialogV2.confirm(dress(config)),
  prompt: (config) => DialogV2.prompt(dress(config))
};

/** The banner across the top of the module's windows: the kingdom's crest and name, and what the window is for. */
export function bannerContext(titleKey) {
  const kingdom = game.actors?.party?.campaign;
  return {
    title: game.i18n.localize(titleKey),
    subtitle: kingdom?.name || "",
    img: kingdom?.img || game.actors?.party?.img || "icons/svg/castle.svg"
  };
}
