// チャットビューのUIコンポーネント

import { ItemView, Notice, WorkspaceLeaf, MarkdownRenderer, setIcon } from "obsidian";
import ObsidianRagPlugin from "../main";
import { GeminiClient, type GroundingMetadata } from "../services/gemini";
import { indexVaultCommand } from "../commands/index_vault";
import { createStoreCommand } from "../commands/create_store";
import { exportChatCommand } from "../commands/export_chat";
import { SourceItem, extractSources, annotateAnswer } from "../utils/grounding";
import { resolveVaultPath, openSource } from "../utils/source_navigation";
import { CitationTooltip } from "./chat_view/citation_tooltip";
import { formatOutput } from "./chat_view/formatting";
import { IndexProgressUI } from "./chat_view/index_progress";
import { ChatEntry } from "../types";

export const RAG_VIEW_TYPE = "gemini-file-search-rag-view";

// チャットビュークラス
export class RagView extends ItemView {
  private plugin: ObsidianRagPlugin;
  private chatEl?: HTMLElement;
  private sourcesMap = new Map<number, SourceItem>();
  private tooltip = new CitationTooltip();
  private indexUnsub?: () => void;
  private indexProgress?: IndexProgressUI;

  // コンストラクタ
  constructor(leaf: WorkspaceLeaf, plugin: ObsidianRagPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  // ビュータイプを取得する
  getViewType(): string {
    return RAG_VIEW_TYPE;
  }

  // 表示テキストを取得する
  getDisplayText(): string {
    return "Obsidian agent";
  }

  // ビューが開かれたときの処理
  async onOpen(): Promise<void> {
    this.render();
  }

  // ビューが閉じられたときの処理
  async onClose(): Promise<void> {
    this.indexUnsub?.();
    this.tooltip.hide();
  }

  // UIを描画する
  private render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("gemini-rag-view");
    this.indexUnsub?.();

    const headerButtons = this.renderHeader(contentEl);
    const { chatWrap, chatEl } = this.renderChatArea(contentEl);
    this.chatEl = chatEl;
    this.renderHistory();

    const { input, askButton } = this.renderControls(contentEl);
    const cancelButton = this.setupIndexProgress(chatWrap, headerButtons.indexButton);

    const triggerAsk = async () => {
      const question = input.value.trim();
      if (!question) {
        return;
      }
      input.value = "";
      await this.ask(question);
    };

    headerButtons.settingsButton.addEventListener("click", () => {
      const appSetting = (this.app as { setting?: { open: () => void; openTabById: (id: string) => void } }).setting;
      if (!appSetting) return;
      appSetting.open();
      appSetting.openTabById(this.plugin.manifest.id);
    });

    headerButtons.createIndexButton.addEventListener("click", () => {
      void createStoreCommand(this.plugin);
    });

    headerButtons.exportButton.addEventListener("click", () => {
      void exportChatCommand(this.plugin);
    });

    headerButtons.newChatButton.addEventListener("click", () => {
      void this.clearChat();
    });

    askButton.addEventListener("click", () => {
      void triggerAsk();
    });
    input.addEventListener("keydown", (event) => {
      // Shift+Enter or Ctrl/Cmd+Enter to send
      if ((event.shiftKey && event.key === "Enter") || 
          ((event.ctrlKey || event.metaKey) && event.key === "Enter")) {
        event.preventDefault();
        void triggerAsk();
      }
    });

    headerButtons.indexButton.addEventListener("click", () => {
      void indexVaultCommand(this.plugin);
    });

    cancelButton.addEventListener("click", () => {
      const cancelled = this.plugin.indexing.requestCancel();
      if (!cancelled) {
        new Notice("No indexing task running.");
      }
    });
  }

  // ヘッダーを描画する
  private renderHeader(contentEl: HTMLElement) {
    const header = contentEl.createEl("div", { cls: "gemini-rag-header" });
    const headerLeft = header.createEl("div", { cls: "gemini-rag-header-left" });
    const headerActions = header.createEl("div", { cls: "gemini-rag-header-actions" });

    const settingsButton = headerLeft.createEl("button", {
      cls: "gemini-rag-icon-btn",
      attr: { "aria-label": "Settings", title: "Settings" },
    });
    setIcon(settingsButton, "settings");

    const createIndexButton = headerLeft.createEl("button", {
      cls: "gemini-rag-icon-btn",
      attr: { "aria-label": "Create index", title: "Create index" },
    });
    setIcon(createIndexButton, "database");

    const indexButton = headerLeft.createEl("button", {
      cls: "gemini-rag-icon-btn",
      attr: { "aria-label": "Index vault", title: "Index vault" },
    });
    setIcon(indexButton, "refresh-cw");

    const exportButton = headerActions.createEl("button", {
      cls: "gemini-rag-icon-btn",
      attr: { "aria-label": "Export chat", title: "Export chat" },
    });
    setIcon(exportButton, "download");

    const newChatButton = headerActions.createEl("button", {
      cls: "gemini-rag-icon-btn",
      attr: { "aria-label": "New chat", title: "New chat" },
    });
    setIcon(newChatButton, "plus-circle");

    return { settingsButton, createIndexButton, indexButton, exportButton, newChatButton };
  }

  // チャット表示領域を描画する
  private renderChatArea(contentEl: HTMLElement) {
    const main = contentEl.createEl("div", { cls: "gemini-rag-main" });
    const chatWrap = main.createEl("div", { cls: "gemini-rag-chat-wrap" });
    const chatEl = chatWrap.createEl("div", { cls: "gemini-rag-chat" });
    this.bindCitationEvents(chatEl);
    return { chatWrap, chatEl };
  }

  // チャット領域のリンクイベントを登録する
  private bindCitationEvents(chatEl: HTMLElement) {
    chatEl.addEventListener("click", (event) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      const link = target.closest("a");
      if (!link) return;
      const href = link.getAttribute("href");
      if (!href || !href.startsWith("citation:")) return;
      event.preventDefault();
      const indexText = href.replace("citation:", "");
      const index = Number(indexText);
      if (!Number.isFinite(index)) return;

      const source = this.sourcesMap.get(index);
      if (source) {
        void openSource(this.app, source);
      }
    });
    chatEl.addEventListener("mouseover", (event) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      const link = target.closest("a");
      if (!link) return;
      const href = link.getAttribute("href");
      if (!href || !href.startsWith("citation:")) return;
      const indexText = href.replace("citation:", "");
      const index = Number(indexText);
      if (!Number.isFinite(index)) return;
      const source = this.sourcesMap.get(index);
      if (source) {
        this.tooltip.show(link, source);
      }
    });
    chatEl.addEventListener("mouseout", (event) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      const link = target.closest("a");
      if (!link) return;
      const href = link.getAttribute("href");
      if (!href || !href.startsWith("citation:")) return;
      this.tooltip.hide();
    });
  }

  // 入力コントロールを描画する
  private renderControls(contentEl: HTMLElement) {
    const controls = contentEl.createEl("div", { cls: "gemini-rag-controls" });
    const inputWrap = controls.createEl("div", { cls: "gemini-rag-input-wrap" });
    const input = inputWrap.createEl("textarea", {
      cls: "gemini-rag-input",
      attr: { 
        rows: "3", 
        placeholder: "Ask something about your notes... (Shift+Enter or Cmd/Ctrl+Enter to send)" 
      },
    });

    const askButton = inputWrap.createEl("button", {
      cls: "gemini-rag-btn is-primary is-icon gemini-rag-send",
      attr: { "aria-label": "Send", title: "Send" },
    });
    setIcon(askButton, "send");

    return { input, askButton };
  }

  // インデックス進捗UIを初期化する
  private setupIndexProgress(chatWrap: HTMLElement, indexButton: HTMLButtonElement) {
    this.indexProgress = new IndexProgressUI(chatWrap, indexButton, this.shortenPath.bind(this));

    this.indexUnsub = this.plugin.indexing.onChange((state) => {
      this.indexProgress?.render(state);
    });

    return this.indexProgress.cancelButton;
  }

  // チャットをクリアする
  async clearChat() {
    this.plugin.history = [];
    await this.plugin.saveSettings();
    this.sourcesMap.clear();
    this.renderHistory();
  }

  // 質問を送信して回答を取得する
  private async ask(question: string) {
    const apiKey = this.plugin.settings.apiKey;
    const storeName = this.plugin.settings.storeName;
    const model = this.plugin.settings.model;
    if (!apiKey) {
      new Notice("API key is not set.");
      return;
    }
    if (!storeName) {
      new Notice("File search store name is not set.");
      return;
    }

    const client = new GeminiClient(apiKey);
    try {
      this.plugin.setStatus("Generating answer...");

      const history = this.plugin.history.slice(-10);

      let fullText = "";
      let fullThought = "";
      let combinedGrounding: GroundingMetadata | undefined;
      let streamingSources: SourceItem[] = [];

      if (!this.chatEl) return;

      // User bubble
      const userBubble = this.chatEl.createEl("div", { cls: "gemini-rag-chat-bubble user" });
      userBubble.createEl("div", { cls: "gemini-rag-chat-text", text: question });
      this.scrollToBottom();

      // Create placeholders
      const assistantBubble = this.chatEl.createEl("div", { cls: "gemini-rag-chat-bubble assistant" });
      const answerEl = assistantBubble.createEl("div", { cls: "gemini-rag-chat-text" });

      await client.generateContentStream(model, storeName, question, async (chunk) => {
        const { text, grounding, thoughtSummary } = client.extractAnswer(chunk);
        if (text) fullText += text;
        if (thoughtSummary) fullThought += thoughtSummary;
        if (grounding) {
          combinedGrounding = {
            ...combinedGrounding,
            ...grounding,
            groundingChunks: [
              ...(combinedGrounding?.groundingChunks ?? []),
              ...(grounding.groundingChunks ?? []),
            ],
            groundingSupports: [
              ...(combinedGrounding?.groundingSupports ?? []),
              ...(grounding.groundingSupports ?? []),
            ],
          };
          streamingSources = extractSources(combinedGrounding, () => "");
        }

        const annotatedText = annotateAnswer(fullText, combinedGrounding, streamingSources);
        const output = formatOutput(annotatedText, fullThought, false);

        answerEl.empty();
        await MarkdownRenderer.render(
          this.plugin.app,
          output,
          answerEl,
          this.plugin.app.vault.getRoot().path,
          this
        );
        this.scrollToBottom();
      }, history, true);

      // Final render with correct links
      const sources = extractSources(combinedGrounding, (title) => resolveVaultPath(this.app, title));
      this.sourcesMap.clear();
      for (const source of sources) {
        this.sourcesMap.set(source.index, source);
      }
      const finalAnnotatedText = annotateAnswer(fullText, combinedGrounding, sources);
      const finalOutput = formatOutput(finalAnnotatedText, fullThought, true);

      answerEl.empty();
      await MarkdownRenderer.render(
        this.plugin.app,
        finalOutput,
        answerEl,
        this.plugin.app.vault.getRoot().path,
        this
      );

      this.scrollToBottom();
      this.pushHistory(question, finalOutput);

    } catch (error) {
      console.error(error);
      new Notice("Failed to generate answer. Check console for details.");
    } finally {
      this.plugin.setStatus("");
    }
  }


  // 履歴に追加する
  private pushHistory(question: string, answer: string) {
    const entry = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      timestamp: Date.now(),
      question,
      answer,
    };
    const maxItems = 50;
    this.plugin.history.push(entry);
    if (this.plugin.history.length > maxItems) {
      this.plugin.history = this.plugin.history.slice(-maxItems);
    }
    void this.plugin.saveSettings();
  }

  // 履歴を描画する
  private renderHistory() {
    if (!this.chatEl) return;
    this.chatEl.empty();
    if (!this.plugin.history.length) {
      this.chatEl.createEl("div", { cls: "gemini-rag-chat-empty", text: "No messages yet." });
      return;
    }

    for (let i = 0; i < this.plugin.history.length; i++) {
      const entry = this.plugin.history[i]!;
      const isLast = i === this.plugin.history.length - 1;
      
      const userBubble = this.chatEl.createEl("div", { cls: "gemini-rag-chat-bubble user" });
      userBubble.createEl("div", { cls: "gemini-rag-chat-text", text: entry.question });

      const assistantBubble = this.chatEl.createEl("div", { cls: "gemini-rag-chat-bubble assistant" });
      const answerEl = assistantBubble.createEl("div", { cls: "gemini-rag-chat-text" });
      void MarkdownRenderer.render(
        this.plugin.app,
        entry.answer,
        answerEl,
        this.plugin.app.vault.getRoot().path,
        this
      );
      
      // Add action buttons for assistant messages
      this.addMessageActions(assistantBubble, entry, isLast);
    }
    this.scrollToBottom();
  }

  // メッセージにアクションボタンを追加
  private addMessageActions(bubble: HTMLElement, entry: ChatEntry, isLast: boolean) {
    const actions = bubble.createEl("div", { cls: "gemini-rag-message-actions" });
    
    // Copy button
    const copyButton = actions.createEl("button", {
      cls: "gemini-rag-action-btn",
      attr: { "aria-label": "Copy", title: "Copy" },
    });
    setIcon(copyButton, "copy");
    copyButton.addEventListener("click", () => {
      void navigator.clipboard.writeText(entry.answer);
      new Notice("Copied to clipboard");
    });
    
    // Delete button
    const deleteButton = actions.createEl("button", {
      cls: "gemini-rag-action-btn",
      attr: { "aria-label": "Delete", title: "Delete this question and answer pair" },
    });
    setIcon(deleteButton, "trash");
    deleteButton.addEventListener("click", () => {
      void this.deleteMessage(entry.id);
    });
    
    // Regenerate button (only for last message)
    if (isLast) {
      const regenerateButton = actions.createEl("button", {
        cls: "gemini-rag-action-btn",
        attr: { "aria-label": "Regenerate", title: "Regenerate" },
      });
      setIcon(regenerateButton, "refresh-cw");
      regenerateButton.addEventListener("click", () => {
        void this.regenerateLastMessage();
      });
    }
  }

  // メッセージを削除
  private async deleteMessage(id: string) {
    const index = this.plugin.history.findIndex(entry => entry.id === id);
    if (index === -1) {
      new Notice("Message not found");
      return;
    }
    
    this.plugin.history.splice(index, 1);
    await this.plugin.saveSettings();
    this.renderHistory();
    new Notice("Message deleted");
  }

  // 最後のメッセージを再生成
  private async regenerateLastMessage() {
    if (this.plugin.history.length === 0) {
      new Notice("No messages to regenerate");
      return;
    }
    
    const lastEntry = this.plugin.history[this.plugin.history.length - 1]!;
    // Remove last entry and ask again
    this.plugin.history.pop();
    await this.plugin.saveSettings();
    this.renderHistory();
    await this.ask(lastEntry.question);
  }

  private shortenPath(path: string): string {
    const maxLength = 60;
    if (path.length <= maxLength) {
      return path;
    }
    const parts = path.split("/");
    if (parts.length <= 2) {
      return `…${path.slice(-maxLength + 1)}`;
    }
    const tail = parts.slice(-2).join("/");
    return `…/${tail}`;
  }

  // 最下部へスクロール
  private scrollToBottom() {
    if (this.chatEl) {
      this.chatEl.scrollTop = this.chatEl.scrollHeight;
    }
  }
}
