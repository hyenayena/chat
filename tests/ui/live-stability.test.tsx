import assert from 'node:assert/strict';
import {afterEach, mock, test} from 'node:test';
import React, {createElement} from 'react';
void React;
import {makeScrub} from '../../src/contract/scrub.js';
import {makeReveal} from '../../src/contract/reveal.js';
import type {ShellRun, ShellRunner} from '../../src/contract/shell-context.js';
import {stripStyles} from '../../src/kit.js';
import {SHELL_LIVE_MAX_ROWS} from '../../src/ui/chat-layout.js';
import {ChatView, ESC_AGAIN_HINT, type ChatViewProps} from '../../src/ui/ChatView.js';
import {fakeController, mountHarness, toolReq, type FakeController} from './testkit.js';

const scrub = makeScrub(s => s);
const ESC = '\u001b';
const ENTER = '\r';
const CTRL_B = '\u0002';
const MARKER = 'zq-draft';

let cleanup: Array<() => void> = [];
afterEach(() => {
	for (const fn of cleanup) fn();
	cleanup = [];
});

type Snap = {height: number; fromBottom: number | undefined};

function mount(size: {columns: number; rows: number}, extra: Partial<ChatViewProps> = {}) {
	const controller: FakeController = fakeController();
	const h = mountHarness(createElement(ChatView, {controller, print: () => {}, close() {}, scrub, reveal: makeReveal(s => s), armMs: 5, projectDir: '/app', ...extra}), size);
	cleanup.push(() => h.unmount());
	const snaps: Snap[] = [];
	const snap = async (ms = 25): Promise<Snap> => {
		await h.settle(ms);
		const lines = stripStyles(h.lastFrame()).replace(/\n+$/, '').split('\n');
		const at = lines.findIndex(l => l.includes(MARKER));
		const s = {height: lines.length, fromBottom: at < 0 ? undefined : lines.length - 1 - at};
		snaps.push(s);
		return s;
	};
	return {controller, h, snap, snaps};
}

const SIZES = [
	{columns: 80, rows: 24},
	{columns: 120, rows: 40},
];

for (const size of SIZES) {
	test(`the live area keeps its height and the input its place through a whole turn at ${size.columns}x${size.rows}`, async () => {
		const {controller: c, h, snap} = mount(size);
		await h.settle(40);
		h.press(MARKER);
		const idle = await snap();
		assert.equal(idle.fromBottom, 3, 'bottom rule, hint row and status bar sit under the input');

		const frames: Snap[] = [idle];
		const mark = async (): Promise<Snap> => {
			const s = await snap();
			frames.push(s);
			return s;
		};
		const same = (a: Snap, b: Snap, what: string) => assert.deepEqual(a, b, what);

		c.send('go');
		c.setState('running');
		const started = await mark();
		for (let i = 0; i < 3; i++) c.ui({kind: 'text-delta', text: `line ${i}\n`});
		const small = await mark();
		for (let i = 3; i < 12; i++) c.ui({kind: 'text-delta', text: `line ${i}\n`});
		const stepped = await mark();
		assert.ok(stepped.height >= small.height);

		c.ui({kind: 'tool-use', toolUseId: 't1', name: 'Bash', input: {command: 'ls'}});
		await mark();
		const withTool = frames[frames.length - 1]!;
		c.ui({kind: 'tool-progress', toolUseId: 't1', name: 'Bash', elapsedSeconds: 2});
		same(await mark(), withTool, 'tool progress');
		c.ui({kind: 'tool-result', toolUseId: 't1', isError: false, text: 'a.txt'});
		same(await mark(), withTool, 'tool end');

		c.ui({kind: 'text', messageId: 'm1', text: 'line 0\nline 1\nline 2'});
		same(await mark(), withTool, 'text block end');
		c.ui({kind: 'text-delta', text: 'next\n'});
		same(await mark(), withTool, 'delta after the block end');

		const realNow = Date.now.bind(Date);
		const late = mock.method(Date, 'now', () => realNow() + 11_000);
		h.press(ESC);
		const hinted = await mark();
		late.mock.restore();
		assert.match(stripStyles(h.lastFrame()), new RegExp(ESC_AGAIN_HINT));
		same(hinted, withTool, 'key hint');

		(c as FakeController & {backgroundTasks?: () => Promise<boolean>}).backgroundTasks = async () => false;
		h.press(CTRL_B);
		const noticed = await mark();
		assert.match(stripStyles(h.lastFrame()), /Nothing is running/);
		same(noticed, withTool, 'notice');

		const before = frames[frames.length - 1]!;
		c.request(toolReq({id: 'r1'}));
		const first = await snap();
		c.request(toolReq({id: 'r2'}));
		const second = await snap();
		assert.equal(first.fromBottom, undefined, 'prompt frame');
		assert.equal(second.height, first.height, 'both prompt frames');
		c.answerPermission('r1', {behavior: 'allow'} as never);
		const mid = await snap();
		assert.equal(mid.height, second.height, 'the batch keeps its height');
		c.answerPermission('r2', {behavior: 'allow'} as never);
		const after = await mark();
		same(after, before, 'after the prompts');

		const inTurn = frames.slice(1);
		for (let i = 1; i < inTurn.length; i++) assert.ok(inTurn[i]!.height >= inTurn[i - 1]!.height, `shrank at ${i}: ${inTurn.map(f => f.height).join(',')}`);
		for (const f of frames) assert.equal(f.fromBottom, 3, JSON.stringify(f));
		assert.ok(started.height >= idle.height);

		c.setState('idle');
		c.emit({type: 'turn-end', outcome: 'ok'});
		const done = await mark();
		assert.equal(done.height, idle.height, 'the turn end releases the zone');
		assert.equal(done.fromBottom, 3);
	});
}

test('vim NORMAL changes neither the frame height nor the input position', async () => {
	const {h, snap} = mount({columns: 80, rows: 24}, {inputMode: () => 'vim'});
	await h.settle(40);
	h.press(MARKER);
	const insert = await snap();
	h.press(ESC);
	await h.settle(60);
	const normal = await snap();
	assert.match(stripStyles(h.lastFrame()), /-- NORMAL --/);
	assert.deepEqual(normal, insert);
});

test('a shell run reserves its rows at once and its output changes no height', async () => {
	const calls: Array<{output: (t: string) => void}> = [];
	const runShell: ShellRunner = req =>
		new Promise<ShellRun>(resolve => {
			calls.push({output: text => req.onOutput?.('stdout', text)});
			req.signal.addEventListener('abort', () => resolve({command: req.command, stdout: '', stderr: '', outcome: 'stopped', truncated: false, ms: 1}));
		});
	const {h, snap} = mount({columns: 80, rows: 40}, {runShell});
	await h.settle(40);
	const idle = await snap();
	h.press('!sleep 9');
	await h.settle(30);
	h.press(ENTER);
	await h.settle(60);
	h.press(MARKER);
	const started = await snap();
	assert.equal(started.height - idle.height, SHELL_LIVE_MAX_ROWS, 'the run reserves all its rows');
	assert.equal(calls.length, 1);
	for (let i = 0; i < 8; i++) {
		calls[0]!.output(`out ${i}\n`);
		const s = await snap();
		assert.equal(s.height, started.height, `output line ${i}`);
		assert.equal(s.fromBottom, started.fromBottom);
	}
});

for (const size of [{columns: 40, rows: 24}, {columns: 200, rows: 40}]) {
	test(`rows stay inside columns - 1 with a long notice and a key hint at ${size.columns} columns`, async () => {
		const {controller: c, h, snap} = mount(size);
		await h.settle(40);
		h.press(MARKER);
		const idle = await snap();
		c.send('go');
		c.setState('running');
		c.ui({kind: 'text-delta', text: 'a\nb\n'});
		const realNow = Date.now.bind(Date);
		const late = mock.method(Date, 'now', () => realNow() + 11_000);
		h.press(ESC);
		const hinted = await snap();
		late.mock.restore();
		assert.equal(hinted.fromBottom, idle.fromBottom);
		for (const line of stripStyles(h.lastFrame()).split('\n')) assert.ok([...line].length <= size.columns - 1, `${line.length}: ${line}`);
	});
}
