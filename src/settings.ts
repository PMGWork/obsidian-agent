import { App, PluginSettingTab, Setting } from "obsidian";
import ObsidianRagPlugin from "./main";

export interface RagSettings {
  apiKey: string;
  model: string;
  storeName: string;
  storeDisplayName: string;
  metadataFilter: string;
  chunkingEnabled: boolean;
  maxTokensPerChunk: number;
  maxOverlapTokens: number;
  showReasoningSummary: boolean;
  reasoningTitle: string;
}

export const DEFAULT_SETTINGS: RagSettings = {
  apiKey: "",
  model: "gemini-3-flash-preview",
  storeName: "",
  storeDisplayName: "obsidian-vault",
  metadataFilter: "",
  chunkingEnabled: true,
  maxTokensPerChunk: 200,
  maxOverlapTokens: 20,
  showReasoningSummary: false,
  reasoningTitle: "推論の要約",
};

export class RagSettingTab extends PluginSettingTab {
  plugin: ObsidianRagPlugin;

  constructor(app: App, plugin: ObsidianRagPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Obsidian Agent settings" });

    new Setting(containerEl)
      .setName("API key")
      .setDesc("Gemini API key. This plugin sends note contents to Google for indexing and answers.")
      .addText((text) => {
        text.inputEl.type = "password";
        text
          .setPlaceholder("AI Studio API key")
          .setValue(this.plugin.settings.apiKey)
          .onChange(async (value) => {
            this.plugin.settings.apiKey = value.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Model")
      .setDesc("Model used for answering queries.")
      .addText((text) =>
        text
          .setPlaceholder("gemini-3-flash-preview")
          .setValue(this.plugin.settings.model)
          .onChange(async (value) => {
            this.plugin.settings.model = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Show thought summaries")
      .setDesc("Adds a short thought summary section (no detailed steps).")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.showReasoningSummary).onChange(async (value) => {
          this.plugin.settings.showReasoningSummary = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Thought title")
      .setDesc("Heading used for the thought summary section.")
      .addText((text) =>
        text
          .setPlaceholder("推論の要約")
          .setValue(this.plugin.settings.reasoningTitle)
          .onChange(async (value) => {
            this.plugin.settings.reasoningTitle = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("File Search store name")
      .setDesc("Full resource name, for example: fileSearchStores/1234567890")
      .addText((text) =>
        text
          .setPlaceholder("fileSearchStores/...")
          .setValue(this.plugin.settings.storeName)
          .onChange(async (value) => {
            this.plugin.settings.storeName = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Store display name")
      .setDesc("Used when creating a new store from the command palette.")
      .addText((text) =>
        text
          .setPlaceholder("obsidian-vault")
          .setValue(this.plugin.settings.storeDisplayName)
          .onChange(async (value) => {
            this.plugin.settings.storeDisplayName = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Metadata filter")
      .setDesc("Optional: filter sources by metadata (AIP-160 syntax). Example: author=\"Alice\"")
      .addText((text) =>
        text
          .setPlaceholder('author="Alice"')
          .setValue(this.plugin.settings.metadataFilter)
          .onChange(async (value) => {
            this.plugin.settings.metadataFilter = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Chunking config")
      .setDesc("Use custom chunk sizes for File Search indexing (white-space chunking).")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.chunkingEnabled).onChange(async (value) => {
          this.plugin.settings.chunkingEnabled = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Max tokens per chunk")
      .setDesc("Used when chunking is enabled. Default is 200.")
      .addText((text) =>
        text
          .setPlaceholder("200")
          .setValue(String(this.plugin.settings.maxTokensPerChunk))
          .onChange(async (value) => {
            const parsed = Number.parseInt(value, 10);
            if (!Number.isNaN(parsed) && parsed > 0) {
              this.plugin.settings.maxTokensPerChunk = parsed;
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName("Max overlap tokens")
      .setDesc("Used when chunking is enabled. Default is 20.")
      .addText((text) =>
        text
          .setPlaceholder("20")
          .setValue(String(this.plugin.settings.maxOverlapTokens))
          .onChange(async (value) => {
            const parsed = Number.parseInt(value, 10);
            if (!Number.isNaN(parsed) && parsed >= 0) {
              this.plugin.settings.maxOverlapTokens = parsed;
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName("Reset local index state")
      .setDesc("Clears local index tracking. This does not delete remote documents.")
      .addButton((button) =>
        button.setButtonText("Reset").onClick(async () => {
          await this.plugin.resetIndexState();
        })
      );
  }
}
