import ObsidianRagPlugin from "../main";
import { RAG_VIEW_TYPE, RagView } from "../ui/rag_view";
import { openRagPanel } from "./open_panel";

export async function newChatCommand(plugin: ObsidianRagPlugin) {
  await openRagPanel(plugin);
  const leaves = plugin.app.workspace.getLeavesOfType(RAG_VIEW_TYPE);
  if (leaves.length === 0) {
    plugin.history = [];
    await plugin.saveSettings();
    return;
  }
  for (const leaf of leaves) {
    const view = leaf.view;
    if (view instanceof RagView) {
      await view.clearChat();
    }
  }
}
