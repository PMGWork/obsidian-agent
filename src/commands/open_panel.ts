import ObsidianRagPlugin from "../main";
import { RAG_VIEW_TYPE } from "../ui/rag_view";

import { WorkspaceLeaf } from "obsidian";

export async function openRagPanel(plugin: ObsidianRagPlugin) {
  const { workspace } = plugin.app;
  let leaf: WorkspaceLeaf | null | undefined = workspace.getLeavesOfType(RAG_VIEW_TYPE)[0];
  if (!leaf) {
    leaf = workspace.getRightLeaf(false);
    if (!leaf) {
      leaf = workspace.getLeaf(false);
    }
    await leaf.setViewState({ type: RAG_VIEW_TYPE, active: true });
  }
  workspace.revealLeaf(leaf);
}
