import ObsidianRagPlugin from "../main";
import { openRagPanel } from "./open_panel";
import { indexVaultCommand } from "./index_vault";
import { createStoreCommand } from "./create_store";
import { newChatCommand } from "./new_chat";

// コマンドを登録する
export function registerCommands(plugin: ObsidianRagPlugin) {
  plugin.addCommand({
    id: "open-gemini-rag-panel",
    name: "Open panel",
    callback: () => openRagPanel(plugin),
  });

  plugin.addCommand({
    id: "new-chat",
    name: "New chat",
    callback: () => newChatCommand(plugin),
  });

  plugin.addCommand({
    id: "index-vault-to-file-search",
    name: "Index vault to file search",
    callback: () => indexVaultCommand(plugin),
  });

  plugin.addCommand({
    id: "create-file-search-store",
    name: "Create file search store",
    callback: () => createStoreCommand(plugin),
  });
}
