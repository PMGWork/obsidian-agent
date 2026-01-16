import { requestUrl, RequestUrlParam } from "obsidian";

// ファイル検索ストア
type FileSearchStore = {
  name?: string;
  displayName?: string;
};

// アップロード操作の結果
type UploadOperation = {
  name?: string;
  done?: boolean;
  error?: { message?: string };
  response?: unknown;
};

// 生成結果
type GenerateContentResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string; thought?: boolean }> };
    groundingMetadata?: GroundingMetadata;
    grounding_metadata?: GroundingMetadata;
  }>;
};

// メタデータ
export type GroundingMetadata = {
  groundingChunks?: Array<Record<string, unknown>>;
  groundingSupports?: Array<Record<string, unknown>>;
};

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const UPLOAD_BASE_URL = "https://generativelanguage.googleapis.com/upload/v1beta";

import { ChatEntry } from "../types";

// クライアント
export class GeminiClient {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  // ファイル検索ストアの作成
  async createFileSearchStore(displayName: string): Promise<FileSearchStore> {
    const response = await this.request(`${BASE_URL}/fileSearchStores`, {
      method: "POST",
      body: JSON.stringify({ displayName }),
    });
    return response as FileSearchStore;
  }

  // ファイル検索ストアの削除
  async deleteFileSearchStore(name: string, force = true): Promise<void> {
    const url = new URL(`${BASE_URL}/${name}`);
    if (force) {
      url.searchParams.set("force", "true");
    }
    await this.request(url.toString(), { method: "DELETE" });
  }

  // ファイル検索ストアへのアップロード
  async uploadMarkdownToStore(
    storeName: string,
    payload: {
      displayName: string;
      bytes: Uint8Array;
      metadata?: Array<{ key: string; stringValue?: string; numericValue?: number }>;
    },
    signal?: AbortSignal
  ): Promise<UploadOperation> {
    // eslint-disable-next-line no-restricted-globals -- Resumable upload requires special headers not supported by requestUrl
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
          customMetadata: payload.metadata,
        }),
        signal,
      }
    );

    if (!startResponse.ok) {
      throw new Error(`Upload start failed: ${await startResponse.text()}`);
    }

    const uploadUrl = startResponse.headers.get("x-goog-upload-url");
    if (!uploadUrl) {
      throw new Error("Upload URL missing from response.");
    }

    // eslint-disable-next-line no-restricted-globals -- Resumable upload requires special headers not supported by requestUrl
    const uploadResponse = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        "X-Goog-Upload-Command": "upload, finalize",
        "X-Goog-Upload-Offset": "0",
      },
      body: new Blob([payload.bytes.slice().buffer], { type: "text/markdown" }),
      signal,
    });

    if (!uploadResponse.ok) {
      throw new Error(`Upload finalize failed: ${await uploadResponse.text()}`);
    }

    return (await uploadResponse.json()) as UploadOperation;
  }

  // 操作の待機
  async waitForOperation(name: string, timeoutMs = 120000, signal?: AbortSignal): Promise<void> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (signal?.aborted) {
        throw new Error("Indexing cancelled.");
      }
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
    history: ChatEntry[] = [],
    includeThoughts?: boolean
  ): Promise<GenerateContentResponse> {
    const body = this.buildGenerateBody({ model, storeName, question, history, includeThoughts });

    return (await this.request(`${BASE_URL}/models/${model}:generateContent`, {
      method: "POST",
      body,
    })) as GenerateContentResponse;
  }

  async generateContentStream(
    model: string,
    storeName: string,
    question: string,
    onChunk: (response: GenerateContentResponse) => Promise<void> | void,
    history: ChatEntry[] = [],
    includeThoughts?: boolean
  ): Promise<void> {
    const body = this.buildGenerateBody({ model, storeName, question, history, includeThoughts });

    // eslint-disable-next-line no-restricted-globals -- SSE streaming is not supported by requestUrl
    const response = await fetch(
      `${BASE_URL}/models/${model}:streamGenerateContent?alt=sse`,
      {
        method: "POST",
        headers: {
          "x-goog-api-key": this.apiKey,
          "Content-Type": "application/json",
        },
        body,
      }
    );

    if (!response.ok || !response.body) {
      throw new Error(await response.text());
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      const chunk = decoder.decode(value, { stream: true });
      buffer += chunk;

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.replace(/\r$/, "").trim();
        if (!trimmed.startsWith("data:")) {
          continue;
        }
        const jsonText = trimmed.slice(5).trimStart();
        if (!jsonText || jsonText === "[DONE]") {
          continue;
        }
        if (jsonText) {
          try {
            const json = JSON.parse(jsonText) as GenerateContentResponse;
            await onChunk(json);
          } catch (e) {
            console.error("Failed to parse stream chunk", e);
          }
        }
      }
    }
  }

  extractAnswer(response: GenerateContentResponse): {
    text: string;
    grounding?: GroundingMetadata;
    thoughtSummary?: string;
  } {
    const candidate = response.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];
    const thoughtParts: string[] = [];
    const answerParts: string[] = [];
    for (const part of parts) {
      const text = part.text ?? "";
      if (!text) {
        continue;
      }
      if (part.thought) {
        thoughtParts.push(text);
      } else {
        answerParts.push(text);
      }
    }
    const text = answerParts.join("");
    const thoughtSummary = thoughtParts.join("");
    const grounding = candidate?.groundingMetadata ?? candidate?.grounding_metadata;
    return { text, grounding, thoughtSummary: thoughtSummary || undefined };
  }

  private buildGenerateBody({
    model,
    storeName,
    question,
    history,
    includeThoughts,
  }: {
    model: string;
    storeName: string;
    question: string;
    history: ChatEntry[];
    includeThoughts?: boolean;
  }): string {
    const contents = this.buildContents(history, question);
    return JSON.stringify({
      contents,
      tools: [
        {
          fileSearch: {
            fileSearchStoreNames: [storeName],
          },
        },
      ],
      generationConfig: includeThoughts
        ? {
            thinkingConfig: {
              includeThoughts: true,
            },
          }
        : undefined,
    });
  }

  private buildContents(
    history: ChatEntry[],
    question: string
  ): Array<{ role: string; parts: Array<{ text: string }> }> {
    const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];

    for (const entry of history) {
      contents.push({ role: "user", parts: [{ text: entry.question }] });
      contents.push({ role: "model", parts: [{ text: entry.answer }] });
    }
    contents.push({ role: "user", parts: [{ text: question }] });

    return contents;
  }

  private async request(url: string, init: { method: string; body?: string }): Promise<unknown> {
    const params: RequestUrlParam = {
      url,
      method: init.method,
      headers: {
        "x-goog-api-key": this.apiKey,
        "Content-Type": "application/json",
      },
      body: init.body,
      throw: false,
    };
    const response = await requestUrl(params);
    if (response.status >= 400) {
      throw new Error(response.text);
    }
    if (response.status === 204) {
      return {};
    }
    return response.json;
  }

  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  async generateTitle(question: string): Promise<string> {
    const model = "models/gemini-2.5-flash-lite";
    const response = await this.request(`${BASE_URL}/${model}:generateContent`, {
      method: "POST",
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `次の質問を20文字以内で要約しタイトルにしてください:\n${question}`,
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.7,
        },
      }),
    });

    const result = response as GenerateContentResponse;
    const text = result.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    return text.trim().slice(0, 20);
  }
}
