import ObsidianRagPlugin from "../main";
import { RagView, RAG_VIEW_TYPE } from "../ui/chat_view";
import { openRagPanel } from "./open_panel";

// 新しいチャットを開始するコマンド
export async function newChatCommand(plugin: ObsidianRagPlugin) {
  await openRagPanel(plugin);
  
  await plugin.createChatSession();
  
  const leaves = plugin.app.workspace.getLeavesOfType(RAG_VIEW_TYPE);
  if (leaves.length === 0) {
    return;
  }
  for (const leaf of leaves) {
    const view = leaf.view;
    if (view instanceof RagView) {
      view.renderHistory();
    }
  }
}
