type FileSearchStore = {
  name?: string;
  displayName?: string;
};

type UploadOperation = {
  name?: string;
  done?: boolean;
  error?: { message?: string };
  response?: unknown;
};

type GenerateContentResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    groundingMetadata?: GroundingMetadata;
    grounding_metadata?: GroundingMetadata;
  }>;
};

type GroundingMetadata = {
  groundingChunks?: Array<Record<string, unknown>>;
  groundingSupports?: Array<Record<string, unknown>>;
};

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const UPLOAD_BASE_URL = "https://generativelanguage.googleapis.com/upload/v1beta";

export class GeminiClient {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async createFileSearchStore(displayName: string): Promise<FileSearchStore> {
    const response = await this.request(`${BASE_URL}/fileSearchStores`, {
      method: "POST",
      body: JSON.stringify({ displayName }),
    });
    return response as FileSearchStore;
  }

  async deleteFileSearchStore(name: string, force = true): Promise<void> {
    const url = new URL(`${BASE_URL}/${name}`);
    if (force) {
      url.searchParams.set("force", "true");
    }
    await this.request(url.toString(), { method: "DELETE" });
  }

  async uploadMarkdownToStore(
    storeName: string,
    payload: {
      displayName: string;
      bytes: Uint8Array;
      chunking?: { maxTokensPerChunk: number; maxOverlapTokens: number } | null;
      metadata?: Array<{ key: string; stringValue?: string; numericValue?: number }>;
    }
  ): Promise<UploadOperation> {
    const startResponse = await fetch(
      `${UPLOAD_BASE_URL}/${storeName}:uploadToFileSearchStore`,
      {
        method: "POST",
        headers: {
          "x-goog-api-key": this.apiKey,
          "X-Goog-Upload-Protocol": "resumable",
          "X-Goog-Upload-Command": "start",
          "X-Goog-Upload-Header-Content-Length": String(payload.bytes.byteLength),
          "X-Goog-Upload-Header-Content-Type": "text/markdown",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          displayName: payload.displayName,
          mimeType: "text/markdown",
          chunkingConfig: payload.chunking
            ? {
                whiteSpaceConfig: {
                  maxTokensPerChunk: payload.chunking.maxTokensPerChunk,
                  maxOverlapTokens: payload.chunking.maxOverlapTokens,
                },
              }
            : undefined,
          customMetadata: payload.metadata,
        }),
      }
    );

    if (!startResponse.ok) {
      throw new Error(`Upload start failed: ${await startResponse.text()}`);
    }

    const uploadUrl = startResponse.headers.get("x-goog-upload-url");
    if (!uploadUrl) {
      throw new Error("Upload URL missing from response.");
    }

    const uploadResponse = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        "X-Goog-Upload-Command": "upload, finalize",
        "X-Goog-Upload-Offset": "0",
      },
      body: payload.bytes,
    });

    if (!uploadResponse.ok) {
      throw new Error(`Upload finalize failed: ${await uploadResponse.text()}`);
    }

    return (await uploadResponse.json()) as UploadOperation;
  }

  async waitForOperation(name: string, timeoutMs = 120000): Promise<void> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const operation = (await this.request(`${BASE_URL}/${name}`, {
        method: "GET",
      })) as UploadOperation;
      if (operation.done) {
        if (operation.error?.message) {
          throw new Error(operation.error.message);
        }
        return;
      }
      await this.delay(1000);
    }
    throw new Error("Indexing timed out.");
  }

  async generateContent(
    model: string,
    storeName: string,
    question: string,
    metadataFilter?: string
  ): Promise<GenerateContentResponse> {
    return (await this.request(`${BASE_URL}/models/${model}:generateContent`, {
      method: "POST",
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: question }] }],
        tools: [
          {
            fileSearch: {
              fileSearchStoreNames: [storeName],
              metadataFilter: metadataFilter || undefined,
            },
          },
        ],
      }),
    })) as GenerateContentResponse;
  }

  extractAnswer(response: GenerateContentResponse): {
    text: string;
    grounding?: GroundingMetadata;
  } {
    const candidate = response.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];
    const text = parts.map((part) => part.text ?? "").join("");
    const grounding = candidate?.groundingMetadata ?? candidate?.grounding_metadata;
    return { text, grounding };
  }

  private async request(url: string, init: RequestInit): Promise<unknown> {
    const response = await fetch(url, {
      ...init,
      headers: {
        "x-goog-api-key": this.apiKey,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    if (!response.ok) {
      throw new Error(await response.text());
    }
    if (response.status === 204) {
      return {};
    }
    return response.json();
  }

  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }
}
