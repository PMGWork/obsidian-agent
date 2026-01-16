import type { IndexProgressState } from "../../services/indexing";

// インデックス進行状況UIクラス
export class IndexProgressUI {
  private root: HTMLElement;
  private summaryEl: HTMLElement;
  private percentEl: HTMLElement;
  private barFillEl: HTMLElement;
  private currentEl: HTMLElement;
  private failuresEl: HTMLElement;
  private indexButton: HTMLButtonElement;
  private shortenPath: (path: string) => string;
  readonly cancelButton: HTMLButtonElement;

  // コンストラクタ
  constructor(
    parent: HTMLElement,
    indexButton: HTMLButtonElement,
    shortenPath: (path: string) => string,
  ) {
    this.indexButton = indexButton;
    this.shortenPath = shortenPath;
    this.root = parent.createEl("div", { cls: "gemini-rag-progress" });
    const progressTop = this.root.createEl("div", { cls: "gemini-rag-progress-top" });
    this.summaryEl = progressTop.createEl("div", { cls: "gemini-rag-progress-summary" });
    this.percentEl = progressTop.createEl("div", { cls: "gemini-rag-progress-percent" });
    const progressBar = this.root.createEl("div", { cls: "gemini-rag-progress-bar" });
    this.barFillEl = progressBar.createEl("div", { cls: "gemini-rag-progress-bar-fill" });
    this.currentEl = this.root.createEl("div", { cls: "gemini-rag-progress-current" });
    this.failuresEl = this.root.createEl("div", { cls: "gemini-rag-progress-failures" });
    const progressActions = this.root.createEl("div", { cls: "gemini-rag-progress-actions" });
    this.cancelButton = progressActions.createEl("button", { cls: "gemini-rag-btn", text: "Cancel" });
  }

	// UIをレンダリングする
	render(state: IndexProgressState) {
    const isActive = state.status === "running" || state.status === "cancelling";
    this.root.style.display = isActive ? "flex" : "none";

    const total = state.total || 0;
    const completed = state.indexed + state.skipped + state.failed;
    const percent = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;

    const summaryParts = [
      `${state.indexed}/${state.total} indexed`,
      `${state.skipped} skipped`,
      `${state.failed} failed`,
    ];

    let statusText = "";
    switch (state.status) {
      case "running":
        statusText = "Indexing";
        break;
      case "cancelling":
        statusText = "Cancelling";
        break;
      case "completed":
        statusText = "Index complete";
        break;
      case "cancelled":
        statusText = "Index cancelled";
        break;
      case "error":
        statusText = "Index failed";
        break;
      default:
        statusText = "";
    }

    const summaryText = statusText ? `${statusText}. ${summaryParts.join(", ")}` : summaryParts.join(", ");
    this.summaryEl.setText(summaryText);
    this.percentEl.setText(total > 0 ? `${percent}%` : "");
    this.barFillEl.style.width = `${percent}%`;
    this.currentEl.setText(state.currentFile ? `Current: ${this.shortenPath(state.currentFile)}` : "");

    this.failuresEl.empty();
    if (state.failures.length > 0) {
      const details = this.failuresEl.createEl("details", { cls: "gemini-rag-progress-failures-details" });
      details.createEl("summary", { text: `Failed files (${state.failures.length})` });
      const list = details.createEl("ul");
      const maxFailures = 50;
      const failures = state.failures.slice(-maxFailures);
      for (const failure of failures) {
        list.createEl("li", { text: `${failure.path}: ${failure.error}` });
      }
      if (state.failures.length > failures.length) {
        details.createEl("div", {
          text: `...and ${state.failures.length - failures.length} more`,
        });
      }
    }

    const isRunning = state.status === "running";
    const isCancelling = state.status === "cancelling";

    this.indexButton.disabled = isRunning || isCancelling;
    this.cancelButton.disabled = !(isRunning || isCancelling);
  }
}
