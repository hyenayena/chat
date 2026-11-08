import type {AgentItem, ChatEvent, ChatState, ContextInfo, RouteInfo, ToolPatch, TurnOutcome, UiEvent} from './events.js';
import {ACCOUNT_REASONS, ROUTE_OUTCOMES, ROUTE_SOURCES} from './events.js';
import type {AuditEntry, CancelCause, PermissionDecision, PermissionRequest, Preview, QuestionRequest, ToolRequest} from './permission.js';
import {MAX_PLAN_ID, MAX_PLAN_ITEMS, MAX_PLAN_TEXT, PLAN_STATUSES, type PlanItem} from './plan.js';
import type {LimitType, RateLimitInfo} from './limits.js';
import {TIERS, type Tier} from './tiers.js';
import {MAX_TURN_FILES, MAX_TURN_PATH, type TurnFileChange, type TurnSummary} from './turn-stats.js';
import type {ProviderCommand, TaskInfo} from './provider.js';

export const MAX_EVENT_TEXT = 1024 * 1024;

export class ContractError extends Error {
	override name = 'ContractError';
	constructor(readonly detail: string) {
		super(`Invalid chat data: ${detail}`);
	}
}

const fail = (what: string): never => {
	throw new ContractError(what);
};

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const rec = (v: unknown, what: string): Rec => (isRec(v) ? v : fail(`${what} must be an object`));
const str = (v: unknown, what: string, max = MAX_EVENT_TEXT): string =>
	typeof v === 'string' && v.length <= max ? v : fail(`${what} must be a string`);
const ident = (v: unknown, what: string): string => {
	const s = str(v, what, 256);
	return s === '' ? fail(`${what} must not be empty`) : s;
};
const bool = (v: unknown, what: string): boolean => (typeof v === 'boolean' ? v : fail(`${what} must be a boolean`));
const num = (v: unknown, what: string): number => (typeof v === 'number' && Number.isFinite(v) ? v : fail(`${what} must be a number`));
const nonNeg = (v: unknown, what: string, max = Number.MAX_SAFE_INTEGER): number =>
	typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max ? v : fail(`${what} must be a number from 0 to ${max}`);
const int = (v: unknown, what: string): number => (Number.isSafeInteger(v) ? (v as number) : fail(`${what} must be an integer`));
const oneOf = <T extends string>(v: unknown, set: readonly T[], what: string): T =>
	typeof v === 'string' && (set as readonly string[]).includes(v) ? (v as T) : fail(`${what} is not valid`);
const arr = (v: unknown, what: string, max: number): unknown[] =>
	Array.isArray(v) && v.length <= max ? v : fail(`${what} must be a list of at most ${max}`);
const has = (o: Rec, key: string): boolean => o[key] !== undefined && o[key] !== null;

const MAX_TOOL_DURATION_MS = 604_800_000;
const MAX_THINKING_MS = 86_400_000;
const MODES = ['default', 'acceptEdits', 'plan', 'auto'] as const;
const STATES = ['idle', 'running', 'closed'] as const;
const OUTCOMES = ['ok', 'error', 'interrupted', 'timeout', 'max-turns', 'limit', 'context'] as const;
const LIMIT_TYPES = ['five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet', 'seven_day_overage_included', 'overage'] as const;
const TASK_STATUSES = ['running', 'completed', 'failed', 'stopped'] as const;
const CAUSES = ['aborted', 'interrupted', 'closed', 'timeout', 'replaced'] as const;
const TOOL_NAMES = ['Bash', 'Edit', 'Write', 'WebFetch', 'ExitPlanMode', 'Mcp', 'Command'] as const;
const AUDIT_OUTCOMES = [
	'allowed',
	'auto-accepted',
	'always-allowed',
	'denied',
	'denied-by-policy',
	'cancelled',
	'answered',
	'dismissed',
] as const;

const optBool = (o: Rec, key: string): boolean | undefined => (has(o, key) ? bool(o[key], key) : undefined);
const strList = (v: unknown, what: string, max: number): string[] => arr(v, what, max).map((s, i) => str(s, `${what}[${i}]`));

export const readPermissionDecision = (v: unknown): PermissionDecision => {
	const o = rec(v, 'decision');
	switch (o.kind) {
		case 'allow':
			return {kind: 'allow', ...(o.always === true && {always: true})};
		case 'deny':
			return {
				kind: 'deny',
				...(has(o, 'reason') && {reason: str(o.reason, 'reason', 4096)}),
				...(o.stop === true && {stop: true}),
			};
		case 'answers': {
			const raw = rec(o.answers, 'answers');
			const keys = Object.keys(raw);
			if (keys.length > 100) fail('too many answers');
			const answers: Record<string, string> = Object.create(null) as Record<string, string>;
			for (const k of keys) answers[k] = str(raw[k], 'answer', 8192);
			return {kind: 'answers', answers: {...answers}};
		}
		case 'cancel':
			return {kind: 'cancel', cause: oneOf(o.cause, CAUSES, 'cause') as CancelCause};
		default:
			return fail('decision kind');
	}
};

export const readRateLimit = (v: unknown): RateLimitInfo => {
	const o = rec(v, 'rateLimit');
	return {
		status: oneOf(o.status, ['allowed', 'allowed_warning', 'rejected'] as const, 'status'),
		...(has(o, 'resetsAt') && {resetsAt: num(o.resetsAt, 'resetsAt')}),
		...(has(o, 'type') && {type: oneOf(o.type, LIMIT_TYPES, 'type') as LimitType}),
		...(has(o, 'utilization') && {utilization: num(o.utilization, 'utilization')}),
		...(has(o, 'usingOverage') && {usingOverage: bool(o.usingOverage, 'usingOverage')}),
	};
};

const readPreview = (v: unknown): Preview => {
	const o = rec(v, 'preview');
	return {
		rows: arr(o.rows, 'rows', 5000).map(r => {
			const ro = rec(r, 'row');
			return {
				kind: oneOf(ro.kind, ['meta', 'ctx', 'add', 'del', 'gap'] as const, 'row kind'),
				text: str(ro.text, 'row text', 20_000),
				...(has(ro, 'no') && {no: num(ro.no, 'no')}),
				...(has(ro, 'oldNo') && {oldNo: num(ro.oldNo, 'oldNo')}),
				...(has(ro, 'newNo') && {newNo: num(ro.newNo, 'newNo')}),
				...(has(ro, 'count') && {count: num(ro.count, 'count')}),
			};
		}),
		added: num(o.added, 'added'),
		removed: num(o.removed, 'removed'),
		truncated: bool(o.truncated, 'truncated'),
		approximate: bool(o.approximate, 'approximate'),
	};
};

export const readToolPatch = (v: unknown): ToolPatch => {
	const o = rec(v, 'patch');
	let lines = 0;
	const hunks = arr(o.hunks, 'hunks', 200).map(h => {
		const ho = rec(h, 'hunk');
		const oldStart = int(ho.oldStart, 'oldStart');
		const newStart = int(ho.newStart, 'newStart');
		if (oldStart < 0 || newStart < 0) fail('hunk start must not be negative');
		const hunkLines = arr(ho.lines, 'lines', 2000).map(l => str(l, 'line', 20_000));
		lines += hunkLines.length;
		if (lines > 2000) fail('patch has too many lines');
		return {oldStart, newStart, lines: hunkLines};
	});
	if (has(o, 'created') && o.created !== true) fail('created must be true');
	return {hunks, ...(o.created === true && {created: true as const})};
};

export const readPermissionRequest = (v: unknown): PermissionRequest => {
	const o = rec(v, 'permission');
	if (o.kind === 'question') {
		const q: QuestionRequest = {
			kind: 'question',
			id: ident(o.id, 'id'),
			seq: int(o.seq, 'seq'),
			questions: arr(o.questions, 'questions', 4).map(x => {
				const qo = rec(x, 'question');
				return {
					question: str(qo.question, 'question', 2000),
					header: str(qo.header, 'header', 200),
					multiSelect: bool(qo.multiSelect, 'multiSelect'),
					options: arr(qo.options, 'options', 8).map(p => {
						const po = rec(p, 'option');
						return {label: str(po.label, 'label', 500), description: str(po.description, 'description', 2000)};
					}),
				};
			}),
		};
		return q;
	}
	if (o.kind !== 'tool') return fail('permission kind');
	const t: ToolRequest = {
		kind: 'tool',
		id: ident(o.id, 'id'),
		seq: int(o.seq, 'seq'),
		toolName: oneOf(o.toolName, TOOL_NAMES, 'toolName'),
		input: rec(o.input, 'input'),
		cwd: str(o.cwd, 'cwd', 4096),
		...(has(o, 'path') && {path: str(o.path, 'path', 4096)}),
		...(has(o, 'resolvedPath') && {resolvedPath: str(o.resolvedPath, 'resolvedPath', 4096)}),
		...(has(o, 'description') && {description: str(o.description, 'description', 20_000)}),
		...(has(o, 'cliNote') && {
			cliNote: (() => {
				const c = rec(o.cliNote, 'cliNote');
				return {text: str(c.text, 'text', 20_000), ...(has(c, 'type') && {type: str(c.type, 'type', 100)})};
			})(),
		}),
		...(has(o, 'preview') && {preview: readPreview(o.preview)}),
		highlights: arr(o.highlights, 'highlights', 100).map(h => {
			const ho = rec(h, 'highlight');
			return {level: oneOf(ho.level, ['info', 'warn'] as const, 'level'), text: str(ho.text, 'text', 2000)};
		}),
		defaultToNo: bool(o.defaultToNo, 'defaultToNo'),
		always: o.always === false ? false : {label: str(rec(o.always, 'always').label, 'label', 500)},
		oversize: bool(o.oversize, 'oversize'),
	};
	return t;
};

const readAudit = (v: unknown): AuditEntry => {
	const o = rec(v, 'audit');
	return {
		outcome: oneOf(o.outcome, AUDIT_OUTCOMES, 'outcome'),
		toolName: str(o.toolName, 'toolName', 256),
		summary: str(o.summary, 'summary', 4096),
	};
};

const readAgentItem = (v: unknown): AgentItem => {
	const o = rec(v, 'agent item');
	switch (o.type) {
		case 'text':
			return {type: 'text', text: str(o.text, 'text')};
		case 'thinking':
			return {type: 'thinking', text: str(o.text, 'text')};
		case 'tool-use':
			return {type: 'tool-use', toolUseId: str(o.toolUseId, 'toolUseId', 256), name: str(o.name, 'name', 256), input: o.input};
		case 'tool-result':
			return {
				type: 'tool-result',
				toolUseId: str(o.toolUseId, 'toolUseId', 256),
				isError: bool(o.isError, 'isError'),
				text: str(o.text, 'text'),
				...(has(o, 'patch') && {patch: readToolPatch(o.patch)}),
			};
		default:
			return fail('agent item type');
	}
};

// A kind this client does not know comes from a newer runner: the frame is dropped instead of failing the connection.
export const readUiEvent = (v: unknown): UiEvent | undefined => {
	const o = rec(v, 'ui event');
	switch (o.kind) {
		case 'session':
			return {
				kind: 'session',
				sessionId: ident(o.sessionId, 'sessionId'),
				...(has(o, 'model') && {model: str(o.model, 'model', 256)}),
				...(has(o, 'apiKeySource') && {apiKeySource: str(o.apiKeySource, 'apiKeySource', 256)}),
				...(has(o, 'slashCommands') && {slashCommands: strList(o.slashCommands, 'slashCommands', 1000)}),
			};
		case 'text-delta':
			return {kind: 'text-delta', text: str(o.text, 'text')};
		case 'text':
			return {
				kind: 'text',
				messageId: str(o.messageId, 'messageId', 256),
				text: str(o.text, 'text'),
				...(o.aborted === true && {aborted: true}),
			};
		case 'thinking':
			return {kind: 'thinking'};
		case 'thinking-text':
			return {
				kind: 'thinking-text',
				text: str(o.text, 'text'),
				...(has(o, 'durationMs') && {durationMs: nonNeg(o.durationMs, 'durationMs', MAX_THINKING_MS)}),
			};
		case 'task':
			return {
				kind: 'task',
				id: ident(o.id, 'id'),
				status: oneOf(o.status, TASK_STATUSES, 'status'),
				...(has(o, 'description') && {description: str(o.description, 'description', 4096)}),
				...(has(o, 'background') && {background: bool(o.background, 'background')}),
				...(has(o, 'summary') && {summary: str(o.summary, 'summary', 20_000)}),
				...(has(o, 'toolUseId') && {toolUseId: str(o.toolUseId, 'toolUseId', 256)}),
				...(has(o, 'taskType') && {taskType: str(o.taskType, 'taskType', 256)}),
				...(has(o, 'subagentType') && {subagentType: str(o.subagentType, 'subagentType', 256)}),
				...(has(o, 'prompt') && {prompt: str(o.prompt, 'prompt', 16 * 1024)}),
				...(has(o, 'parentTaskId') && {parentTaskId: ident(o.parentTaskId, 'parentTaskId')}),
				...(has(o, 'depth') && {depth: int(o.depth, 'depth')}),
			};
		case 'tool-use':
			return {
				kind: 'tool-use',
				toolUseId: str(o.toolUseId, 'toolUseId', 256),
				name: str(o.name, 'name', 256),
				input: o.input,
				...(has(o, 'at') && {at: nonNeg(o.at, 'at')}),
			};
		case 'tool-result':
			return {
				kind: 'tool-result',
				toolUseId: str(o.toolUseId, 'toolUseId', 256),
				isError: bool(o.isError, 'isError'),
				text: str(o.text, 'text'),
				...(has(o, 'patch') && {patch: readToolPatch(o.patch)}),
				...(has(o, 'durationMs') && {durationMs: nonNeg(o.durationMs, 'durationMs', MAX_TOOL_DURATION_MS)}),
			};
		case 'tool-progress':
			return {
				kind: 'tool-progress',
				toolUseId: str(o.toolUseId, 'toolUseId', 256),
				name: str(o.name, 'name', 256),
				elapsedSeconds: num(o.elapsedSeconds, 'elapsedSeconds'),
			};
		case 'agent-activity':
			return {kind: 'agent-activity', toolUseId: str(o.toolUseId, 'toolUseId', 256), name: str(o.name, 'name', 256), input: o.input};
		case 'agent-message':
			return {
				kind: 'agent-message',
				agentId: str(o.agentId, 'agentId', 256),
				...(has(o, 'taskId') && {taskId: ident(o.taskId, 'taskId')}),
				...(has(o, 'model') && {model: str(o.model, 'model', 256)}),
				items: arr(o.items, 'items', 64).map(readAgentItem),
			};
		case 'tool-input':
			return {kind: 'tool-input', name: str(o.name, 'name', 256)};
		case 'tool-input-delta':
			return {kind: 'tool-input-delta', chars: num(o.chars, 'chars')};
		case 'thinking-tokens':
			return {kind: 'thinking-tokens', tokens: num(o.tokens, 'tokens')};
		case 'cli-state':
			return {kind: 'cli-state', state: oneOf(o.state, ['running', 'idle', 'requires_action'] as const, 'state')};
		case 'context':
			return {kind: 'context', ...readContextInfo(o)};
		case 'plan':
			return {kind: 'plan', items: readPlanItems(o.items)};
		case 'status':
			return {kind: 'status', status: o.status === null ? null : oneOf(o.status, ['compacting', 'requesting'] as const, 'status')};
		case 'retry':
			return {
				kind: 'retry',
				attempt: num(o.attempt, 'attempt'),
				maxRetries: num(o.maxRetries, 'maxRetries'),
				delayMs: num(o.delayMs, 'delayMs'),
				...(has(o, 'errorCode') && {errorCode: str(o.errorCode, 'errorCode', 256)}),
			};
		case 'api-error':
			return {
				kind: 'api-error',
				code: str(o.code, 'code', 256),
				...(has(o, 'detail') && {detail: str(o.detail, 'detail', 20_000)}),
			};
		case 'rate-limit':
			return {kind: 'rate-limit', info: readRateLimit(o.info)};
		case 'result':
			return {
				kind: 'result',
				ok: bool(o.ok, 'ok'),
				subtype: str(o.subtype, 'subtype', 256),
				...(has(o, 'text') && {text: str(o.text, 'text')}),
				...(has(o, 'errors') && {errors: strList(o.errors, 'errors', 100)}),
				...(has(o, 'sessionId') && {sessionId: str(o.sessionId, 'sessionId', 256)}),
				...(has(o, 'costUsd') && {costUsd: num(o.costUsd, 'costUsd')}),
				...(has(o, 'numTurns') && {numTurns: num(o.numTurns, 'numTurns')}),
				...(has(o, 'terminalReason') && {terminalReason: str(o.terminalReason, 'terminalReason', 256)}),
				...(has(o, 'queuedTurns') && {queuedTurns: int(o.queuedTurns, 'queuedTurns')}),
			};
		default:
			return typeof o.kind === 'string' && o.kind !== '' ? undefined : fail('ui event kind');
	}
};

const MAX_CONTEXT_TOKENS = 100_000_000;
const MAX_SUMMARY_MS = 604_800_000;
const MAX_SUMMARY_COUNT = 1_000_000_000;

export const readContextInfo = (o: Rec): ContextInfo => ({
	used: nonNeg(o.used, 'used', MAX_CONTEXT_TOKENS),
	...(has(o, 'limit') && {limit: nonNeg(o.limit, 'limit', MAX_CONTEXT_TOKENS)}),
});

// UTF-16 units, twice the code point cap the sender clips to
export const readPlanItems = (v: unknown): PlanItem[] =>
	arr(v, 'items', MAX_PLAN_ITEMS).map(raw => {
		const o = rec(raw, 'plan item');
		return {
			...(has(o, 'id') && {id: str(o.id, 'id', MAX_PLAN_ID)}),
			content: str(o.content, 'content', MAX_PLAN_TEXT * 2),
			...(has(o, 'activeForm') && {activeForm: str(o.activeForm, 'activeForm', MAX_PLAN_TEXT * 2)}),
			status: oneOf(o.status, PLAN_STATUSES, 'status'),
		};
	});

export const readTurnSummary = (v: unknown): TurnSummary => {
	const o = rec(v, 'summary');
	const files = arr(o.files, 'files', MAX_TURN_FILES).map((f): TurnFileChange => {
		const fo = rec(f, 'file');
		return {
			path: str(fo.path, 'path', MAX_TURN_PATH),
			added: nonNeg(fo.added, 'added', MAX_SUMMARY_COUNT),
			removed: nonNeg(fo.removed, 'removed', MAX_SUMMARY_COUNT),
			...(fo.created === true && {created: true as const}),
		};
	});
	return {
		durationMs: nonNeg(o.durationMs, 'durationMs', MAX_SUMMARY_MS),
		tools: nonNeg(o.tools, 'tools', MAX_SUMMARY_COUNT),
		files,
		filesTotal: nonNeg(o.filesTotal, 'filesTotal', MAX_SUMMARY_COUNT),
		added: nonNeg(o.added, 'added', MAX_SUMMARY_COUNT),
		removed: nonNeg(o.removed, 'removed', MAX_SUMMARY_COUNT),
		outputTokens: nonNeg(o.outputTokens, 'outputTokens', MAX_SUMMARY_COUNT),
	};
};

export const readRouteInfo = (v: unknown): RouteInfo => {
	const o = rec(v, 'route');
	const tier = (key: string): Tier | undefined => (has(o, key) ? oneOf(o[key], TIERS, key) : undefined);
	const main = tier('main');
	const rated = tier('rated');
	const pinned = tier('pinned');
	const newTask = optBool(o, 'newTask');
	const held = optBool(o, 'held');
	return {
		outcome: oneOf(o.outcome, ROUTE_OUTCOMES, 'outcome'),
		...(main !== undefined && {main}),
		...(rated !== undefined && {rated}),
		...(pinned !== undefined && {pinned}),
		...(newTask !== undefined && {newTask}),
		...(held !== undefined && {held}),
		...(optBool(o, 'failed') === true && {failed: true as const}),
	};
};

export const readChatEvent = (v: unknown): ChatEvent | undefined => {
	const o = rec(v, 'event');
	switch (o.type) {
		case 'ui':
		{
			const event = readUiEvent(o.event);
			return event && {type: 'ui', event};
		}
		case 'state':
			return {type: 'state', state: oneOf(o.state, STATES, 'state') as ChatState};
		case 'turn-end':
			return {
				type: 'turn-end',
				outcome: oneOf(o.outcome, OUTCOMES, 'outcome') as TurnOutcome,
				...(has(o, 'error') && {error: str(o.error, 'error', 20_000)}),
				...(has(o, 'summary') && {summary: readTurnSummary(o.summary)}),
			};
		case 'permission-requested':
			return {type: 'permission-requested', request: readPermissionRequest(o.request), pending: int(o.pending, 'pending')};
		case 'permission-resolved':
			return {type: 'permission-resolved', id: ident(o.id, 'id'), pending: int(o.pending, 'pending')};
		case 'audit':
			return {type: 'audit', entry: readAudit(o.entry)};
		case 'mode':
			return {
				type: 'mode',
				mode: oneOf(o.mode, MODES, 'mode'),
				...(has(o, 'error') && {error: str(o.error, 'error', 4096)}),
			};
		case 'sent':
			return {type: 'sent', text: str(o.text, 'text')};
		case 'steer-failed':
			return {type: 'steer-failed', text: str(o.text, 'text')};
		case 'title':
			return {type: 'title', title: str(o.title, 'title', 4096)};
		case 'account':
			return {
				type: 'account',
				account: str(o.account, 'account', 64),
				previous: str(o.previous, 'previous', 64),
				reason: oneOf(o.reason, ACCOUNT_REASONS, 'reason'),
			};
		case 'route-start':
			return {type: 'route-start'};
		case 'route':
			return {
				type: 'route',
				route: readRouteInfo(o.route),
				...(has(o, 'previous') && {previous: oneOf(o.previous, TIERS, 'previous')}),
				source: oneOf(o.source, ROUTE_SOURCES, 'source'),
			};
		default:
			return fail('chat event type');
	}
};

export const readTaskInfo = (v: unknown): TaskInfo => {
	const o = rec(v, 'task');
	return {
		id: ident(o.id, 'id'),
		status: oneOf(o.status, TASK_STATUSES, 'status'),
		description: str(o.description, 'description', 4096),
		background: bool(o.background, 'background'),
		startedAt: num(o.startedAt, 'startedAt'),
		...(has(o, 'summary') && {summary: str(o.summary, 'summary', 20_000)}),
		...(has(o, 'taskType') && {taskType: str(o.taskType, 'taskType', 256)}),
		...(has(o, 'toolUseId') && {toolUseId: str(o.toolUseId, 'toolUseId', 256)}),
		...(has(o, 'subagentType') && {subagentType: str(o.subagentType, 'subagentType', 256)}),
	};
};

export const readProviderCommand = (v: unknown): ProviderCommand => {
	const o = rec(v, 'slash command');
	return {
		name: ident(o.name, 'name'),
		...(has(o, 'description') && {description: str(o.description, 'description', 4096)}),
		...(has(o, 'argumentHint') && {argumentHint: str(o.argumentHint, 'argumentHint', 1024)}),
	};
};
