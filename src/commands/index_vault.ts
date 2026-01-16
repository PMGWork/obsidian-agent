import { Notice, TFile } from "obsidian";
import ObsidianRagPlugin from "../main";
import { GeminiClient } from "../services/gemini";
import { IndexProgressState } from "../services/indexing";

// ファイルの最終更新時刻を取得する
function getMtime(file: TFile): number {
  return file.stat?.mtime ?? 0;
}

// インデックス進捗のサマリーを生成する
function buildSummary(state: IndexProgressState): string {
  return `Indexed ${state.indexed}, skipped ${state.skipped}, failed ${state.failed}.`;
}

// インデックス進捗のステータスメッセージを生成する
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

// エラーメッセージを取得する
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
    new Notice("No Markdown files found.");
    return;
  }

  const client = new GeminiClient(apiKey);
  const abortController = new AbortController();
  indexer.start(files.length);
  const unsubscribe = indexer.onChange((state) => {
    plugin.setStatus(buildStatusMessage(state));
  });

  const concurrency = 5;
  const saveBatchSize = 20;
  let pendingSaveCount = 0;
  let saveInFlight = Promise.resolve();

  const scheduleSave = async (force = false) => {
    if (!force && pendingSaveCount < saveBatchSize) {
      return;
    }
    pendingSaveCount = 0;
    saveInFlight = saveInFlight.then(() => plugin.saveSettings());
    await saveInFlight;
  };

  const abortIfCancelled = () => {
    if (indexer.isCancelled() && !abortController.signal.aborted) {
      abortController.abort();
    }
  };
  const cancelWatcher = window.setInterval(abortIfCancelled, 250);

  const processFile = async (file: TFile) => {
    if (indexer.isCancelled()) {
      abortIfCancelled();
      return;
    }

    indexer.setCurrentFile(file.path);
    const mtime = getMtime(file);
    const lastIndexed = plugin.indexState.files[file.path]?.mtime ?? 0;
    if (mtime <= lastIndexed) {
      indexer.markSkipped();
      return;
    }

    try {
      abortIfCancelled();
      const operation = await indexFile(
        plugin,
        client,
        storeName,
        file,
        mtime,
        abortController.signal
      );
      abortIfCancelled();
      if (indexer.isCancelled()) {
        return;
      }
      if (!operation) {
        plugin.indexState.files[file.path] = { mtime };
        indexer.markSkipped();
        pendingSaveCount += 1;
        await scheduleSave();
        return;
      }
      if (operation?.name) {
        await client.waitForOperation(operation.name, 120000, abortController.signal);
        abortIfCancelled();
        if (indexer.isCancelled()) {
          return;
        }
      }
      plugin.indexState.files[file.path] = { mtime };
      indexer.markIndexed();
      pendingSaveCount += 1;
      await scheduleSave();
    } catch (error) {
      if (indexer.isCancelled() || abortController.signal.aborted) {
        return;
      }
      console.error(error);
      indexer.markFailed(file.path, getErrorMessage(error));
      new Notice(`Failed to index ${file.path}`);
    }
  };

  try {
    const queue = [...files];
    const inFlight = new Set<Promise<void>>();

    while (queue.length > 0 && !indexer.isCancelled()) {
      while (inFlight.size < concurrency && queue.length > 0 && !indexer.isCancelled()) {
        const file = queue.shift();
        if (!file) {
          break;
        }
        const task = processFile(file)
          .catch((error) => {
            console.error(error);
          })
          .finally(() => {
            const current = indexer.snapshot().currentFile;
            if (current === file.path) {
              indexer.setCurrentFile(undefined);
            }
          });
        inFlight.add(task);
        void task.finally(() => {
          inFlight.delete(task);
        });
      }

      if (inFlight.size > 0) {
        await Promise.race(inFlight);
        abortIfCancelled();
      }
    }

    if (inFlight.size > 0) {
      await Promise.allSettled(inFlight);
    }

    await scheduleSave(true);

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
    window.clearInterval(cancelWatcher);
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
  mtime: number,
  signal?: AbortSignal
) {
  const content = await plugin.app.vault.read(file);
  if (content.trim().length === 0) {
    return null;
  }
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
  }, signal);
  return operation;
}
