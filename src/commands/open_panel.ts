import ObsidianRagPlugin from "../main";
import { RAG_VIEW_TYPE } from "../ui/chat_view";

// パネルを開くコマンド
export async function openRagPanel(plugin: ObsidianRagPlugin) {
  const { workspace } = plugin.app;
  let leaf: import("obsidian").WorkspaceLeaf | null = workspace.getLeavesOfType(RAG_VIEW_TYPE)[0] ?? null;
  if (!leaf) {
    leaf = workspace.getRightLeaf(false);
    if (!leaf) {
      leaf = workspace.getLeaf(false);
    }
    await leaf.setViewState({ type: RAG_VIEW_TYPE, active: true });
  }
  await workspace.revealLeaf(leaf);
}
