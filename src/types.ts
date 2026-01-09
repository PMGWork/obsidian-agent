// インデックス
export type IndexState = {
  version: number;
  files: Record<string, { mtime: number }>;
  storeName?: string;
};

// インデックスのデフォルト値
export const DEFAULT_INDEX_STATE: IndexState = {
  version: 1,
  files: {},
};

// 質問応答履歴
export type ChatEntry = {
  id: string;
  timestamp: number;
  question: string;
  answer: string;
};
