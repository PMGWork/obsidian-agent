import { Plugin } from "obsidian";
import { DEFAULT_SETTINGS, RagSettingTab, RagSettings } from "./settings";
import { RagView, RAG_VIEW_TYPE } from "./ui/chat_view";
import { registerCommands } from "./commands";
import { openRagPanel } from "./commands/open_panel";
import { IndexState, DEFAULT_INDEX_STATE, ChatEntry, ChatSession } from "./types";
import { IndexingController } from "./services/indexing";
import { ChatSaver } from "./services/chat_saver";

// プラグインの設定を保存するための型
type PersistedData = {
  settings?: Partial<RagSettings>;
  indexState?: IndexState;
  history?: ChatEntry[];
  currentSessionId?: string;
  sessions?: Record<string, ChatSession>;
};

// プラグインのメインクラス
export default class ObsidianRagPlugin extends Plugin {
  settings: RagSettings;
  indexState: IndexState;
  history: ChatEntry[];
  currentSessionId: string;
  sessions: Record<string, ChatSession>;
  indexing: IndexingController;
  chatSaver: ChatSaver;
  private statusListeners = new Set<(message: string) => void>();

  // プラグインの初期化
  async onload() {
    await this.loadSettings();
    this.indexing = new IndexingController();
    this.chatSaver = new ChatSaver();

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
      this.currentSessionId = raw.currentSessionId ?? "";
      this.sessions = raw.sessions ?? {};
    } else {
      const legacy = (raw ?? {}) as Partial<RagSettings>;
      this.settings = Object.assign({}, DEFAULT_SETTINGS, legacy);
      this.indexState = Object.assign({}, DEFAULT_INDEX_STATE);
      this.history = [];
      this.currentSessionId = "";
      this.sessions = {};
    }
  }

  // 設定を保存する
  async saveSettings() {
    const data: PersistedData = {
      settings: this.settings,
      indexState: this.indexState,
      history: this.history,
      currentSessionId: this.currentSessionId,
      sessions: this.sessions,
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

  // 新しいチャットセッションを作成する
  async createChatSession() {
    const timestamp = Date.now();
    const session = this.chatSaver.createSession(timestamp);

    this.currentSessionId = session.id;
    this.sessions[session.id] = session;
    this.history = [];

    await this.saveSettings();

    await this.chatSaver.saveSession(this);

    return session;
  }

  // 履歴を保持してセッションを作成する
  async createSessionWithoutReset() {
    const timestamp = Date.now();
    const session = this.chatSaver.createSession(timestamp);

    this.currentSessionId = session.id;
    this.sessions[session.id] = session;

    await this.saveSettings();

    await this.chatSaver.saveSession(this);

    return session;
  }

  // チャットセッションを確保する
  async ensureChatSession() {
    if (this.currentSessionId && this.sessions[this.currentSessionId]) {
      return;
    }
    await this.createSessionWithoutReset();
  }

  // 現在のチャットセッションを取得する
  getCurrentSession(): ChatSession | null {
    if (!this.currentSessionId) {
      return null;
    }
    return this.sessions[this.currentSessionId] || null;
  }

  // 現在のチャットセッションを更新する
  async updateChatSession() {
    const session = this.getCurrentSession();
    if (!session) {
      return;
    }

    session.updatedAt = Date.now();
    this.sessions[session.id] = session;
    await this.saveSettings();

    await this.chatSaver.saveSession(this);
  }

  // チャットセッションのタイトルを更新する
  async updateChatSessionTitle(title: string) {
    const session = this.getCurrentSession();
    if (!session) {
      return;
    }

    session.title = title;
    this.sessions[session.id] = session;
    await this.saveSettings();

    await this.chatSaver.saveSession(this);
  }
}
