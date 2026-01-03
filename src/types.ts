export type IndexState = {
  version: number;
  files: Record<string, { mtime: number }>;
};

export const DEFAULT_INDEX_STATE: IndexState = {
  version: 1,
  files: {},
};
