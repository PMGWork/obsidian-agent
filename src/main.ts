import { Plugin } from "obsidian";
import { DEFAULT_SETTINGS, RagSettingTab, RagSettings } from "./settings";
import { RagView, RAG_VIEW_TYPE } from "./ui/rag_view";
import { registerCommands } from "./commands";
import { IndexState, DEFAULT_INDEX_STATE } from "./types";

type PersistedData = {
  settings?: Partial<RagSettings>;
  indexState?: IndexState;
};

export default class ObsidianRagPlugin extends Plugin {
  settings: RagSettings;
  indexState: IndexState;
  private statusListeners = new Set<(message: string) => void>();

  async onload() {
    await this.loadSettings();

    this.registerView(RAG_VIEW_TYPE, (leaf) => new RagView(leaf, this));
    this.addSettingTab(new RagSettingTab(this.app, this));
    registerCommands(this);
  }

  onunload() {
    this.app.workspace.detachLeavesOfType(RAG_VIEW_TYPE);
  }

  setStatus(message: string) {
    for (const listener of this.statusListeners) {
      listener(message);
    }
  }

  onStatusChange(listener: (message: string) => void): () => void {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  async loadSettings() {
    const raw = (await this.loadData()) as PersistedData | RagSettings | null;
    if (raw && "settings" in raw) {
      const persisted = raw as PersistedData;
      this.settings = Object.assign({}, DEFAULT_SETTINGS, persisted.settings ?? {});
      this.indexState = Object.assign({}, DEFAULT_INDEX_STATE, persisted.indexState ?? {});
    } else {
      const legacy = (raw ?? {}) as Partial<RagSettings>;
      this.settings = Object.assign({}, DEFAULT_SETTINGS, legacy);
      this.indexState = Object.assign({}, DEFAULT_INDEX_STATE);
    }
  }

  async saveSettings() {
    const data: PersistedData = {
      settings: this.settings,
      indexState: this.indexState,
    };
    await this.saveData(data);
  }

  async resetIndexState() {
    this.indexState = Object.assign({}, DEFAULT_INDEX_STATE);
    await this.saveSettings();
  }
}
