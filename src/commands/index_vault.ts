import { Notice, TFile } from "obsidian";
import ObsidianRagPlugin from "../main";
import { GeminiClient } from "../services/gemini";

type IndexProgress = {
  total: number;
  indexed: number;
  skipped: number;
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
  };

  plugin.setStatus(`Indexing ${files.length} files...`);

  for (const file of files) {
    const mtime = getMtime(file);
    const lastIndexed = plugin.indexState.files[file.path]?.mtime ?? 0;
    if (mtime <= lastIndexed) {
      progress.skipped += 1;
      continue;
    }

    try {
      await indexFile(plugin, client, storeName, file, mtime);
      plugin.indexState.files[file.path] = { mtime };
      progress.indexed += 1;
      plugin.setStatus(`Indexed ${progress.indexed}/${progress.total} (skipped ${progress.skipped})`);
      await plugin.saveSettings();
    } catch (error) {
      console.error(error);
      new Notice(`Failed to index ${file.path}`);
    }
  }

  plugin.setStatus(`Index complete. Indexed ${progress.indexed}, skipped ${progress.skipped}.`);
  new Notice(`Index complete. Indexed ${progress.indexed}, skipped ${progress.skipped}.`);
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
  if (operation?.name) {
    await client.waitForOperation(operation.name);
  }
}
