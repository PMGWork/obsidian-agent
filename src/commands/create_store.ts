import { Notice } from "obsidian";
import ObsidianRagPlugin from "../main";
import { GeminiClient } from "../services/gemini";
import { confirmAction } from "../ui/confirm_modal";

// Storeを作成するコマンド
export async function createStoreCommand(plugin: ObsidianRagPlugin) {
  const apiKey = plugin.settings.apiKey;
  if (!apiKey) {
    new Notice("API key is not set.");
    return;
  }

  const displayName = plugin.settings.storeDisplayName || "obsidian-vault";
  const client = new GeminiClient(apiKey);
  try {
    if (plugin.settings.storeName) {
      const confirmed = await confirmAction(plugin.app, {
        title: "Delete existing store?",
        message:
          "This deletes the current File Search store and its remote documents. This cannot be undone.",
        confirmText: "Delete",
        cancelText: "Cancel",
      });
      if (!confirmed) {
        plugin.setStatus("");
        return;
      }
      plugin.setStatus("Deleting existing File Search store...");
      await client.deleteFileSearchStore(plugin.settings.storeName, true);
    }
    plugin.setStatus("Creating File Search store...");
    const store = await client.createFileSearchStore(displayName);
    plugin.settings.storeName = store.name ?? "";
    await plugin.resetIndexStateForStore(plugin.settings.storeName);
    await plugin.saveSettings();
    new Notice(`Store created: ${store.name ?? "unknown"}`);
  } catch (error) {
    console.error(error);
    new Notice("Failed to create store. Check console for details.");
  } finally {
    plugin.setStatus("");
  }
}
