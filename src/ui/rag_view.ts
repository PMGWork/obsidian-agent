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
  private answerEl?: HTMLElement;
  private answerBodyEl?: HTMLElement;
  private sourcesEl?: HTMLElement;
  private hintEl?: HTMLElement;
  private sourcesMap = new Map<number, SourceItem>();

  constructor(leaf: WorkspaceLeaf, plugin: ObsidianRagPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return RAG_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Gemini RAG";
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
    titleWrap.createEl("h2", { text: "Gemini RAG" });
    this.statusEl = header.createEl("div", { cls: "gemini-rag-status-pill" });

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

    const answerSection = contentEl.createEl("div", { cls: "gemini-rag-section" });
    answerSection.createEl("h3", { text: "Answer" });
    this.answerEl = answerSection.createEl("div", { cls: "gemini-rag-answer" });
    this.answerBodyEl = this.answerEl.createEl("div", { cls: "gemini-rag-answer-body" });
    this.answerBodyEl.addEventListener("click", (event) => {
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
        void this.openSource(source, true);
      }
    });

    const sourcesSection = contentEl.createEl("div", { cls: "gemini-rag-section" });
    sourcesSection.createEl("h3", { text: "Sources" });
    this.sourcesEl = sourcesSection.createEl("div", { cls: "gemini-rag-sources" });
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
      if (this.answerBodyEl) this.answerBodyEl.setText("");
      if (this.sourcesEl) this.sourcesEl.setText("");

      const response = await client.generateContent(
        model,
        storeName,
        question,
        this.plugin.settings.metadataFilter || undefined
      );
      const { text, grounding } = client.extractAnswer(response);
      const sources = this.extractSources(grounding);
      this.sourcesMap.clear();
      for (const source of sources) {
        this.sourcesMap.set(source.index, source);
      }
      const annotatedText = this.annotateAnswer(text, grounding, sources);
      if (this.answerBodyEl) {
        this.answerBodyEl.empty();
        await MarkdownRenderer.renderMarkdown(
          annotatedText,
          this.answerBodyEl,
          this.plugin.app.vault.getRoot().path,
          this
        );
      }

      if (this.sourcesEl) {
        if (sources.length === 0) {
          this.sourcesEl.createEl("div", { text: "No sources returned." });
        } else {
          const list = this.sourcesEl.createEl("ol");
          for (const source of sources) {
            const item = list.createEl("li");
            const link = item.createEl("a", {
              text: `[${source.index}] ${source.label}`,
              cls: "gemini-rag-source-link",
            });
            link.addEventListener("click", (event) => {
              event.preventDefault();
              void this.openSource(source, true);
            });
            if (source.detail) {
              item.createEl("div", { text: source.detail, cls: "gemini-rag-source-detail" });
            }
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
      insertions.push({ pos, marker: ` ${marker}` });
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
    const endChars = [".", "!", "?", "。", "！", "？", "\n"];
    for (let i = Math.max(0, startIndex); i < text.length; i += 1) {
      const char = text.charAt(i);
      if (endChars.includes(char)) {
        return i + 1;
      }
    }
    return text.length;
  }

  private resolveVaultPath(title?: string): string | undefined {
    if (!title) {
      return undefined;
    }
    const file = this.app.vault.getAbstractFileByPath(title);
    if (file) {
      return title;
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
            await this.highlightSnippet(view.editor, source.text);
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

  private async highlightSnippet(editor: Editor, snippet: string) {
    const content = editor.getValue();
    const normalized = snippet.trim();
    if (!normalized) return;
    const index = content.indexOf(normalized);
    if (index === -1) return;
    const from = editor.offsetToPos(index);
    const to = editor.offsetToPos(index + normalized.length);
    editor.setSelection(from, to);
    editor.scrollIntoView({ from, to }, true);
  }
}
