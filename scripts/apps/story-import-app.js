import { MODULE_ID } from "../constants.js";
import { inspectSources, runStoryImport } from "../content/story-import.js";
import { buildStructureCatalog } from "../realm/projects.js";
import { ensureHandbook } from "../content/handbook.js";
import { getSetting, setSetting, SETTINGS } from "../settings.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class StoryImportApp extends HandlebarsApplicationMixin(ApplicationV2) {
  #state = "ready";
  #progress = null;
  #summary = null;

  static DEFAULT_OPTIONS = {
    id: "ukm-story-import",
    classes: ["ukm", "ukm-import"],
    window: { title: "UKM.Import.Title", icon: "fa-solid fa-book-open" },
    position: { width: 520, height: "auto" },
    actions: {
      startImport: StoryImportApp.#startImport,
      remindLater: StoryImportApp.#remindLater
    }
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/import/import.hbs` }
  };

  async _prepareContext() {
    const sources = inspectSources();
    return {
      state: this.#state,
      sources,
      ready: sources.kingmaker && sources.adventureImported,
      alreadyImported: getSetting(SETTINGS.storyImported),
      progress: this.#progress,
      summary: this.#summary,
      missingCount: this.#summary?.missing.length ?? 0
    };
  }

  static async #startImport() {
    this.#state = "running";
    await this.render();
    try {
      this.#summary = await runStoryImport({
        onProgress: (progress) => {
          this.#progress = {
            ...progress,
            label: game.i18n.localize(`UKM.Import.Category.${progress.category}`),
            percent: Math.round((progress.step / progress.total) * 100)
          };
          this.render();
        }
      });
      await setSetting(SETTINGS.storyImported, true);
      await buildStructureCatalog();
      await ensureHandbook();
      this.#state = "done";
    } catch (err) {
      console.error(err);
      ui.notifications.error(game.i18n.localize("UKM.Import.Failed"));
      this.#state = "ready";
    }
    await this.render();
  }

  static async #remindLater() {
    await setSetting(SETTINGS.importReminder, Date.now() + 1000 * 60 * 60 * 24);
    this.close();
  }
}
