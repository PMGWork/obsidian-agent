import { Notice, TFile } from "obsidian";
import ObsidianRagPlugin from "../main";
import { GeminiClient } from "../services/gemini";

type IndexProgress = {
  total: number;
  indexed: number;
  skipped: number;
  uploaded: number;
};

function getMtime(file: TFile): number {
  return file.stat?.mtime ?? 0;
}

export async function indexVaultCommand(plugin: ObsidianRagPlugin) {
  const apiKey = plugin.settings.apiKey;
  const storeName = plugin.settings.storeName;
  if (!apiKey) {
    new Notice("API key is not set.");
    return;
  }
  if (!storeName) {
    new Notice("File Search store name is not set.");
    return;
  }

  const files = plugin.app.vault.getMarkdownFiles();
  const client = new GeminiClient(apiKey);
  const progress: IndexProgress = {
    total: files.length,
    indexed: 0,
    skipped: 0,
    uploaded: 0,
  };

  plugin.setStatus(`Indexing ${files.length} files...`);

  const targets = files
    .map((file) => ({ file, mtime: getMtime(file) }))
    .filter(({ file, mtime }) => {
      const lastIndexed = plugin.indexState.files[file.path]?.mtime ?? 0;
      if (mtime <= lastIndexed) {
        progress.skipped += 1;
        return false;
      }
      return true;
    });

  const concurrency = 4;
  const results = await runWithConcurrency(concurrency, targets, async ({ file, mtime }) => {
    try {
      const operation = await indexFile(plugin, client, storeName, file, mtime);
      progress.uploaded += 1;
      plugin.setStatus(
        `Uploaded ${progress.uploaded}/${progress.total} (skipped ${progress.skipped})`
      );
      return { file, mtime, operationName: operation?.name, ok: true };
    } catch (error) {
      console.error(error);
      new Notice(`Failed to upload ${file.path}`);
      return { file, mtime, operationName: undefined, ok: false };
    }
  });

  const operations = results.filter((result) => result.operationName && result.ok);
  if (operations.length > 0) {
    plugin.setStatus(`Finalizing ${operations.length} uploads...`);
  }

  for (const entry of operations) {
    if (!entry.operationName) continue;
    try {
      await client.waitForOperation(entry.operationName);
      plugin.indexState.files[entry.file.path] = { mtime: entry.mtime };
      progress.indexed += 1;
      await plugin.saveSettings();
    } catch (error) {
      console.error(error);
      new Notice(`Failed to finalize ${entry.file.path}`);
    }
  }

  plugin.setStatus(
    `Index complete. Indexed ${progress.indexed}, uploaded ${progress.uploaded}, skipped ${progress.skipped}.`
  );
  new Notice(
    `Index complete. Indexed ${progress.indexed}, uploaded ${progress.uploaded}, skipped ${progress.skipped}.`
  );
}

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
  const chunking = plugin.settings.chunkingEnabled
    ? {
        maxTokensPerChunk: plugin.settings.maxTokensPerChunk,
        maxOverlapTokens: plugin.settings.maxOverlapTokens,
      }
    : null;

  const metadata = [
    { key: "vault", stringValue: plugin.app.vault.getName() },
    { key: "path", stringValue: file.path },
    { key: "mtime", numericValue: mtime },
  ];

  const operation = await client.uploadMarkdownToStore(storeName, {
    displayName: file.path,
    bytes,
    chunking,
    metadata,
  });
  return operation;
}

async function runWithConcurrency<T, R>(
  limit: number,
  items: T[],
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  let index = 0;

  const runWorker = async () => {
    while (index < items.length) {
      const currentIndex = index;
      index += 1;
      const item = items[currentIndex] as T;
      results[currentIndex] = await worker(item);
    }
  };

  const runners = Array.from({ length: Math.min(limit, items.length) }, () => runWorker());
  await Promise.all(runners);
  return results;
}
