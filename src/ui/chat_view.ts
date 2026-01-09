// チャットビューのUIコンポーネント

import { ItemView, Notice, WorkspaceLeaf, MarkdownRenderer, setIcon } from "obsidian";
import ObsidianRagPlugin from "../main";
import { GeminiClient, type GroundingMetadata } from "../services/gemini";
import { indexVaultCommand } from "../commands/index_vault";
import { createStoreCommand } from "../commands/create_store";
import { SourceItem, extractSources, annotateAnswer } from "../utils/grounding";
import { resolveVaultPath, openSource } from "../utils/source_navigation";

export const RAG_VIEW_TYPE = "gemini-file-search-rag-view";

// チャットビュークラス
export class RagView extends ItemView {
  private plugin: ObsidianRagPlugin;
  private hintEl?: HTMLElement;
  private chatEl?: HTMLElement;
  private sourcesMap = new Map<number, SourceItem>();
  private tooltipEl?: HTMLElement;

  constructor(leaf: WorkspaceLeaf, plugin: ObsidianRagPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return RAG_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Obsidian agent";
  }

  async onOpen(): Promise<void> {
    this.render();
  }

  // UIを描画する
  private render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("gemini-rag-view");

    const header = contentEl.createEl("div", { cls: "gemini-rag-header" });
    const titleWrap = header.createEl("div", { cls: "gemini-rag-title-wrap" });
    titleWrap.createEl("h2", { text: "Obsidian agent" });
    const headerActions = header.createEl("div", { cls: "gemini-rag-header-actions" });

    const newChatButton = headerActions.createEl("button", {
      cls: "gemini-rag-icon-btn",
      attr: { "aria-label": "New chat", title: "New chat" },
    });
    setIcon(newChatButton, "plus-circle");

    const main = contentEl.createEl("div", { cls: "gemini-rag-main" });
    this.chatEl = main.createEl("div", { cls: "gemini-rag-chat" });
    this.chatEl.addEventListener("click", (event) => {
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
    this.chatEl.addEventListener("mouseover", (event) => {
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
        this.showTooltip(link, source);
      }
    });
    this.chatEl.addEventListener("mouseout", (event) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      const link = target.closest("a");
      if (!link) return;
      const href = link.getAttribute("href");
      if (!href || !href.startsWith("citation:")) return;
      this.hideTooltip();
    });
    this.renderHistory();

    const controls = contentEl.createEl("div", { cls: "gemini-rag-controls" });
    const input = controls.createEl("textarea", {
      cls: "gemini-rag-input",
      attr: { rows: "5", placeholder: "Ask something about your notes..." },
    });
    this.hintEl = controls.createEl("div", { cls: "gemini-rag-hint" });
    this.hintEl.setText("⌘/Ctrl + Enter で送信");

    const buttons = controls.createEl("div", { cls: "gemini-rag-buttons" });
    const askButton = buttons.createEl("button", { cls: "gemini-rag-btn is-primary", text: "Ask" });
    const indexButton = buttons.createEl("button", { cls: "gemini-rag-btn", text: "Index vault" });
    const storeButton = buttons.createEl("button", { cls: "gemini-rag-btn", text: "Create store" });

    const triggerAsk = async () => {
      const question = input.value.trim();
      if (!question) {
        return;
      }
      input.value = "";
      await this.ask(question);
    };

    newChatButton.addEventListener("click", () => {
      void this.clearChat();
    });

    askButton.addEventListener("click", () => {
      void triggerAsk();
    });
    input.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        void triggerAsk();
      }
    });

    indexButton.addEventListener("click", () => {
      void indexVaultCommand(this.plugin);
    });

    storeButton.addEventListener("click", () => {
      void createStoreCommand(this.plugin);
    });
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
        }

        const annotatedText = annotateAnswer(
          fullText,
          combinedGrounding,
          extractSources(combinedGrounding, () => "") // Temporary source resolution
        );
        const output = this.formatOutput(annotatedText, fullThought, false);

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
      const finalOutput = this.formatOutput(finalAnnotatedText, fullThought, true);

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

  // 出力をフォーマットする
  private formatOutput(answer: string, thoughtSummary?: string, isFinal = false): string {
    let title = "Thinking...";
    if (isFinal) {
      title = "推論完了";
    } else if (thoughtSummary) {
      title = this.getLatestThoughtTitle(thoughtSummary);
    }

    const callout = `> [!info] ${title}`;

    if (!answer.trim()) {
      return callout;
    }
    return `${callout}\n\n${answer}`;
  }

  // 最新の思考内容からタイトルを生成する
  private getLatestThoughtTitle(fullThought: string): string {
    if (!fullThought) return "Thinking...";

    const lines = fullThought.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
    const lastLine = lines[lines.length - 1];

    if (!lastLine) return "Thinking...";

    // 見出し記号などを削除
    const cleanLine = lastLine
      .replace(/^#+\s*/, "")
      .replace(/^[-*]\s+/, "")
      .replace(/^>\s+/, "");

    const maxLength = 50;
    if (cleanLine.length > maxLength) {
      return cleanLine.substring(0, maxLength) + "...";
    }
    return cleanLine;
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

    for (const entry of this.plugin.history) {
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
    }
    this.scrollToBottom();
  }

  // ツールチップを表示する
  private showTooltip(anchor: HTMLElement, source: SourceItem) {
    this.hideTooltip();
    const tooltip = document.createElement("div");
    tooltip.className = "gemini-rag-tooltip";

    const header = tooltip.createEl("div", { cls: "gemini-rag-tooltip-header" });
    header.createEl("span", { cls: "gemini-rag-tooltip-icon", text: "📄" });
    header.createEl("span", { cls: "gemini-rag-tooltip-title", text: source.label });

    if (source.text) {
      const preview = source.text.slice(0, 150).trim();
      const previewText = preview.length < source.text.length ? preview + "..." : preview;
      tooltip.createEl("div", { cls: "gemini-rag-tooltip-body", text: previewText });
    } else if (source.detail) {
      tooltip.createEl("div", { cls: "gemini-rag-tooltip-body", text: source.detail });
    }

    document.body.appendChild(tooltip);
    this.tooltipEl = tooltip;

    const rect = anchor.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    let left = rect.left + rect.width / 2 - tooltipRect.width / 2;
    let top = rect.bottom + 8;

    if (left < 8) left = 8;
    if (left + tooltipRect.width > window.innerWidth - 8) {
      left = window.innerWidth - tooltipRect.width - 8;
    }
    if (top + tooltipRect.height > window.innerHeight - 8) {
      top = rect.top - tooltipRect.height - 8;
    }

    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }

  // ツールチップを非表示にする
  private hideTooltip() {
    if (this.tooltipEl) {
      this.tooltipEl.remove();
      this.tooltipEl = undefined;
    }
  }


  // 最下部へスクロール
  private scrollToBottom() {
    if (this.chatEl) {
      this.chatEl.scrollTop = this.chatEl.scrollHeight;
    }
  }
}
