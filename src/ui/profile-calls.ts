import type {ChatProfile} from '../contract/profile.js';
import {isPassReply} from '../contract/profile.js';
import type {UiEvent} from '../contract/events.js';
import {SPAWN_TOOLS} from '../contract/tools.js';

export const PROFILE_TEXT_CAP = 16 * 1024;
const MAP_CAP = 128;

type Call = {
	persona: string;
	order: number;
	waits: boolean;
	running: boolean;
	resulted: boolean;
	text?: string;
	summary?: string;
};

export type ProfileLine = {agent: string; text: string};

export type ProfileTracker = {
	names: ReadonlySet<string>;
	passWord?: string;
	next: number;
	calls: ReadonlyMap<string, Call>;
	persona: ReadonlyMap<string, string>;
	taskCall: ReadonlyMap<string, string>;
};

type Step = {t: ProfileTracker; lines: ProfileLine[]};
export type TaskStep = Step & {known: boolean};

export const newTracker = (profile: Pick<ChatProfile, 'agents' | 'passWord'>): ProfileTracker => ({
	names: new Set(Object.keys(profile.agents)),
	...(profile.passWord !== undefined && {passWord: profile.passWord}),
	next: 0,
	calls: new Map(),
	persona: new Map(),
	taskCall: new Map(),
});

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

const clone = (t: ProfileTracker) => ({...t, calls: new Map(t.calls), persona: new Map(t.persona), taskCall: new Map(t.taskCall)});

const remember = (m: Map<string, string>, key: string, value: string): void => {
	m.delete(key);
	m.set(key, value);
	while (m.size > MAP_CAP) m.delete(m.keys().next().value!);
};

const latestPending = (calls: ReadonlyMap<string, Call>, persona: string): string | undefined => {
	let best: string | undefined;
	for (const [id, c] of calls) if (c.persona === persona && (best === undefined || c.order > calls.get(best)!.order)) best = id;
	return best;
};

export const personaOfCall = (t: ProfileTracker, input: unknown, name: string): string | undefined => {
	if (!isRecord(input)) return undefined;
	const key = SPAWN_TOOLS.has(name) ? input['subagent_type'] : name === 'SendMessage' ? input['to'] : undefined;
	return typeof key === 'string' && t.names.has(key) ? key : undefined;
};

export function trackUse(t: ProfileTracker, e: Extract<UiEvent, {kind: 'tool-use'}>): ProfileTracker {
	const persona = personaOfCall(t, e.input, e.name);
	if (persona === undefined) return t;
	const n = clone(t);
	const waits = e.name === 'SendMessage' || (isRecord(e.input) && e.input['run_in_background'] === true);
	n.calls.set(e.toolUseId, {persona, order: n.next++, waits, running: false, resulted: false});
	remember(n.persona, e.toolUseId, persona);
	return n;
}

const lastText = (e: Extract<UiEvent, {kind: 'agent-message'}>): string | undefined => {
	const item = e.items.filter(i => i.type === 'text').at(-1);
	return item?.type === 'text' ? item.text.slice(0, PROFILE_TEXT_CAP) : undefined;
};

export function trackAgentMessage(t: ProfileTracker, e: Extract<UiEvent, {kind: 'agent-message'}>): ProfileTracker {
	const persona = t.persona.get(e.agentId) ?? (e.taskId !== undefined ? t.persona.get(e.taskId) : undefined);
	if (persona === undefined) return t;
	const text = lastText(e);
	const id = t.calls.has(e.agentId) ? e.agentId : latestPending(t.calls, persona);
	const n = clone(t);
	remember(n.persona, e.agentId, persona);
	if (e.taskId !== undefined) remember(n.persona, e.taskId, persona);
	const call = id !== undefined ? n.calls.get(id) : undefined;
	if (call && text !== undefined && text.trim() !== '') n.calls.set(id!, {...call, text});
	return n;
}

function finish(n: ReturnType<typeof clone>, id: string, lines: ProfileLine[], fallback?: string): void {
	const call = n.calls.get(id);
	if (!call) return;
	n.calls.delete(id);
	const text = (call.text ?? call.summary ?? fallback ?? '').trim();
	if (text === '' || (n.passWord !== undefined && isPassReply(text, n.passWord))) return;
	lines.push({agent: call.persona, text});
}

export function trackTask(t: ProfileTracker, e: Extract<UiEvent, {kind: 'task'}>): TaskStep {
	const persona =
		(e.toolUseId !== undefined ? t.persona.get(e.toolUseId) : undefined) ??
		t.persona.get(e.id) ??
		(e.subagentType !== undefined && t.names.has(e.subagentType) ? e.subagentType : undefined);
	if (persona === undefined) return {t, lines: [], known: false};
	const id =
		(e.toolUseId !== undefined && t.calls.has(e.toolUseId) ? e.toolUseId : undefined) ?? t.taskCall.get(e.id) ?? latestPending(t.calls, persona);
	const n = clone(t);
	remember(n.persona, e.id, persona);
	const lines: ProfileLine[] = [];
	const call = id !== undefined ? n.calls.get(id) : undefined;
	if (id === undefined || !call) return {t: n, lines, known: true};
	remember(n.taskCall, e.id, id);
	if (e.status === 'running') {
		n.calls.set(id, {...call, running: true});
		return {t: n, lines, known: true};
	}
	const ended = {...call, running: false, ...(e.summary !== undefined && {summary: e.summary.slice(0, PROFILE_TEXT_CAP)})};
	n.calls.set(id, ended);
	if (ended.resulted) finish(n, id, lines);
	return {t: n, lines, known: true};
}

export function trackResult(t: ProfileTracker, e: Extract<UiEvent, {kind: 'tool-result'}>): Step & {hide: boolean} {
	const call = t.calls.get(e.toolUseId);
	if (!call) return {t, lines: [], hide: false};
	const n = clone(t);
	if (e.isError) {
		n.calls.delete(e.toolUseId);
		return {t: n, lines: [], hide: false};
	}
	const lines: ProfileLine[] = [];
	if (call.running && call.waits) n.calls.set(e.toolUseId, {...call, resulted: true});
	else finish(n, e.toolUseId, lines, e.text.slice(0, PROFILE_TEXT_CAP));
	return {t: n, lines, hide: true};
}

export function flushCalls(t: ProfileTracker): Step {
	if (t.calls.size === 0) return {t, lines: []};
	const n = clone(t);
	const lines: ProfileLine[] = [];
	const ids = [...n.calls.entries()].sort((a, b) => a[1].order - b[1].order).map(([id]) => id);
	for (const id of ids) {
		const call = n.calls.get(id)!;
		if (call.text === undefined && call.summary === undefined) n.calls.delete(id);
		else finish(n, id, lines);
	}
	return {t: n, lines};
}

// Calls still waiting for their line, in call order, one entry per agent.
export function pendingPersonas(t: ProfileTracker): string[] {
	const sorted = [...t.calls.values()].sort((a, b) => a.order - b.order);
	return [...new Set(sorted.map(c => c.persona))];
}

// An interrupt drops what the agents had said so far: no line is printed for it.
export function dropCalls(t: ProfileTracker): ProfileTracker {
	return t.calls.size === 0 ? t : {...t, calls: new Map()};
}

export const isProfileId = (t: ProfileTracker, id: string): boolean => t.persona.has(id);

export function isProfileEvent(t: ProfileTracker, e: UiEvent): boolean {
	switch (e.kind) {
		case 'tool-use':
			return personaOfCall(t, e.input, e.name) !== undefined;
		case 'tool-result':
		case 'tool-progress':
		case 'agent-activity':
			return t.persona.has(e.toolUseId);
		case 'agent-message':
			return t.persona.has(e.agentId) || (e.taskId !== undefined && t.persona.has(e.taskId));
		case 'task':
			return (
				(e.toolUseId !== undefined && t.persona.has(e.toolUseId)) ||
				t.persona.has(e.id) ||
				(e.subagentType !== undefined && t.names.has(e.subagentType))
			);
		default:
			return false;
	}
}

export function isProfileBox(t: ProfileTracker, box: {id: string; taskId?: string; subagentType?: string; spawnName?: string; aliases?: string[]}): boolean {
	return (
		t.persona.has(box.id) ||
		(box.taskId !== undefined && t.persona.has(box.taskId)) ||
		(box.subagentType !== undefined && t.names.has(box.subagentType)) ||
		(box.spawnName !== undefined && t.names.has(box.spawnName)) ||
		(box.aliases?.some(a => t.persona.has(a)) ?? false)
	);
}
