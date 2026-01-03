import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
import ObsidianRagPlugin from "../main";
import { GeminiClient } from "../services/gemini";
import { indexVaultCommand } from "../commands/index_vault";
import { createStoreCommand } from "../commands/create_store";

export const RAG_VIEW_TYPE = "gemini-file-search-rag-view";

type SourceItem = {
  label: string;
  detail?: string;
};

export class RagView extends ItemView {
  private plugin: ObsidianRagPlugin;
  private cleanupStatus?: () => void;
  private statusEl?: HTMLElement;
  private answerEl?: HTMLElement;
  private sourcesEl?: HTMLElement;

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
    header.createEl("h2", { text: "Gemini RAG" });
    this.statusEl = header.createEl("div", { cls: "gemini-rag-status" });

    const controls = contentEl.createEl("div", { cls: "gemini-rag-controls" });
    const input = controls.createEl("textarea", {
      cls: "gemini-rag-input",
      attr: { rows: "4", placeholder: "Ask something about your notes..." },
    });

    const buttons = controls.createEl("div", { cls: "gemini-rag-buttons" });
    const askButton = buttons.createEl("button", { text: "Ask" });
    const indexButton = buttons.createEl("button", { text: "Index vault" });
    const storeButton = buttons.createEl("button", { text: "Create store" });

    askButton.addEventListener("click", async () => {
      const question = input.value.trim();
      if (!question) {
        return;
      }
      await this.ask(question);
    });

    indexButton.addEventListener("click", async () => {
      await indexVaultCommand(this.plugin);
    });

    storeButton.addEventListener("click", async () => {
      await createStoreCommand(this.plugin);
    });

    this.answerEl = contentEl.createEl("div", { cls: "gemini-rag-answer" });
    this.sourcesEl = contentEl.createEl("div", { cls: "gemini-rag-sources" });
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
      if (this.answerEl) this.answerEl.setText("");
      if (this.sourcesEl) this.sourcesEl.setText("");

      const response = await client.generateContent(model, storeName, question);
      const { text, grounding } = client.extractAnswer(response);
      if (this.answerEl) {
        this.answerEl.createEl("h3", { text: "Answer" });
        this.answerEl.createEl("div", { text });
      }

      const sources = this.extractSources(grounding);
      if (this.sourcesEl) {
        this.sourcesEl.createEl("h3", { text: "Sources" });
        if (sources.length === 0) {
          this.sourcesEl.createEl("div", { text: "No sources returned." });
        } else {
          const list = this.sourcesEl.createEl("ol");
          for (const source of sources) {
            const item = list.createEl("li");
            item.createEl("div", { text: source.label });
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
      return { label, detail };
    });
  }
}
