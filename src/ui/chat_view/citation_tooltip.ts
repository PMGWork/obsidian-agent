import type { SourceItem } from "../../utils/grounding";

// 引用ツールチップクラス
export class CitationTooltip {
  private tooltipEl?: HTMLElement;

  // ツールチップを表示
  show(anchor: HTMLElement, source: SourceItem) {
    this.hide();
    const tooltip = document.createElement("div");
    tooltip.className = "gemini-rag-tooltip";

    const header = tooltip.createEl("div", { cls: "gemini-rag-tooltip-header" });
    header.createEl("span", { cls: "gemini-rag-tooltip-icon", text: "📄" });
    header.createEl("span", { cls: "gemini-rag-tooltip-title", text: source.label });

    if (source.text) {
      const preview = source.text.slice(0, 150).trim();
      const previewText = preview.length < source.text.length ? `${preview}...` : preview;
      tooltip.createEl("div", { cls: "gemini-rag-tooltip-body", text: previewText });
    } else if (source.detail) {
      tooltip.createEl("div", { cls: "gemini-rag-tooltip-body", text: source.detail });
    }

    document.body.appendChild(tooltip);
    this.tooltipEl = tooltip;

    const rect = anchor.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    let left = rect.left + rect.width / 2 - tooltipRect.width / 2;
    let top = rect.bottom + 8;

    if (left < 8) left = 8;
    if (left + tooltipRect.width > window.innerWidth - 8) {
      left = window.innerWidth - tooltipRect.width - 8;
    }
    if (top + tooltipRect.height > window.innerHeight - 8) {
      top = rect.top - tooltipRect.height - 8;
    }

    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }

  // ツールチップを非表示
  hide() {
    if (this.tooltipEl) {
      this.tooltipEl.remove();
      this.tooltipEl = undefined;
    }
  }
}
