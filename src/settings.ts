import { App, PluginSettingTab, Setting } from "obsidian";
import ObsidianRagPlugin from "./main";

export interface RagSettings {
  apiKey: string;
  model: string;
  storeName: string;
  storeDisplayName: string;
}

export const DEFAULT_SETTINGS: RagSettings = {
  apiKey: "",
  model: "gemini-2.5-flash",
  storeName: "",
  storeDisplayName: "obsidian-vault",
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

    containerEl.createEl("h2", { text: "Gemini RAG settings" });

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
          .setPlaceholder("gemini-2.5-flash")
          .setValue(this.plugin.settings.model)
          .onChange(async (value) => {
            this.plugin.settings.model = value.trim();
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
      .setName("Reset local index state")
      .setDesc("Clears local index tracking. This does not delete remote documents.")
      .addButton((button) =>
        button.setButtonText("Reset").onClick(async () => {
          await this.plugin.resetIndexState();
        })
      );
  }
}
