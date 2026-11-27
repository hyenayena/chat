import {sanitizeText, truncateCells} from '../kit.js';

export type HintRow = {keyHint?: string | undefined; confirm?: string | undefined; notice?: string | undefined; vimNormal: boolean};

export const VIM_NORMAL_LABEL = '-- NORMAL --';
const HINT_MAX_CHARS = 1000;

// One row under the input: a key hint wins over a mode confirmation, which wins over a notice.
export function hintRowText(hint: HintRow, width: number): string {
	const text = hint.keyHint || hint.confirm || hint.notice || '';
	const flat = sanitizeText(text.replace(/\s+/g, ' '), HINT_MAX_CHARS);
	const line = hint.vimNormal ? (flat ? `${VIM_NORMAL_LABEL} · ${flat}` : VIM_NORMAL_LABEL) : flat;
	return truncateCells(line, Math.max(1, width));
}
