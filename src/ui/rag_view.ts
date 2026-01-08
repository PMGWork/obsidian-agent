import { ItemView, Notice, WorkspaceLeaf, TFile, MarkdownRenderer, MarkdownView, Editor } from "obsidian";
import ObsidianRagPlugin from "../main";
import { GeminiClient } from "../services/gemini";
import { indexVaultCommand } from "../commands/index_vault";
import { createStoreCommand } from "../commands/create_store";

export const RAG_VIEW_TYPE = "gemini-file-search-rag-view";

type SourceItem = {
  label: string;
  detail?: string;
  path?: string;
  uri?: string;
  index: number;
  text?: string;
};

export class RagView extends ItemView {
  private plugin: ObsidianRagPlugin;
  private cleanupStatus?: () => void;
  private statusEl?: HTMLElement;
  private sourcesSection?: HTMLDetailsElement;
  private sourcesSummaryEl?: HTMLElement;
  private sourcesEl?: HTMLElement;
  private hintEl?: HTMLElement;
  private chatEl?: HTMLElement;
  private sourcesMap = new Map<number, SourceItem>();

  constructor(leaf: WorkspaceLeaf, plugin: ObsidianRagPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return RAG_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Obsidian Agent";
  }

  async onOpen(): Promise<void> {
    this.render();
    this.cleanupStatus = this.plugin.onStatusChange((message) => {
      if (this.statusEl) {
        this.statusEl.setText(message);
        if (message) {
          this.statusEl.addClass("is-active");
        } else {
          this.statusEl.removeClass("is-active");
        }
      }
    });
  }

  async onClose(): Promise<void> {
    if (this.cleanupStatus) {
      this.cleanupStatus();
    }
  }

  private render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("gemini-rag-view");

    const header = contentEl.createEl("div", { cls: "gemini-rag-header" });
    const titleWrap = header.createEl("div", { cls: "gemini-rag-title-wrap" });
    titleWrap.createEl("h2", { text: "Obsidian Agent" });
    this.statusEl = header.createEl("div", { cls: "gemini-rag-status-pill" });

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
      this.focusSource(index);
      const source = this.sourcesMap.get(index);
      if (source) {
        void this.openSource(source, true);
      }
    });
    this.renderHistory();

    this.sourcesSection = main.createEl("details", { cls: "gemini-rag-sources-section" }) as HTMLDetailsElement;
    this.sourcesSummaryEl = this.sourcesSection.createEl("summary", { text: "引用一覧" });
    this.sourcesEl = this.sourcesSection.createEl("div", { cls: "gemini-rag-sources" });

    const controls = contentEl.createEl("div", { cls: "gemini-rag-controls" });
    const inputLabel = controls.createEl("div", { cls: "gemini-rag-label" });
    inputLabel.setText("Ask about your notes");
    const input = controls.createEl("textarea", {
      cls: "gemini-rag-input",
      attr: { rows: "5", placeholder: "Ask something about your notes..." },
    });
    this.hintEl = controls.createEl("div", { cls: "gemini-rag-hint" });
    this.hintEl.setText("⌘/Ctrl + Enter で送信");

    const buttons = controls.createEl("div", { cls: "gemini-rag-buttons" });
    const newChatButton = buttons.createEl("button", { cls: "gemini-rag-btn", text: "New chat" });
    const askButton = buttons.createEl("button", { cls: "gemini-rag-btn is-primary", text: "Ask" });
    const indexButton = buttons.createEl("button", { cls: "gemini-rag-btn", text: "Index vault" });
    const storeButton = buttons.createEl("button", { cls: "gemini-rag-btn", text: "Create store" });

    const triggerAsk = async () => {
      const question = input.value.trim();
      if (!question) {
        return;
      }
      await this.ask(question);
    };

    newChatButton.addEventListener("click", async () => {
      await this.clearChat();
    });

    askButton.addEventListener("click", triggerAsk);
    input.addEventListener("keydown", async (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        await triggerAsk();
      }
    });

    indexButton.addEventListener("click", async () => {
      await indexVaultCommand(this.plugin);
    });

    storeButton.addEventListener("click", async () => {
      await createStoreCommand(this.plugin);
    });
  }

  async clearChat() {
    this.plugin.history = [];
    await this.plugin.saveSettings();
    this.sourcesMap.clear();
    if (this.sourcesEl) {
      this.sourcesEl.setText("");
    }
    if (this.sourcesSummaryEl) {
      this.sourcesSummaryEl.setText("引用一覧 (0)");
    }
    if (this.sourcesSection) {
      this.sourcesSection.open = false;
    }
    this.renderHistory();
  }

  private focusSource(index: number) {
    if (!this.sourcesSection || !this.sourcesEl) {
      return;
    }
    this.sourcesSection.open = true;
    const items = this.sourcesEl.querySelectorAll<HTMLElement>(".gemini-rag-source-item");
    items.forEach((item) => {
      item.removeClass("is-active");
    });
    const target = this.sourcesEl.querySelector<HTMLElement>(`[data-source-index="${index}"]`);
    if (target) {
      target.addClass("is-active");
      target.scrollIntoView({ block: "nearest" });
    }
  }

  private async ask(question: string) {
    const apiKey = this.plugin.settings.apiKey;
    const storeName = this.plugin.settings.storeName;
    const model = this.plugin.settings.model;
    if (!apiKey) {
      new Notice("API key is not set.");
      return;
    }
    if (!storeName) {
      new Notice("File Search store name is not set.");
      return;
    }

    const client = new GeminiClient(apiKey);
    try {
      this.plugin.setStatus("Generating answer...");
      if (this.statusEl) {
        this.statusEl.setText("Thinking...");
        this.statusEl.addClass("is-active");
      }
      if (this.sourcesEl) this.sourcesEl.setText("");

      const response = await client.generateContent(
        model,
        storeName,
        question,
        this.plugin.settings.metadataFilter || undefined,
        this.plugin.settings.showReasoningSummary
      );
      const { text, grounding, thoughtSummary } = client.extractAnswer(response);
      const sources = this.extractSources(grounding);
      this.sourcesMap.clear();
      for (const source of sources) {
        this.sourcesMap.set(source.index, source);
      }
      const annotatedText = this.annotateAnswer(text, grounding, sources);
      const output = this.formatOutput(annotatedText, thoughtSummary);
      this.pushHistory(question, output);
      this.renderHistory();

      if (this.sourcesSummaryEl) {
        this.sourcesSummaryEl.setText(`引用一覧 (${sources.length})`);
      }
      if (this.sourcesSection) {
        this.sourcesSection.open = false;
      }
      if (this.sourcesEl) {
        if (sources.length === 0) {
          this.sourcesEl.createEl("div", { text: "No sources returned." });
        } else {
          const list = this.sourcesEl.createEl("ol");
          for (const source of sources) {
            const item = list.createEl("li");
            item.addClass("gemini-rag-source-item");
            item.setAttr("data-source-index", String(source.index));
            const link = item.createEl("a", {
              text: `[${source.index}] ${source.label}`,
              cls: "gemini-rag-source-link",
            });
            link.addEventListener("click", (event) => {
              event.preventDefault();
              this.focusSource(source.index);
              void this.openSource(source, true);
            });
          }
        }
      }
    } catch (error) {
      console.error(error);
      new Notice("Failed to generate answer. Check console for details.");
    } finally {
      this.plugin.setStatus("");
      if (this.statusEl) {
        this.statusEl.setText("");
        this.statusEl.removeClass("is-active");
      }
    }
  }

  private formatOutput(answer: string, thoughtSummary?: string): string {
    if (!this.plugin.settings.showReasoningSummary || !thoughtSummary) {
      return answer;
    }
    const title = this.plugin.settings.reasoningTitle?.trim() || "推論の要約";
    const summary = thoughtSummary.trim();
    if (!summary) {
      return answer;
    }
    if (!answer.trim()) {
      return `**${title}**\n\n${summary}`;
    }
    return `**${title}**\n\n${summary}\n\n${answer}`;
  }

  private pushHistory(question: string, answer: string) {
    const entry = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      timestamp: Date.now(),
      question,
      answer,
    };
    const maxItems = 50;
    this.plugin.history.unshift(entry);
    if (this.plugin.history.length > maxItems) {
      this.plugin.history = this.plugin.history.slice(0, maxItems);
    }
    void this.plugin.saveSettings();
  }

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
      void MarkdownRenderer.renderMarkdown(
        entry.answer,
        answerEl,
        this.plugin.app.vault.getRoot().path,
        this
      );
    }
  }


  private extractSources(grounding?: { groundingChunks?: Array<Record<string, unknown>> }): SourceItem[] {
    if (!grounding?.groundingChunks) {
      return [];
    }
    return grounding.groundingChunks.map((chunk, index) => {
      const context = (chunk.retrievedContext ?? chunk["retrieved_context"]) as Record<string, unknown> | undefined;
      const title = (context?.title ?? context?.displayName ?? context?.["display_name"]) as string | undefined;
      const uri = (context?.uri ?? context?.["uri"]) as string | undefined;
      const text = (context?.text ?? context?.["text"]) as string | undefined;
      const label = title || uri || `Chunk ${index + 1}`;
      const detail = text ? text.slice(0, 200) : undefined;
      const path = this.resolveVaultPath(title);
      return { label, detail, path, uri, index: index + 1, text };
    });
  }

  private annotateAnswer(
    text: string,
    grounding: { groundingSupports?: Array<Record<string, unknown>>; grounding_supports?: Array<Record<string, unknown>> } | undefined,
    sources: SourceItem[]
  ): string {
    if (!grounding) {
      return text;
    }
    const supports =
      (grounding.groundingSupports ??
        (grounding as { grounding_supports?: Array<Record<string, unknown>> }).grounding_supports) ??
      [];
    if (supports.length === 0) {
      return text;
    }

    const positionMap = new Map<number, number[]>();
    for (const support of supports) {
      const segment = (support.segment ?? support["segment"]) as Record<string, unknown> | undefined;
      const endIndex = segment?.endIndex ?? segment?.["end_index"];
      const chunkIndices = (support.groundingChunkIndices ??
        support["grounding_chunk_indices"]) as number[] | undefined;
      if (typeof endIndex !== "number" || !Array.isArray(chunkIndices)) {
        continue;
      }
      const numbers = chunkIndices
        .map((idx) => sources[idx]?.index)
        .filter((value): value is number => typeof value === "number");
      if (numbers.length === 0) {
        continue;
      }
      const unique = Array.from(new Set(numbers)).sort((a, b) => a - b);
      const sentenceEnd = this.findSentenceEnd(text, endIndex);
      const existing = positionMap.get(sentenceEnd) ?? [];
      positionMap.set(sentenceEnd, existing.concat(unique));
    }

    if (positionMap.size === 0) {
      return text;
    }

    const insertions: Array<{ pos: number; marker: string }> = [];
    for (const [pos, numbers] of positionMap.entries()) {
      const unique = Array.from(new Set(numbers)).sort((a, b) => a - b);
      const marker = unique.map((value) => `[${value}](citation:${value})`).join(" ");
      insertions.push({ pos, marker });
    }

    insertions.sort((a, b) => b.pos - a.pos);
    let output = text;
    for (const insertion of insertions) {
      if (insertion.pos >= 0 && insertion.pos <= output.length) {
        output = output.slice(0, insertion.pos) + insertion.marker + output.slice(insertion.pos);
      } else {
        output += insertion.marker;
      }
    }
    return output;
  }

  private findSentenceEnd(text: string, startIndex: number): number {
    if (startIndex >= text.length) {
      return text.length;
    }
    const endChars = [".", "!", "?", "。", "！", "？"];
    const closingChars = new Set([
      "」",
      "』",
      "）",
      ")",
      "】",
      "]",
      "］",
      "｝",
      "}",
      "〉",
      "》",
      "”",
      "\"",
      "’",
      "'",
    ]);
    let endIndex = -1;
    for (let i = Math.max(0, startIndex); i < text.length; i += 1) {
      const char = text.charAt(i);
      if (char === "\r" && text.charAt(i + 1) === "\n") {
        if (text.charAt(i + 2) === "\n") {
          endIndex = i;
          break;
        }
        if (this.isLineBreakBoundary(text, i + 2)) {
          endIndex = i;
          break;
        }
        continue;
      }
      if (char === "\n" && text.charAt(i + 1) === "\n") {
        endIndex = i;
        break;
      }
      if (char === "\n" && this.isLineBreakBoundary(text, i + 1)) {
        endIndex = i;
        break;
      }
      if (endChars.includes(char)) {
        endIndex = i + 1;
        break;
      }
    }
    if (endIndex === -1) {
      return text.length;
    }
    let cursor = endIndex;
    while (cursor < text.length) {
      const char = text.charAt(cursor);
      if (endChars.includes(char)) {
        cursor += 1;
        continue;
      }
      if (closingChars.has(char)) {
        cursor += 1;
        continue;
      }
      break;
    }
    return cursor;
  }

  private isLineBreakBoundary(text: string, startIndex: number): boolean {
    let cursor = startIndex;
    while (cursor < text.length) {
      const char = text.charAt(cursor);
      if (char !== " " && char !== "\t") {
        break;
      }
      cursor += 1;
    }
    if (cursor >= text.length) {
      return true;
    }
    const nextChar = text.charAt(cursor);
    if (nextChar === "\n") {
      return true;
    }
    if (nextChar === ">") {
      return true;
    }
    if (nextChar === "-" || nextChar === "*" || nextChar === "+") {
      return text.charAt(cursor + 1) === " ";
    }
    if (nextChar === "#") {
      let count = 0;
      while (cursor + count < text.length && text.charAt(cursor + count) === "#") {
        count += 1;
      }
      return count > 0 && count <= 6 && text.charAt(cursor + count) === " ";
    }
    if (nextChar >= "0" && nextChar <= "9") {
      let index = cursor;
      while (index < text.length) {
        const digit = text.charAt(index);
        if (digit < "0" || digit > "9") {
          break;
        }
        index += 1;
      }
      const marker = text.charAt(index);
      return (marker === "." || marker === ")") && text.charAt(index + 1) === " ";
    }
    return false;
  }

  private resolveVaultPath(title?: string): string | undefined {
    if (!title) {
      return undefined;
    }
    const file = this.app.vault.getAbstractFileByPath(title);
    if (file) {
      return title;
    }
    const normalized = title.replace(/\.md$/i, "");
    const files = this.app.vault.getFiles();
    for (const candidate of files) {
      if (candidate.basename === normalized) {
        return candidate.path;
      }
    }
    return undefined;
  }

  private async openSource(source: SourceItem, highlight: boolean) {
    if (source.path) {
      const file = this.app.vault.getAbstractFileByPath(source.path);
      if (file instanceof TFile) {
        const leaf = this.app.workspace.getLeaf(true);
        await leaf.openFile(file);
        if (highlight && source.text) {
          const view = leaf.view;
          if (view instanceof MarkdownView && view.editor) {
            await this.highlightSnippet(view.editor, source.text, 6);
          }
        }
        return;
      }
    }
    if (source.uri) {
      if (source.uri.startsWith("obsidian://")) {
        window.open(source.uri, "_blank");
        return;
      }
      window.open(source.uri, "_blank");
    }
  }

  private async highlightSnippet(editor: Editor, snippet: string, minLength: number) {
    const content = editor.getValue();
    const normalized = snippet.trim();
    if (!normalized) return;
    let index = content.indexOf(normalized);
    if (index === -1) {
      index = this.findApproximateMatch(content, normalized, minLength);
      if (index === -1) return;
    }
    const from = editor.offsetToPos(index);
    const to = editor.offsetToPos(index + normalized.length);
    editor.setSelection(from, to);
    editor.scrollIntoView({ from, to }, true);
  }

  private findApproximateMatch(text: string, snippet: string, minLength: number): number {
    const cleanSnippet = snippet.replace(/\s+/g, " ").trim();
    if (cleanSnippet.length < minLength) return -1;
    const tokens = cleanSnippet.split(" ").filter((token) => token.length >= minLength);
    for (const token of tokens) {
      const index = text.indexOf(token);
      if (index !== -1) {
        return index;
      }
    }
    return -1;
  }
}
