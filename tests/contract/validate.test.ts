import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
	ContractError,
	MAX_EVENT_TEXT,
	readChatEvent,
	readPermissionDecision,
	readPermissionRequest,
	readPlanItems,
	readToolPatch,
	readUiEvent,
	type ChatEvent,
	type PermissionDecision,
} from '../../src/public.js';

const ui = (event: unknown) => ({type: 'ui', event});
const same = (event: ChatEvent) => assert.deepEqual(readChatEvent(JSON.parse(JSON.stringify(event))), event);
const bad = (event: unknown, label?: string) => assert.throws(() => readChatEvent(event), ContractError, label ?? JSON.stringify(event).slice(0, 80));

test('a permission request is validated and rebuilt', () => {
	const event: ChatEvent = {
		type: 'permission-requested',
		pending: 1,
		request: {
			kind: 'tool',
			id: 'p1',
			seq: 1,
			toolName: 'Bash',
			input: {command: 'ls'},
			cwd: '/app',
			highlights: [{level: 'warn', text: 'x'}],
			defaultToNo: false,
			always: {label: 'ls'},
			oversize: false,
		},
	};
	same(event);
	const broken = JSON.parse(JSON.stringify(event)) as {request: {toolName: string}};
	broken.request.toolName = 'Rm';
	bad(broken);
});

test('an account change event is read; an unknown reason is not', () => {
	same({type: 'account', account: 'spare', previous: 'work', reason: 'changed'});
	bad({type: 'account', account: 'spare', previous: 'work', reason: 'other'});
});

test('changed and pinned account events are read; the retired reasons are not', () => {
	for (const reason of ['changed', 'pinned'] as const) same({type: 'account', account: 'work', previous: 'spare', reason});
	for (const reason of ['usage-limit', 'billing', 'restored', 'returned']) bad({type: 'account', account: 'work', previous: 'spare', reason}, reason);
});

test('live status events are read; a bad state is not', () => {
	for (const event of [
		{kind: 'cli-state', state: 'running'},
		{kind: 'thinking-tokens', tokens: 1200},
		{kind: 'tool-input', name: 'Edit'},
		{kind: 'tool-input-delta', chars: 40},
	] as const) {
		same({type: 'ui', event});
	}
	bad(ui({kind: 'cli-state', state: 'asleep'}));
});

test('a tool-result with a patch is read; a bad or oversized patch is rejected', () => {
	const patch = {hunks: [{oldStart: 1, newStart: 1, lines: ['-a', '+b']}], created: true as const};
	same({type: 'ui', event: {kind: 'tool-result', toolUseId: 't', isError: false, text: 'ok', patch}});
	same({type: 'ui', event: {kind: 'tool-result', toolUseId: 't', isError: false, text: 'ok'}});
	assert.deepEqual(readToolPatch(patch), patch);
	for (const p of [
		'x',
		{hunks: 'x'},
		{hunks: [{oldStart: -1, newStart: 1, lines: []}]},
		{hunks: [{oldStart: 1, newStart: 1.5, lines: []}]},
		{hunks: [{oldStart: 1, newStart: 1, lines: [1]}]},
		{hunks: [{oldStart: 1, newStart: 1, lines: ['x'.repeat(20_001)]}]},
		{hunks: Array.from({length: 201}, () => ({oldStart: 1, newStart: 1, lines: []}))},
		{hunks: [0, 1, 2].map(() => ({oldStart: 1, newStart: 1, lines: Array.from({length: 700}, () => '+')}))},
		{hunks: [], created: false},
	]) {
		bad(ui({kind: 'tool-result', toolUseId: 't', isError: false, text: 'ok', patch: p}), JSON.stringify(p).slice(0, 80));
		assert.throws(() => readToolPatch(p), ContractError);
	}
});

test('an agent-message is read with every item type; malformed or oversized items are rejected', () => {
	const patch = {hunks: [{oldStart: 1, newStart: 1, lines: ['-a', '+b']}]};
	same({
		type: 'ui',
		event: {
			kind: 'agent-message',
			agentId: 'agent-1',
			model: 'claude-haiku-4-5',
			items: [
				{type: 'text', text: 'hi'},
				{type: 'thinking', text: 'hmm'},
				{type: 'tool-use', toolUseId: 't1', name: 'Read', input: {file_path: '/x'}},
				{type: 'tool-result', toolUseId: 't1', isError: false, text: 'ok', patch},
			],
		},
	});
	same({type: 'ui', event: {kind: 'agent-message', agentId: 'a', items: []}});
	same({type: 'ui', event: {kind: 'agent-message', agentId: 'a', taskId: 'task-1', items: []}});
	const ok = {kind: 'agent-message', agentId: 'a', items: [{type: 'text', text: 'x'}]};
	for (const event of [
		{...ok, taskId: 7},
		{...ok, taskId: ''},
		{...ok, taskId: 't'.repeat(257)},
		{...ok, agentId: 7},
		{...ok, agentId: 'a'.repeat(257)},
		{...ok, model: 'm'.repeat(257)},
		{...ok, items: 'x'},
		{...ok, items: Array.from({length: 65}, () => ({type: 'text', text: 'x'}))},
		{...ok, items: [{type: 'image', text: 'x'}]},
		{...ok, items: [{type: 'text', text: 3}]},
		{...ok, items: [null]},
		{...ok, items: [{type: 'tool-use', toolUseId: 't'.repeat(257), name: 'Read', input: {}}]},
		{...ok, items: [{type: 'tool-use', toolUseId: 't', name: 'n'.repeat(257), input: {}}]},
		{...ok, items: [{type: 'tool-result', toolUseId: 't', isError: 'no', text: 'x'}]},
		{...ok, items: [{type: 'tool-result', toolUseId: 't', isError: false, text: 'x', patch: {hunks: 'x'}}]},
	]) {
		bad(ui(event));
	}
});

test('an agent-activity event from an older runner is still read', () => {
	same({type: 'ui', event: {kind: 'agent-activity', toolUseId: 'a', name: 'Read', input: {file_path: '/x'}}});
});

test('task events carry the subagent origin fields; bad values are rejected', () => {
	same({
		type: 'ui',
		event: {kind: 'task', id: 'a2', status: 'running', toolUseId: 'tu', taskType: 'local_agent', subagentType: 'Explore', prompt: 'find it', parentTaskId: 'a1', depth: 1},
	});
	for (const extra of [{prompt: 'p'.repeat(16 * 1024 + 1)}, {parentTaskId: ''}, {depth: 1.5}, {subagentType: 's'.repeat(257)}, {prompt: 1}]) {
		bad(ui({kind: 'task', id: 'a2', status: 'running', ...extra}), JSON.stringify(extra).slice(0, 60));
	}
});

test('route-start and route events are read with every field; bad enums are rejected', () => {
	same({type: 'route-start'});
	same({type: 'route', route: {outcome: 'rated', main: 'strong', rated: 'standard', newTask: true, held: true}, previous: 'max', source: 'message'});
	same({type: 'route', route: {outcome: 'kept', failed: true}, source: 'message'});
	same({type: 'route', route: {outcome: 'pinned', main: 'max', pinned: 'max'}, source: 'command'});
	const ev = (route: unknown, extra: Record<string, unknown> = {}) => ({type: 'route', route, source: 'message', ...extra});
	for (const event of [
		ev({outcome: 'maybe'}),
		ev({outcome: 'rated', main: 'huge'}),
		ev({outcome: 'rated', rated: 'MAX'}),
		ev({outcome: 'pinned', pinned: 1}),
		ev({outcome: 'rated', held: 'yes'}),
		ev({outcome: 'kept', failed: 'true'}),
		ev({outcome: 'rated'}, {previous: 'huge'}),
		ev({outcome: 'rated'}, {source: 'robot'}),
		ev('rated'),
	]) {
		bad(event);
	}
});

test('preview rows carry oldNo, newNo and count; old rows with only no are still accepted', () => {
	const base = {kind: 'tool', id: 'p1', seq: 1, toolName: 'Edit', input: {}, cwd: '/app', highlights: [], defaultToNo: false, always: false, oversize: false};
	const withRows = (rows: unknown[]) => ({
		type: 'permission-requested',
		pending: 1,
		request: {...base, preview: {rows, added: 1, removed: 1, truncated: false, approximate: false}},
	});
	const rows = [
		{kind: 'gap', text: '... 3 unchanged lines', count: 3},
		{kind: 'del', text: 'a', no: 4, oldNo: 4},
		{kind: 'add', text: 'b', no: 4, newNo: 4},
		{kind: 'ctx', text: 'c', no: 5, oldNo: 5, newNo: 5},
	];
	const rowsOf = (event: unknown) => (event as {request: {preview: {rows: unknown[]}}}).request.preview.rows;
	assert.deepEqual(rowsOf(readChatEvent(withRows(rows))), rows);
	const old = [{kind: 'del', text: 'a', no: 4}];
	assert.deepEqual(rowsOf(readChatEvent(withRows(old))), old);
	bad(withRows([{kind: 'add', text: 'x', newNo: 'one'}]));
	bad(withRows([{kind: 'gap', text: '', count: 'x'}]));
	assert.deepEqual(readPermissionRequest(withRows(rows).request), withRows(rows).request);
});

test('tool timing fields are read, events without them stay valid, bad values are rejected', () => {
	same({type: 'ui', event: {kind: 'tool-use', toolUseId: 't', name: 'Bash', input: {}, at: 1_700_000_000_000}});
	same({type: 'ui', event: {kind: 'tool-result', toolUseId: 't', isError: false, text: 'ok', durationMs: 1500}});
	same({type: 'ui', event: {kind: 'tool-use', toolUseId: 't', name: 'Bash', input: {}}});
	const useWith = (at: unknown) => ui({kind: 'tool-use', toolUseId: 't', name: 'Bash', input: {}, at});
	const resultWith = (durationMs: unknown) => ui({kind: 'tool-result', toolUseId: 't', isError: false, text: 'ok', durationMs});
	for (const at of ['1', -1, {}, true]) bad(useWith(at), String(at));
	for (const ms of ['1', -1, 604_800_001, {}, [1]]) bad(resultWith(ms), String(ms));
	assert.ok(readChatEvent(resultWith(604_800_000)));
	assert.ok(readChatEvent(resultWith(0)));
});

test('thinking-text duration is read, older events stay valid, bad values are rejected', () => {
	same({type: 'ui', event: {kind: 'thinking-text', text: 'hmm', durationMs: 12_000}});
	same({type: 'ui', event: {kind: 'thinking-text', text: 'hmm'}});
	const event = (durationMs: unknown) => ui({kind: 'thinking-text', text: 'hmm', durationMs});
	for (const ms of ['1', -1, 86_400_001, {}, [1]]) bad(event(ms), String(ms));
	assert.ok(readChatEvent(event(86_400_000)));
});

const summary = {durationMs: 61_000, tools: 3, files: [{path: '/p/a.ts', added: 4, removed: 1, created: true as const}], filesTotal: 1, added: 4, removed: 1, outputTokens: 900};

test('turn-end summary and the context event are read; old events still parse', () => {
	same({type: 'turn-end', outcome: 'ok', summary});
	same({type: 'ui', event: {kind: 'context', used: 5000, limit: 160_000}});
	same({type: 'ui', event: {kind: 'context', used: 1}});
	same({type: 'turn-end', outcome: 'ok'});
});

test('invalid summary and context values fail', () => {
	bad({type: 'turn-end', outcome: 'ok', summary: {...summary, tools: -1}});
	bad({type: 'turn-end', outcome: 'ok', summary: {...summary, durationMs: 'x'}});
	bad({type: 'turn-end', outcome: 'ok', summary: {...summary, files: Array.from({length: 201}, () => summary.files[0])}});
	bad({type: 'turn-end', outcome: 'ok', summary: {...summary, files: [{path: 'x'.repeat(1025), added: 0, removed: 0}]}});
	bad({type: 'turn-end', outcome: 'ok', summary: {...summary, outputTokens: 2e9}});
	bad(ui({kind: 'context', used: 2e8}));
	bad(ui({kind: 'context', used: 1, limit: -5}));
	bad(ui({kind: 'context'}));
});

test('a ui kind this reader does not know gives undefined, not a failure', () => {
	assert.equal(readUiEvent({kind: 'from-the-future', x: 1}), undefined);
	assert.equal(readChatEvent(ui({kind: 'from-the-future', x: 1})), undefined);
	assert.throws(() => readUiEvent({kind: ''}), ContractError);
	assert.throws(() => readUiEvent({}), ContractError);
	assert.throws(() => readUiEvent({kind: 5}), ContractError);
});

test('plan events and plan items are read', () => {
	const items = [{id: '1', content: 'Write tests', activeForm: 'Writing tests', status: 'in_progress'}, {content: 'Docs', status: 'pending'}];
	same({type: 'ui', event: {kind: 'plan', items: items as never}});
	same({type: 'ui', event: {kind: 'plan', items: []}});
	assert.deepEqual(readPlanItems(items), items);
});

test('plan values over the caps or of a bad shape fail', () => {
	const one = (patch: object) => [{content: 'x', status: 'pending', ...patch}];
	for (const items of [
		'nope',
		Array.from({length: 51}, () => ({content: 'x', status: 'pending'})),
		one({status: 'done'}),
		one({content: 'x'.repeat(401)}),
		one({content: 5}),
		one({activeForm: 'x'.repeat(401)}),
		one({id: 'x'.repeat(33)}),
		[null],
	]) {
		bad(ui({kind: 'plan', items}));
		assert.throws(() => readPlanItems(items), ContractError);
	}
	assert.equal(readPlanItems(Array.from({length: 50}, () => ({content: 'x'.repeat(400), status: 'pending'}))).length, 50);
});

test('a permission decision round-trips; prototype keys in answers stay data; over 100 answers fail', () => {
	for (const d of [
		{kind: 'allow'},
		{kind: 'allow', always: true},
		{kind: 'deny', reason: 'no', stop: true},
		{kind: 'answers', answers: {q: 'a'}},
		{kind: 'cancel', cause: 'timeout'},
	] as PermissionDecision[]) {
		assert.deepEqual(readPermissionDecision(JSON.parse(JSON.stringify(d))), d);
	}
	const proto = readPermissionDecision(JSON.parse('{"kind":"answers","answers":{"__proto__":"x","constructor":"y"}}')) as {answers: Record<string, string>};
	assert.equal(Object.getPrototypeOf(proto.answers), Object.prototype);
	assert.equal(Object.keys(proto.answers).length, 2);
	assert.equal(Object.hasOwn(proto.answers, '__proto__'), true);
	const many = Object.fromEntries(Array.from({length: 101}, (_, i) => [`k${i}`, 'v']));
	assert.throws(() => readPermissionDecision({kind: 'answers', answers: many}), ContractError);
	assert.throws(() => readPermissionDecision({kind: 'allow-all'}), ContractError);
});

test('ContractError carries its name, detail and message', () => {
	const err = new ContractError('route must be an object');
	assert.equal(err.name, 'ContractError');
	assert.equal(err.detail, 'route must be an object');
	assert.equal(err.message, 'Invalid chat data: route must be an object');
	assert.ok(err instanceof Error);
	assert.throws(() => readChatEvent('x'), (e: unknown) => e instanceof ContractError && e.detail === 'event must be an object');
});

test('MAX_EVENT_TEXT is 1 MiB and a string one unit over fails', () => {
	assert.equal(MAX_EVENT_TEXT, 1024 * 1024);
	assert.ok(readChatEvent({type: 'sent', text: 'x'.repeat(MAX_EVENT_TEXT)}));
	bad({type: 'sent', text: 'x'.repeat(MAX_EVENT_TEXT + 1)});
});
