import { Plugin } from "obsidian";
import { DEFAULT_SETTINGS, RagSettingTab, RagSettings } from "./settings";
import { RagView, RAG_VIEW_TYPE } from "./ui/chat_view";
import { registerCommands } from "./commands";
import { openRagPanel } from "./commands/open_panel";
import { IndexState, DEFAULT_INDEX_STATE, ChatEntry } from "./types";

// プラグインの設定を保存するための型
type PersistedData = {
  settings?: Partial<RagSettings>;
  indexState?: IndexState;
  history?: ChatEntry[];
};

// プラグインのメインクラス
export default class ObsidianRagPlugin extends Plugin {
  settings: RagSettings;
  indexState: IndexState;
  history: ChatEntry[];
  private statusListeners = new Set<(message: string) => void>();

  // プラグインの初期化
  async onload() {
    await this.loadSettings();

    this.registerView(RAG_VIEW_TYPE, (leaf) => new RagView(leaf, this));
    this.addSettingTab(new RagSettingTab(this.app, this));
    registerCommands(this);

    this.app.workspace.onLayoutReady(() => {
      void openRagPanel(this);
    });
  }

  // 状態を設定する
  setStatus(message: string) {
    for (const listener of this.statusListeners) {
      listener(message);
    }
  }

  // 状態の変更を監視する
  onStatusChange(listener: (message: string) => void): () => void {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  // 設定を読み込む
  async loadSettings() {
    const raw = (await this.loadData()) as PersistedData | RagSettings | null;
    if (raw && "settings" in raw) {
      this.settings = Object.assign({}, DEFAULT_SETTINGS, raw.settings ?? {});
      this.indexState = Object.assign({}, DEFAULT_INDEX_STATE, raw.indexState ?? {});
      this.history = Array.isArray(raw.history) ? raw.history : [];
    } else {
      const legacy = (raw ?? {}) as Partial<RagSettings>;
      this.settings = Object.assign({}, DEFAULT_SETTINGS, legacy);
      this.indexState = Object.assign({}, DEFAULT_INDEX_STATE);
      this.history = [];
    }
  }

  // 設定を保存する
  async saveSettings() {
    const data: PersistedData = {
      settings: this.settings,
      indexState: this.indexState,
      history: this.history,
    };
    await this.saveData(data);
  }

  // インデックス状態をリセットする
  async resetIndexState() {
    this.indexState = Object.assign({}, DEFAULT_INDEX_STATE);
    await this.saveSettings();
  }

  // 特定のストアのインデックス状態をリセットする
  async resetIndexStateForStore(storeName: string) {
    this.indexState = Object.assign({}, DEFAULT_INDEX_STATE, { storeName });
    await this.saveSettings();
  }
}
