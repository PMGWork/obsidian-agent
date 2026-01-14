import { App, PluginSettingTab, Setting } from "obsidian";
import ObsidianRagPlugin from "./main";

// 設定のインターフェース
export interface RagSettings {
  apiKey: string;
  model: string;
  storeName: string;
  storeDisplayName: string;
}

// デフォルトの設定
export const DEFAULT_SETTINGS: RagSettings = {
  apiKey: "",
  model: "gemini-2.5-flash",
  storeName: "",
  storeDisplayName: "obsidian-vault",
};

// 設定タブのクラス
export class RagSettingTab extends PluginSettingTab {
  plugin: ObsidianRagPlugin;

  constructor(app: App, plugin: ObsidianRagPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  // 設定画面の表示
  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    
    // タイトル
    new Setting(containerEl)
      .setName("API key")
      .setDesc("Gemini API key. This plugin sends note contents to google for indexing and answers.")
      .addText((text) => {
        text.inputEl.type = "password";
        text
          .setPlaceholder("API key")
          .setValue(this.plugin.settings.apiKey)
          .onChange(async (value) => {
            this.plugin.settings.apiKey = value.trim();
            await this.plugin.saveSettings();
          });
      });

    // モデル選択
    new Setting(containerEl)
      .setName("Model")
      .setDesc("Select the model used for answers.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("gemini-2.5-flash", "Gemini 2.5 flash")
          .addOption("gemini-2.5-pro", "Gemini 2.5 pro")
          .addOption("gemini-3-flash-preview", "Gemini 3 flash preview")
          .addOption("gemini-3-pro-preview", "Gemini 3 pro preview")
          .setValue(this.plugin.settings.model)
          .onChange(async (value) => {
            this.plugin.settings.model = value.trim();
            await this.plugin.saveSettings();
          })
      );

    // ストア名設定
    new Setting(containerEl)
      .setName("File search store name")
      .setDesc("Full resource name")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.storeName)
          .onChange(async (value) => {
            this.plugin.settings.storeName = value.trim();
            await this.plugin.saveSettings();
          })
      );

    // ストア表示名設定
    new Setting(containerEl)
      .setName("Store display name")
      .setDesc("Used when creating a new store from the command palette.")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.storeDisplayName)
          .onChange(async (value) => {
            this.plugin.settings.storeDisplayName = value.trim();
            await this.plugin.saveSettings();
          })
      );

    // ローカルインデックス状態リセットボタン
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
