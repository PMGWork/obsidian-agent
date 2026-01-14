const DEFAULT_THOUGHT_TITLE = "Thinking...";
const FINAL_THOUGHT_TITLE = "推論完了";
const MAX_THOUGHT_TITLE_LENGTH = 50;

// フォーマットされた出力を生成する関数
export function formatOutput(answer: string, thoughtSummary?: string, isFinal = false): string {
  let title = DEFAULT_THOUGHT_TITLE;
  if (isFinal) {
    title = FINAL_THOUGHT_TITLE;
  } else if (thoughtSummary) {
    title = getLatestThoughtTitle(thoughtSummary);
  }

  const callout = `> [!info] ${title}`;
  if (!answer.trim()) {
    return callout;
  }
  return `${callout}\n\n${answer}`;
}

// 最新の思考タイトルを取得する関数
function getLatestThoughtTitle(fullThought: string): string {
  if (!fullThought) return DEFAULT_THOUGHT_TITLE;

  const lines = fullThought
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const lastLine = lines[lines.length - 1];

  if (!lastLine) return DEFAULT_THOUGHT_TITLE;

  const cleanLine = lastLine
    .replace(/^#+\s*/, "")
    .replace(/^[-*]\s+/, "")
    .replace(/^>\s+/, "");

  if (cleanLine.length > MAX_THOUGHT_TITLE_LENGTH) {
    return `${cleanLine.substring(0, MAX_THOUGHT_TITLE_LENGTH)}...`;
  }
  return cleanLine;
}
