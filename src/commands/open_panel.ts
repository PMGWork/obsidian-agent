import ObsidianRagPlugin from "../main";
import { RAG_VIEW_TYPE } from "../ui/rag_view";

export async function openRagPanel(plugin: ObsidianRagPlugin) {
  const { workspace } = plugin.app;
  let leaf: import("obsidian").WorkspaceLeaf | undefined = workspace.getLeavesOfType(RAG_VIEW_TYPE)[0];
  if (!leaf) {
    const rightLeaf = workspace.getRightLeaf(false);
    leaf = rightLeaf ?? undefined;
    if (!leaf) {
      leaf = workspace.getLeaf(false);
    }
    await leaf.setViewState({ type: RAG_VIEW_TYPE, active: true });
  }
  workspace.revealLeaf(leaf);
}
