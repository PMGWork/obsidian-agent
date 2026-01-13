// Gemini APIのGrounding（引用）処理ユーティリティ

// ソースアイテムの型
export type SourceItem = {
	label: string;
	detail?: string;
	path?: string;
	uri?: string;
	index: number;
	text?: string;
};

// Grounding メタデータの型
export type GroundingData = {
	groundingChunks?: Array<Record<string, unknown>>;
	groundingSupports?: Array<Record<string, unknown>>;
	grounding_supports?: Array<Record<string, unknown>>;
};

// Grounding chunksからソースを抽出する
export function extractSources(
	grounding: { groundingChunks?: Array<Record<string, unknown>> } | undefined,
	resolveVaultPath: (title?: string) => string | undefined,
): SourceItem[] {
	if (!grounding?.groundingChunks) {
		return [];
	}
	return grounding.groundingChunks.map((chunk, index) => {
		const context = (chunk.retrievedContext ??
			chunk["retrieved_context"]) as Record<string, unknown> | undefined;
		const title = (context?.title ??
			context?.displayName ??
			context?.["display_name"]) as string | undefined;
		const uri = (context?.uri ?? context?.["uri"]) as string | undefined;
		const text = (context?.text ?? context?.["text"]) as string | undefined;
		const label = title || uri || `Chunk ${index + 1}`;
		const detail = text ? text.slice(0, 200) : undefined;
		const path = resolveVaultPath(title);
		return { label, detail, path, uri, index: index + 1, text };
	});
}

// 回答テキストに引用アノテーションを追加する
export function annotateAnswer(
	text: string,
	grounding: GroundingData | undefined,
	sources: SourceItem[],
): string {
	if (!grounding) {
		return text;
	}
	const supports =
		grounding.groundingSupports ??
		(grounding as { grounding_supports?: Array<Record<string, unknown>> })
			.grounding_supports ??
		[];
	if (supports.length === 0) {
		return text;
	}

	const positionMap = new Map<number, number[]>();
	for (const support of supports) {
		const segment = (support.segment ?? support["segment"]) as
			| Record<string, unknown>
			| undefined;
		const endIndex = segment?.endIndex ?? segment?.["end_index"];
		const chunkIndices = (support.groundingChunkIndices ??
			support["grounding_chunk_indices"]) as number[] | undefined;
		if (typeof endIndex !== "number" || !Array.isArray(chunkIndices)) {
			continue;
		}
		const numbers = chunkIndices
			.map((idx) => sources[idx]?.index)
			.filter((value): value is number => typeof value === "number");
		if (numbers.length === 0) {
			continue;
		}
		const unique = Array.from(new Set(numbers)).sort((a, b) => a - b);
		const existing = positionMap.get(endIndex) ?? [];
		positionMap.set(endIndex, existing.concat(unique));
	}

	if (positionMap.size === 0) {
		return text;
	}

	const insertions: Array<{ pos: number; marker: string }> = [];
	for (const [pos, numbers] of positionMap.entries()) {
		const unique = Array.from(new Set(numbers)).sort((a, b) => a - b);
		const marker = unique
			.map((value) => `[${value}](citation:${value})`)
			.join(" ");
		insertions.push({ pos, marker });
	}

	insertions.sort((a, b) => b.pos - a.pos);
	let output = text;
	for (const insertion of insertions) {
		const adjustedPos = clampToWordBoundary(output, insertion.pos);
		if (adjustedPos >= 0 && adjustedPos <= output.length) {
			output =
				output.slice(0, adjustedPos) +
				insertion.marker +
				output.slice(adjustedPos);
		} else {
			output += insertion.marker;
		}
	}
	return output;
}

function clampToWordBoundary(text: string, pos: number): number {
	if (pos <= 0 || pos >= text.length) {
		return pos;
	}
	const prev = text[pos - 1];
	const next = text[pos];
	if (isWordChar(prev) && isWordChar(next)) {
		let cursor = pos;
		while (cursor < text.length && isWordChar(text[cursor])) {
			cursor += 1;
		}
		return cursor;
	}
	return pos;
}

function isWordChar(char: string | undefined): boolean {
	if (!char) {
		return false;
	}
	return /[A-Za-z0-9_]/.test(char);
}
