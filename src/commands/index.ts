import ObsidianRagPlugin from "../main";
import { openRagPanel } from "./open_panel";
import { indexVaultCommand } from "./index_vault";
import { createStoreCommand } from "./create_store";

export function registerCommands(plugin: ObsidianRagPlugin) {
  plugin.addCommand({
    id: "open-gemini-rag-panel",
    name: "Open Gemini RAG panel",
    callback: () => openRagPanel(plugin),
  });

  plugin.addCommand({
    id: "index-vault-to-file-search",
    name: "Index vault to File Search",
    callback: () => indexVaultCommand(plugin),
  });

  plugin.addCommand({
    id: "create-file-search-store",
    name: "Create File Search store",
    callback: () => createStoreCommand(plugin),
  });
}
