// インデックス処理の進捗管理

export type IndexStatus =
  | "idle"
  | "running"
  | "cancelling"
  | "cancelled"
  | "completed"
  | "error";

export type IndexFailure = {
  path: string;
  error: string;
};

export type IndexProgressState = {
  status: IndexStatus;
  total: number;
  indexed: number;
  skipped: number;
  failed: number;
  currentFile?: string;
  failures: IndexFailure[];
};

export class IndexingController {
  private state: IndexProgressState = {
    status: "idle",
    total: 0,
    indexed: 0,
    skipped: 0,
    failed: 0,
    failures: [],
  };
  private listeners = new Set<(state: IndexProgressState) => void>();
  private cancelRequested = false;

  onChange(listener: (state: IndexProgressState) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  snapshot(): IndexProgressState {
    return {
      ...this.state,
      failures: [...this.state.failures],
    };
  }

  isRunning(): boolean {
    return ["running", "cancelling"].includes(this.state.status);
  }

  isCancelled(): boolean {
    return this.cancelRequested;
  }

  start(total: number): void {
    this.cancelRequested = false;
    this.state = {
      status: "running",
      total,
      indexed: 0,
      skipped: 0,
      failed: 0,
      currentFile: undefined,
      failures: [],
    };
    this.notify();
  }

  setCurrentFile(path?: string): void {
    this.state = {
      ...this.state,
      currentFile: path,
    };
    this.notify();
  }

  markIndexed(): void {
    this.state = {
      ...this.state,
      indexed: this.state.indexed + 1,
    };
    this.notify();
  }

  markSkipped(): void {
    this.state = {
      ...this.state,
      skipped: this.state.skipped + 1,
    };
    this.notify();
  }

  markFailed(path: string, error: string): void {
    this.state = {
      ...this.state,
      failed: this.state.failed + 1,
      failures: [...this.state.failures, { path, error }],
    };
    this.notify();
  }

  requestCancel(): boolean {
    if (!this.isRunning()) {
      return false;
    }
    this.cancelRequested = true;
    this.setStatus("cancelling");
    return true;
  }

  finishCompleted(): void {
    this.cancelRequested = false;
    this.setStatus("completed");
  }

  finishCancelled(): void {
    this.cancelRequested = false;
    this.setStatus("cancelled");
  }

  finishError(): void {
    this.cancelRequested = false;
    this.setStatus("error");
  }

  private setStatus(status: IndexStatus): void {
    this.state = {
      ...this.state,
      status,
      currentFile:
        status === "completed" || status === "cancelled" || status === "error"
          ? undefined
          : this.state.currentFile,
    };
    this.notify();
  }

  private notify(): void {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}
