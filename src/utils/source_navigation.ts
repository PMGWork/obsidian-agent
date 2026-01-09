// ソースファイルのナビゲーションユーティリティ

import { App, TFile } from "obsidian";
import { SourceItem } from "./grounding";

// Vault内のファイルパスを解決する
export function resolveVaultPath(app: App, title?: string): string | undefined {
  if (!title) {
    return undefined;
  }
  const file = app.vault.getAbstractFileByPath(title);
  if (file) {
    return title;
  }
  const normalized = title.replace(/\.md$/i, "");
  const files = app.vault.getFiles();
  for (const candidate of files) {
    if (candidate.basename === normalized) {
      return candidate.path;
    }
  }
  return undefined;
}

// ソースファイルを開く
export async function openSource(
  app: App,
  source: SourceItem
): Promise<void> {
  if (source.path) {
    const file = app.vault.getAbstractFileByPath(source.path);
    if (file instanceof TFile) {
      const leaf = app.workspace.getLeaf(true);
      await leaf.openFile(file);
      return;
    }
  }
  if (source.uri) {
    window.open(source.uri, "_blank");
  }
}
