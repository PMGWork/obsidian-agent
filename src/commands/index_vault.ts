import { Notice, TFile } from "obsidian";
import ObsidianRagPlugin from "../main";
import { GeminiClient } from "../services/gemini";
import { IndexProgressState } from "../services/indexing";

function getMtime(file: TFile): number {
  return file.stat?.mtime ?? 0;
}

function buildSummary(state: IndexProgressState): string {
  return `Indexed ${state.indexed}, skipped ${state.skipped}, failed ${state.failed}.`;
}

function buildStatusMessage(state: IndexProgressState): string {
  const summary = `Indexed ${state.indexed}/${state.total} (skipped ${state.skipped}, failed ${state.failed})`;
  switch (state.status) {
    case "running":
      return `Indexing ${summary}`;
    case "cancelling":
      return "Cancelling index...";
    case "completed":
      return `Index complete. ${buildSummary(state)}`;
    case "cancelled":
      return `Index cancelled. ${buildSummary(state)}`;
    case "error":
      return "Index failed. Check console for details.";
    default:
      return "";
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error);
}

// Vaultをインデックスするコマンド
export async function indexVaultCommand(plugin: ObsidianRagPlugin) {
  const apiKey = plugin.settings.apiKey;
  const storeName = plugin.settings.storeName;
  if (!apiKey) {
    new Notice("API key is not set.");
    return;
  }
  if (!storeName) {
    new Notice("File search store name is not set.");
    return;
  }

  const indexer = plugin.indexing;
  if (indexer.isRunning()) {
    new Notice("Indexing already in progress.");
    return;
  }

  if (plugin.indexState.storeName !== storeName) {
    await plugin.resetIndexStateForStore(storeName);
  }

  const files = plugin.app.vault.getMarkdownFiles();
  if (files.length === 0) {
    new Notice("No markdown files found.");
    return;
  }

  const client = new GeminiClient(apiKey);
  indexer.start(files.length);
  const unsubscribe = indexer.onChange((state) => {
    plugin.setStatus(buildStatusMessage(state));
  });

  try {
    for (const file of files) {
      if (indexer.isCancelled()) {
        break;
      }

      indexer.setCurrentFile(file.path);
      const mtime = getMtime(file);
      const lastIndexed = plugin.indexState.files[file.path]?.mtime ?? 0;
      if (mtime <= lastIndexed) {
        indexer.markSkipped();
        indexer.setCurrentFile(undefined);
        continue;
      }

      try {
        const operation = await indexFile(plugin, client, storeName, file, mtime);
        if (operation?.name) {
          await client.waitForOperation(operation.name);
        }
        plugin.indexState.files[file.path] = { mtime };
        indexer.markIndexed();
        await plugin.saveSettings();
      } catch (error) {
        console.error(error);
        indexer.markFailed(file.path, getErrorMessage(error));
        new Notice(`Failed to index ${file.path}`);
      } finally {
        indexer.setCurrentFile(undefined);
      }
    }

    const finalState = indexer.snapshot();
    if (indexer.isCancelled()) {
      indexer.finishCancelled();
      new Notice(`Index cancelled. ${buildSummary(finalState)}`);
    } else {
      indexer.finishCompleted();
      new Notice(`Index complete. ${buildSummary(finalState)}`);
    }
  } catch (error) {
    console.error(error);
    indexer.finishError();
    new Notice("Index failed. Check console for details.");
  } finally {
    plugin.setStatus(buildStatusMessage(indexer.snapshot()));
    unsubscribe();
  }
}

// ファイルをインデックスする
async function indexFile(
  plugin: ObsidianRagPlugin,
  client: GeminiClient,
  storeName: string,
  file: TFile,
  mtime: number
) {
  const content = await plugin.app.vault.read(file);
  const bytes = new TextEncoder().encode(content);
  if (bytes.byteLength > 100 * 1024 * 1024) {
    throw new Error(`File too large: ${file.path}`);
  }

  const metadata = [
    { key: "vault", stringValue: plugin.app.vault.getName() },
    { key: "path", stringValue: file.path },
    { key: "mtime", numericValue: mtime },
  ];

  const operation = await client.uploadMarkdownToStore(storeName, {
    displayName: file.path,
    bytes,
    metadata,
  });
  return operation;
}
