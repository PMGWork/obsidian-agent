export type IndexState = {
  version: number;
  files: Record<string, { mtime: number }>;
  storeName?: string;
};

export const DEFAULT_INDEX_STATE: IndexState = {
  version: 1,
  files: {},
};

export type ChatEntry = {
  id: string;
  timestamp: number;
  question: string;
  answer: string;
};
