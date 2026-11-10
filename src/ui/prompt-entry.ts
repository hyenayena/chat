import type {Key} from 'ink';
import {QUESTION_LIMITS, REASON_MAX} from '../public.js';
import type {PermissionDecision, PermissionRequest} from '../public.js';
import {
	appendText,
	ARM_MS,
	initQuestionPrompt,
	initToolPrompt,
	isArmed,
	layoutPrompt,
	normalizeKey,
	questionPromptKey,
	rearm,
	toolBodyRows,
	toolPromptKey,
	type QuestionPromptState,
	type Reveal,
	type ToolPromptState,
} from './prompt-state.js';

export type PromptEntry =
	| {id: string; request: Extract<PermissionRequest, {kind: 'tool'}>; state: ToolPromptState; armedSig: string}
	| {id: string; request: Extract<PermissionRequest, {kind: 'question'}>; state: QuestionPromptState; armedSig: string};

export type PromptKeyContext = {rows: number; columns: number; reveal: Reveal; armMs: number; now: number};
export type PromptKeyResult = {notice?: string; decision?: PermissionDecision; stopTurn?: boolean};

const promptSig = (p: PromptEntry, tier: string): string =>
	p.request.kind === 'tool'
		? `${p.id}:${(p.state as ToolPromptState).view}:${tier}`
		: `${p.id}:${(p.state as QuestionPromptState).index}:${(p.state as QuestionPromptState).view}:${tier}`;

// The entry starts closed; rearmEntry opens it once the first frame has been laid out.
export function newPromptEntry(head: PermissionRequest, armMs = ARM_MS): PromptEntry {
	const closed = {armedAt: Number.POSITIVE_INFINITY};
	return head.kind === 'tool'
		? {id: head.id, request: head, state: {...initToolPrompt(head, 0, armMs), ...closed}, armedSig: ''}
		: {id: head.id, request: head, state: {...initQuestionPrompt(head, 0, armMs), ...closed}, armedSig: ''};
}

export function promptEntryKey(p: PromptEntry, input: string, key: Key, ctx: PromptKeyContext): PromptKeyResult {
	const pk = normalizeKey(input, key);
	const layout = layoutPrompt(ctx.rows, ctx.columns);
	if (p.request.kind === 'tool') {
		const state = p.state as ToolPromptState;
		let pager;
		if (state.view === 'full') {
			const total = toolBodyRows(p.request, ctx.reveal, layout.width).length;
			pager = {max: Math.max(0, total - layout.pagerRows), page: Math.max(1, layout.pagerRows - 1)};
		}
		const blind = layout.tier === 'minimal';
		const res = toolPromptKey(state, p.request, pk, ctx.now, pager, ctx.armMs, blind);
		p.state = res.state;
		return {notice: res.notice, decision: res.decision, stopTurn: res.stopTurn};
	}
	const res = questionPromptKey(p.state as QuestionPromptState, p.request, pk, ctx.now, ctx.armMs, layout.budget < 4);
	p.state = res.state;
	return {notice: res.notice, decision: res.decision, stopTurn: res.stopTurn};
}

// Returns whether the entry changed.
export function promptEntryPaste(p: PromptEntry, text: string, now: number): boolean {
	if (!isArmed(p.state, now)) return false;
	if (p.request.kind === 'tool') {
		const state = p.state as ToolPromptState;
		if (state.view === 'reason') p.state = {...state, reason: appendText(state.reason, text, REASON_MAX)};
	} else {
		const state = p.state as QuestionPromptState;
		if (state.view === 'other') p.state = {...state, other: appendText(state.other, text, QUESTION_LIMITS.freeText)};
	}
	return true;
}

export function rearmEntry(p: PromptEntry, tier: string, now: number, armMs = ARM_MS): void {
	const sig = promptSig(p, tier);
	if (p.armedSig === sig) return;
	p.armedSig = sig;
	p.state = rearm(p.state, now, armMs) as typeof p.state;
}
