/* eslint-disable obsidianmd/no-static-styles-assignment */
import ObsidianRagPlugin from "../main";
import { ChatSession } from "../types";
import { ChatSaver } from "../services/chat_saver";
import { RagView, RAG_VIEW_TYPE } from "./chat_view";

export class HistoryDropdown {
  private plugin: ObsidianRagPlugin;
  private button: HTMLElement;
  private dropdown: HTMLElement | null = null;
  private chatSaver: ChatSaver;
  private isOpen = false;

  // インスタンスを初期化する
  constructor(button: HTMLElement, plugin: ObsidianRagPlugin) {
    this.button = button;
    this.plugin = plugin;
    this.chatSaver = new ChatSaver();
    this.setupEventListeners();
  }

  // イベントリスナーを設定する
  private setupEventListeners() {
    this.button.addEventListener("click", () => {
      if (this.isOpen) {
        this.hide();
      } else {
        void this.show();
      }
    });

    this.plugin.registerDomEvent(document, "click", (event) => {
      if (this.isOpen && !this.button.contains(event.target as Node) && !this.dropdown?.contains(event.target as Node)) {
        this.hide();
      }
    });
  }

  // ドロップダウンを表示する
  async show() {
    if (this.isOpen) {
      return;
    }

    this.isOpen = true;
    this.button.addClass("is-active");

    const sessions = await this.chatSaver.getSavedChats(this.plugin);

    const rect = this.button.getBoundingClientRect();

    this.dropdown = document.body.createEl("div", { cls: "gemini-rag-dropdown" });

    this.dropdown.style.position = "absolute";
    this.dropdown.style.top = `${rect.bottom}px`;
    this.dropdown.style.left = `${rect.left}px`;
    this.dropdown.style.zIndex = "1000";
    this.dropdown.style.maxWidth = "320px";

    const header = this.dropdown.createEl("div", { cls: "gemini-rag-dropdown-header" });
    header.createEl("span", { text: "Chat history" });

    if (sessions.length === 0) {
      const empty = this.dropdown.createEl("div", { cls: "gemini-rag-dropdown-empty", text: "No saved chats" });
      this.dropdown.appendChild(empty);
    } else {
      const list = this.dropdown.createEl("div", { cls: "gemini-rag-dropdown-list" });
      
      for (const session of sessions) {
        const item = list.createEl("div", { cls: "gemini-rag-dropdown-item" });
        if (this.plugin.currentSessionId === session.id) {
          item.addClass("is-active");
        }

        const info = item.createEl("div", { cls: "gemini-rag-dropdown-item-info" });

        info.createEl("div", { cls: "gemini-rag-dropdown-item-filename", text: session.title ?? session.filename });

        const meta = info.createEl("div", { cls: "gemini-rag-dropdown-item-meta" });
        const time = this.chatSaver.formatRelativeTime(session.updatedAt);
        meta.createEl("span", { cls: "gemini-rag-dropdown-item-time", text: time });

        item.addEventListener("click", () => {
          void this.loadSession(session);
          this.hide();
        });
      }
    }

    document.body.appendChild(this.dropdown);
  }

  // ドロップダウンを非表示にする
  hide() {
    if (!this.isOpen || !this.dropdown) {
      return;
    }

    this.isOpen = false;
    this.button.removeClass("is-active");
    this.dropdown.remove();
    this.dropdown = null;
  }

  // リソースを解放する
  dispose() {
    this.hide();
  }

  // 指定されたセッションを読み込んで履歴を描画する
  async loadSession(session: ChatSession) {
    await this.chatSaver.loadSession(this.plugin, session);
    const leaves = this.plugin.app.workspace.getLeavesOfType(RAG_VIEW_TYPE);
    for (const leaf of leaves) {
      const view = leaf.view;
      if (view instanceof RagView) {
        view.renderHistory();
      }
    }
  }
}
