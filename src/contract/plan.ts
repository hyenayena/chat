import {sanitizeText} from '../kit.js';

export type PlanStatus = 'pending' | 'in_progress' | 'completed';
export type PlanItem = {id?: string; content: string; activeForm?: string; status: PlanStatus};

export const MAX_PLAN_ITEMS = 50;
export const MAX_PLAN_TEXT = 200;
export const MAX_PLAN_ID = 32;
export const PLAN_STATUSES: readonly PlanStatus[] = ['pending', 'in_progress', 'completed'];

export const PLAN_TOOLS: ReadonlySet<string> = new Set(['TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet']);

export function clipText(value: unknown): string {
	return typeof value === 'string' ? sanitizeText(value.replace(/\s+/g, ' '), MAX_PLAN_TEXT) : '';
}

export function clipId(value: unknown): string {
	const s = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
	return /^[\w.-]{1,32}$/.test(s) ? s : '';
}

export function statusOf(value: unknown): PlanStatus {
	return value === 'in_progress' || value === 'completed' ? value : 'pending';
}

export function parseTodos(input: unknown): PlanItem[] {
	const list = (input as {todos?: unknown} | null)?.todos;
	if (!Array.isArray(list)) return [];
	const out: PlanItem[] = [];
	for (const raw of list.slice(0, MAX_PLAN_ITEMS)) {
		const t = raw as {content?: unknown; status?: unknown; activeForm?: unknown} | null;
		const content = clipText(t?.content);
		if (content === '') continue;
		const activeForm = clipText(t?.activeForm);
		out.push({content, status: statusOf(t?.status), ...(activeForm !== '' && {activeForm})});
	}
	return out;
}

export type PlanNote =
	| {kind: 'new'; steps: number}
	| {kind: 'added'; steps: number}
	| {kind: 'done'; text: string}
	| {kind: 'more-done'; count: number}
	| {kind: 'finished'; done: number; total: number};

const MAX_DONE_NOTES = 3;

const keyOf = (i: PlanItem): string => i.id ?? i.content;
export const allDone = (items: readonly PlanItem[]): boolean => items.length > 0 && items.every(i => i.status === 'completed');

export function planChanges(prev: readonly PlanItem[], next: readonly PlanItem[]): PlanNote[] {
	if (next.length === 0) return [];
	const before = new Map(prev.map(i => [keyOf(i), i]));
	const fresh = prev.length === 0 || allDone(prev) || !next.some(i => before.has(keyOf(i)));
	if (fresh) {
		if (allDone(next)) return [];
		return [{kind: 'new', steps: next.length}];
	}
	const notes: PlanNote[] = [];
	const added = next.filter(i => !before.has(keyOf(i))).length;
	if (added > 0) notes.push({kind: 'added', steps: added});
	const finished = next.filter(i => i.status === 'completed' && before.get(keyOf(i)) !== undefined && before.get(keyOf(i))!.status !== 'completed');
	for (const i of finished.slice(0, MAX_DONE_NOTES)) notes.push({kind: 'done', text: i.content});
	if (finished.length > MAX_DONE_NOTES) notes.push({kind: 'more-done', count: finished.length - MAX_DONE_NOTES});
	if (allDone(next)) notes.push({kind: 'finished', done: next.length, total: next.length});
	return notes;
}
