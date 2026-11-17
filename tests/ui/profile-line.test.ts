import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {ChatEvent, ChatProfile, UiEvent} from '../../src/public.js';
import {checkProfile} from '../../src/public.js';
import {styledCells, stripStyles, withColorDepth} from '../../src/kit.js';
import {formatOut, formatProfileLine} from '../../src/ui/present.js';
import {initialTranscript, markInterrupting, reduceTranscript, type Out, type TranscriptState} from '../../src/ui/transcript.js';

const profile: ChatProfile = checkProfile({
	id: 'clan',
	owner: 'clan',
	appendSystemPrompt: 'Moderate.',
	mainTools: ['Agent', 'SendMessage'],
	agents: {
		skeptic: {description: 'd', prompt: 'p', label: 'Skeptic', tone: 'orange'},
		dreamer: {description: 'd', prompt: 'p', label: 'Dreamer', tone: 'violet'},
	},
	passWord: 'PASS',
});

const ui = (event: UiEvent): ChatEvent => ({type: 'ui', event});

function run(events: ChatEvent[], withProfile = true): {state: TranscriptState; out: Out[]} {
	let state = initialTranscript(withProfile ? {profile} : {});
	const out: Out[] = [];
	for (const e of events) {
		const step = reduceTranscript(state, e);
		state = step.state;
		out.push(...step.out);
	}
	return {state, out};
}

const spawn = (id: string, type: string, extra: Record<string, unknown> = {}): ChatEvent =>
	ui({kind: 'tool-use', toolUseId: id, name: 'Agent', input: {subagent_type: type, prompt: 'cue', ...extra}});
const said = (agentId: string, text: string, taskId?: string): ChatEvent =>
	ui({kind: 'agent-message', agentId, ...(taskId !== undefined && {taskId}), items: [{type: 'text', text}]});
const result = (id: string, text: string, isError = false): ChatEvent => ui({kind: 'tool-result', toolUseId: id, isError, text});
const kinds = (out: Out[]) => out.map(o => o.kind);

test('a foreground Agent result becomes the persona line and no tool card', () => {
	const {out} = run([spawn('a1', 'skeptic'), said('a1', 'Prove it.'), result('a1', 'Prove it.')]);
	assert.deepEqual(out, [{kind: 'profile-line', agent: 'skeptic', text: 'Prove it.'}]);
});

test('the last agent text wins over earlier ones and over the result text', () => {
	const {out} = run([spawn('a1', 'skeptic'), said('a1', 'First'), said('a1', 'Second'), result('a1', 'wrapper text')]);
	assert.deepEqual(out, [{kind: 'profile-line', agent: 'skeptic', text: 'Second'}]);
});

test('without agent text the tool result text is the line', () => {
	const {out} = run([spawn('a1', 'dreamer'), result('a1', 'Imagine!')]);
	assert.deepEqual(out, [{kind: 'profile-line', agent: 'dreamer', text: 'Imagine!'}]);
});

test('a SendMessage with a running task finishes on the task event', () => {
	const {out, state} = run([
		spawn('a1', 'skeptic'),
		result('a1', 'ok'),
		ui({kind: 'tool-use', toolUseId: 's1', name: 'SendMessage', input: {to: 'skeptic', message: 'cue'}}),
		ui({kind: 'task', id: 't1', status: 'running', toolUseId: 's1', subagentType: 'skeptic', background: true}),
		result('s1', 'queued'),
		said('a1', 'Still unconvinced.', 't1'),
	]);
	assert.deepEqual(kinds(out), ['profile-line']);
	assert.equal(state.profile?.calls.size, 1);
	const done = reduceTranscript(state, ui({kind: 'task', id: 't1', status: 'completed', toolUseId: 's1', background: true}));
	assert.deepEqual(done.out, [{kind: 'profile-line', agent: 'skeptic', text: 'Still unconvinced.'}]);
	assert.equal(done.state.profile?.calls.size, 0);
});

test('PASS and PASS: reason print nothing', () => {
	assert.deepEqual(run([spawn('a1', 'skeptic'), said('a1', 'PASS'), result('a1', 'PASS')]).out, []);
	assert.deepEqual(run([spawn('a1', 'skeptic'), said('a1', 'PASS: nothing to add'), result('a1', 'x')]).out, []);
	assert.deepEqual(run([spawn('a1', 'skeptic'), result('a1', ' PASS ')]).out, []);
});

test('a non-profile Agent call, or any call without a profile, is unaffected', () => {
	const other = run([spawn('a1', 'Explore'), said('a1', 'found'), result('a1', 'found')]);
	assert.deepEqual(kinds(other.out), ['tool']);
	const none = run([spawn('a1', 'skeptic'), result('a1', 'Hi')], false);
	assert.deepEqual(kinds(none.out), ['tool']);
});

test('an error result keeps the tool card and prints no line', () => {
	const {out, state} = run([spawn('a1', 'skeptic'), said('a1', 'half'), result('a1', 'Agent failed', true)]);
	assert.deepEqual(kinds(out), ['tool']);
	assert.equal(state.profile?.calls.size, 0);
});

test('a pending call with text is flushed on sent and on turn-end; one without text is dropped', () => {
	const sent = run([spawn('a1', 'skeptic', {run_in_background: true}), ui({kind: 'task', id: 't1', status: 'running', toolUseId: 'a1'}), result('a1', 'launched'), said('a1', 'Late line'), {type: 'sent', text: 'next'}]);
	assert.deepEqual(sent.out, [{kind: 'profile-line', agent: 'skeptic', text: 'Late line'}]);
	const ended = run([spawn('a1', 'skeptic', {run_in_background: true}), ui({kind: 'task', id: 't1', status: 'running', toolUseId: 'a1'}), result('a1', 'launched'), {type: 'turn-end', outcome: 'ok'}]);
	assert.deepEqual(ended.out, []);
	assert.equal(ended.state.profile?.calls.size, 0);
});

test('a persona task notice does not print a background task row', () => {
	const {out} = run([spawn('a1', 'skeptic', {run_in_background: true}), ui({kind: 'task', id: 't1', status: 'running', toolUseId: 'a1', background: true}), result('a1', 'launched'), said('a1', 'Done.'), ui({kind: 'task', id: 't1', status: 'completed', toolUseId: 'a1', background: true})]);
	assert.deepEqual(kinds(out), ['profile-line']);
});

test('formatProfileLine keeps every row within the width at 50, 100 and 160 columns', () => {
	const text = `${'word '.repeat(80)}\n\n- item one\n- item two\n\n\`\`\`ts\nconst x = 1;\n\`\`\``;
	for (const columns of [50, 100, 160]) {
		for (const depth of ['truecolor', 'none'] as const) {
			const rows = withColorDepth(depth, () => formatProfileLine({label: 'Skeptic', tone: 'orange', text}, s => s, columns - 1).split('\n'));
			for (const row of rows) assert.ok(styledCells(row) <= columns - 1, `${columns}: ${stripStyles(row)}`);
			assert.ok(stripStyles(rows[0]!).startsWith('● Skeptic'));
			assert.ok(rows.slice(1).every(r => r === '' || r.startsWith('  ')));
		}
	}
});

test('the label is scrubbed and truncated, the text capped to 40 rows', () => {
	const rows = formatProfileLine({label: 'X'.repeat(100), tone: 'teal', text: Array.from({length: 100}, (_, i) => `line ${i}`).join('\n\n')}, s => s.replace('secret', '***'), 30).split('\n');
	assert.ok(styledCells(rows[0]!) <= 30);
	assert.ok(rows.length <= 41);
	assert.match(stripStyles(rows.at(-1)!), /… \+\d+ lines/);
	assert.ok(!formatProfileLine({label: 'secret', tone: 'teal', text: 'secret'}, s => s.replace(/secret/g, '***'), 40).includes('secret'));
});

test('formatOut paints the persona with the label and tone of the profile', () => {
	withColorDepth('truecolor', () => {
		const line = formatOut({kind: 'profile-line', agent: 'dreamer', text: 'Hi'}, s => s, s => s, 60, profile);
		assert.ok(stripStyles(line).startsWith('● Dreamer'));
		const orange = formatOut({kind: 'profile-line', agent: 'skeptic', text: 'Hi'}, s => s, s => s, 60, profile);
		assert.notEqual(line.split('\n')[0], orange.split('\n')[0]);
		const unknown = formatOut({kind: 'profile-line', agent: 'ghost', text: 'Hi'}, s => s, s => s, 60);
		assert.ok(stripStyles(unknown).startsWith('● ghost'));
	});
});

test('isProfileEvent and pendingPersonas follow the tracked calls', async () => {
	const {isProfileEvent, pendingPersonas} = await import('../../src/ui/profile-calls.js');
	const {state} = run([spawn('a1', 'skeptic'), spawn('a2', 'dreamer'), spawn('a3', 'skeptic'), spawn('x1', 'Explore')]);
	const t = state.profile!;
	assert.deepEqual(pendingPersonas(t), ['skeptic', 'dreamer']);
	const ev = (e: UiEvent) => isProfileEvent(t, e);
	assert.equal(ev({kind: 'tool-use', toolUseId: 'n', name: 'Agent', input: {subagent_type: 'dreamer'}}), true);
	assert.equal(ev({kind: 'tool-use', toolUseId: 'n', name: 'Agent', input: {subagent_type: 'Explore'}}), false);
	assert.equal(ev({kind: 'tool-use', toolUseId: 'n', name: 'SendMessage', input: {to: 'skeptic'}}), true);
	assert.equal(ev({kind: 'tool-result', toolUseId: 'a1', isError: false, text: ''}), true);
	assert.equal(ev({kind: 'tool-result', toolUseId: 'x1', isError: false, text: ''}), false);
	assert.equal(ev({kind: 'agent-message', agentId: 'a2', items: []}), true);
	assert.equal(ev({kind: 'task', id: 't9', status: 'running', subagentType: 'dreamer'}), true);
	assert.equal(ev({kind: 'task', id: 't9', status: 'running', subagentType: 'Explore'}), false);
	assert.equal(ev({kind: 'text-delta', text: 'x'}), false);
});

test('an interrupt drops the pending calls without a line; a late result prints nothing', () => {
	const dropped = run([spawn('a1', 'skeptic'), said('a1', 'Half'), {type: 'turn-end', outcome: 'interrupted'}, result('a1', 'Half')]);
	assert.deepEqual(dropped.out.filter(o => o.kind === 'profile-line' || o.kind === 'tool'), []);
	assert.equal(dropped.state.profile?.calls.size, 0);
	const marked = run([spawn('a1', 'skeptic'), said('a1', 'Half')]);
	assert.equal(markInterrupting({...marked.state, phase: 'running'}).profile?.calls.size, 0);
	const normal = run([spawn('a1', 'skeptic'), said('a1', 'Done'), {type: 'turn-end', outcome: 'ok'}]);
	assert.deepEqual(normal.out.filter(o => o.kind === 'profile-line'), [{kind: 'profile-line', agent: 'skeptic', text: 'Done'}]);
});
