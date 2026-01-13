import { App, Modal } from "obsidian";

type ConfirmOptions = {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
};

class ConfirmModal extends Modal {
  private titleText: string;
  private message: string;
  private confirmText: string;
  private cancelText: string;
  private resolve: (value: boolean) => void;
  private resolved = false;

  constructor(app: App, options: ConfirmOptions, resolve: (value: boolean) => void) {
    super(app);
    this.titleText = options.title;
    this.message = options.message;
    this.confirmText = options.confirmText ?? "OK";
    this.cancelText = options.cancelText ?? "Cancel";
    this.resolve = resolve;
  }

  onOpen(): void {
    this.setTitle(this.titleText);
    const { contentEl } = this;
    contentEl.createEl("p", { text: this.message });

    const buttonRow = contentEl.createEl("div", { cls: "gemini-rag-modal-actions" });
    const cancelButton = buttonRow.createEl("button", { text: this.cancelText });
    const confirmButton = buttonRow.createEl("button", {
      text: this.confirmText,
      cls: "mod-warning",
    });

    cancelButton.addEventListener("click", () => this.finish(false));
    confirmButton.addEventListener("click", () => this.finish(true));
  }

  onClose(): void {
    if (!this.resolved) {
      this.resolve(false);
    }
  }

  private finish(value: boolean): void {
    if (this.resolved) {
      return;
    }
    this.resolved = true;
    this.resolve(value);
    this.close();
  }
}

export function confirmAction(app: App, options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const modal = new ConfirmModal(app, options, resolve);
    modal.open();
  });
}
