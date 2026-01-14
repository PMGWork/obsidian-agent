// インデックスのステータス
export type IndexStatus =
  | "idle"
  | "running"
  | "cancelling"
  | "cancelled"
  | "completed"
  | "error";

// インデックスの失敗情報
export type IndexFailure = {
  path: string;
  error: string;
};

// インデックスの進行状態
export type IndexProgressState = {
  status: IndexStatus;
  total: number;
  indexed: number;
  skipped: number;
  failed: number;
  currentFile?: string;
  failures: IndexFailure[];
};

// インデックス管理クラス
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

  // 状態変更の監視
  onChange(listener: (state: IndexProgressState) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  // 現在の状態のスナップショットを取得
  snapshot(): IndexProgressState {
    return {
      ...this.state,
      failures: [...this.state.failures],
    };
  }

  // インデックスが実行中かどうかを確認
  isRunning(): boolean {
    return ["running", "cancelling"].includes(this.state.status);
  }

  // キャンセルがリクエストされているかどうかを確認
  isCancelled(): boolean {
    return this.cancelRequested;
  }

  // インデックス処理の開始
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

  // 現在処理中のファイルを設定
  setCurrentFile(path?: string): void {
    this.state = {
      ...this.state,
      currentFile: path,
    };
    this.notify();
  }

  // インデックス済みファイル数を更新
  markIndexed(): void {
    this.state = {
      ...this.state,
      indexed: this.state.indexed + 1,
    };
    this.notify();
  }

  // 
  markSkipped(): void {
    this.state = {
      ...this.state,
      skipped: this.state.skipped + 1,
    };
    this.notify();
  }
  
  // インデックス失敗を記録 
  markFailed(path: string, error: string): void {
    this.state = {
      ...this.state,
      failed: this.state.failed + 1,
      failures: [...this.state.failures, { path, error }],
    };
    this.notify();
  }

  // インデックスのキャンセルをリクエスト
  requestCancel(): boolean {
    if (!this.isRunning()) {
      return false;
    }
    this.cancelRequested = true;
    this.setStatus("cancelling");
    return true;
  }

  // インデックス処理を完了状態で終了
  finishCompleted(): void {
    this.cancelRequested = false;
    this.setStatus("completed");
  }

  // インデックス処理をキャンセル状態で終了
  finishCancelled(): void {
    this.cancelRequested = false;
    this.setStatus("cancelled");
  }

  // インデックス処理をエラー状態で終了
  finishError(): void {
    this.cancelRequested = false;
    this.setStatus("error");
  }

  // ステータスを設定
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

  // リスナーに状態変更を通知
  private notify(): void {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}
