import assert from 'node:assert/strict';
import {afterEach, test} from 'node:test';
import React, {createElement} from 'react';
void React;
import {makeScrub} from '../../src/contract/scrub.js';
import {SHELL_CONTEXT_PREAMBLE, type ShellRun, type ShellRunner} from '../../src/contract/shell-context.js';
import {stripStyles, styledCells} from '../../src/kit.js';
import {ChatView, type ChatViewProps} from '../../src/ui/ChatView.js';
import {fakeController, mountHarness, type FakeController} from './testkit.js';

const SECRET = 'sk-ant-oat-TESTVALUE0123456789abcdef';
const scrub = makeScrub(s => s.split(SECRET).join('[redacted]'));
const ESC = '\u001b';
const ENTER = '\r';
const BACKSPACE = '\u007f';

let cleanup: Array<() => void> = [];
afterEach(() => {
	for (const fn of cleanup) fn();
	cleanup = [];
});

type Sent = {text: string; opts?: {command?: boolean; context?: string}};
type ShellCall = {command: string; signal: AbortSignal; output: (text: string) => void; finish: (extra?: Partial<ShellRun>) => void};

function fakeShell() {
	const calls: ShellCall[] = [];
	const runShell: ShellRunner = req =>
		new Promise<ShellRun>(resolve => {
			calls.push({
				command: req.command,
				signal: req.signal,
				output: text => req.onOutput?.('stdout', text),
				finish: (extra = {}) => resolve({command: req.command, stdout: '', stderr: '', outcome: 'exited', exitCode: 0, truncated: false, ms: 20, ...extra}),
			});
			req.signal.addEventListener('abort', () => resolve({command: req.command, stdout: '', stderr: '', outcome: 'stopped', truncated: false, ms: 20}));
		});
	return {calls, runShell};
}

function setup(extra: Partial<ChatViewProps> = {}, size?: {columns: number; rows: number}) {
	const base: FakeController = fakeController();
	const sends: Sent[] = [];
	const steered: string[] = [];
	const controller = Object.assign(base, {
		sends,
		steered,
		failNext: false,
		send(text: string, opts?: {command?: boolean; context?: string}) {
			if (controller.failNext) {
				controller.failNext = false;
				throw new Error('The chat is not ready');
			}
			sends.push({text, ...(opts && {opts})});
			base.calls.sent.push(text);
			base.emit({type: 'sent', text});
		},
		steer(text: string) {
			steered.push(text);
			base.emit({type: 'sent', text});
		},
	});
	const shell = fakeShell();
	const printed: string[] = [];
	const h = mountHarness(
		createElement(ChatView, {controller, print: s => void printed.push(s), close() {}, scrub, runShell: shell.runShell, ...extra}),
		size,
	);
	cleanup.push(() => h.unmount());
	return {c: controller, shell, printed, ...h};
}

type Rig = ReturnType<typeof setup>;

async function type(t: Rig, text: string) {
	t.press(text);
	await t.settle();
	t.press(ENTER);
	await t.settle();
}

const plain = (t: Rig) => stripStyles(t.lastFrame());

async function ranWith(t: Rig, command: string, extra: Partial<ShellRun> = {}) {
	await type(t, `!${command}`);
	const call = t.shell.calls.at(-1)!;
	call.finish(extra);
	await t.settle();
	return call;
}

test('a typed !line runs the command and never reaches the model', async () => {
	const t = setup();
	await t.settle();
	await type(t, '!ls -la');
	assert.deepEqual(t.shell.calls.map(c => c.command), ['ls -la']);
	assert.deepEqual(t.c.sends, []);
	assert.deepEqual(t.c.steered, []);
	assert.match(plain(t), /ls -la/);
});

test('a finished run is printed as a block', async () => {
	const t = setup();
	await t.settle();
	await ranWith(t, 'echo hi', {stdout: 'hi'});
	const block = stripStyles(t.printed.join('\n'));
	assert.match(block, /! echo hi/);
	assert.match(block, /│ hi/);
	assert.match(plain(t), /1 shell run goes with your next message/);
});

test('a bare ! does nothing and keeps the draft', async () => {
	const t = setup();
	await t.settle();
	await type(t, '!');
	assert.deepEqual(t.shell.calls, []);
	assert.deepEqual(t.c.sends, []);
	assert.match(plain(t), /> !/);
	const u = setup();
	await u.settle();
	await type(u, '!   ');
	assert.deepEqual(u.shell.calls, []);
	assert.deepEqual(u.c.sends, []);
});

test('Backspace on the ! leaves shell mode and the line is a message again', async () => {
	const t = setup();
	await t.settle();
	t.press('!');
	await t.settle();
	t.press(BACKSPACE);
	await t.settle();
	await type(t, 'hi');
	assert.deepEqual(t.c.sends.map(s => s.text), ['hi']);
	assert.deepEqual(t.shell.calls, []);
});

test('a leading space makes it a message, not a shell line', async () => {
	const t = setup();
	await t.settle();
	await type(t, ' !ls');
	assert.deepEqual(t.shell.calls, []);
	assert.deepEqual(t.c.sends.map(s => s.text), ['!ls']);
});

test('a shell line is recalled from the history like any sent line', async () => {
	const t = setup();
	await t.settle();
	await ranWith(t, 'ls');
	t.press(`${ESC}[A`);
	await t.settle();
	assert.match(plain(t), /> !ls/);
});

test('a multi-line or oversized command is refused with a notice', async () => {
	const t = setup();
	await t.settle();
	t.press('!echo one');
	t.press(`${ESC}${ENTER}`);
	t.press('echo two');
	await t.settle();
	t.press(ENTER);
	await t.settle();
	assert.deepEqual(t.shell.calls, []);
	assert.match(plain(t), /A shell command is one line\./);
	const u = setup();
	await u.settle();
	await type(u, `!${'x'.repeat(5000)}`);
	assert.deepEqual(u.shell.calls, []);
	assert.match(plain(u), /A shell command is at most 4096 characters\./);
});

test('without a runner a shell line says so and sends nothing', async () => {
	const t = setup({runShell: undefined});
	await t.settle();
	await type(t, '!ls');
	assert.deepEqual(t.c.sends, []);
	assert.match(plain(t), /Shell commands are not available in this chat\./);
});

test('a second ! while one runs gives a notice and starts nothing', async () => {
	const t = setup();
	await t.settle();
	await type(t, '!sleep 5');
	await type(t, '!ls');
	assert.equal(t.shell.calls.length, 1);
	assert.match(plain(t), /A shell command is already running \(Esc stops it\)\./);
});

test('the next message carries the shell context, the one after it does not', async () => {
	const t = setup();
	await t.settle();
	await ranWith(t, 'echo hi', {stdout: `hi ${SECRET}`});
	await type(t, 'what happened?');
	assert.equal(t.c.sends.length, 1);
	const first = t.c.sends[0]!;
	assert.equal(first.text, 'what happened?');
	assert.ok(first.opts?.context?.startsWith(SHELL_CONTEXT_PREAMBLE));
	assert.ok(first.opts?.context?.includes('<bash-input>echo hi</bash-input>'));
	assert.ok(!first.opts?.context?.includes(SECRET));
	assert.ok(first.opts?.context?.includes('[redacted]'));
	await type(t, 'and again');
	assert.equal(t.c.sends[1]?.opts, undefined);
});

test('a /line keeps the context for the next message', async () => {
	const t = setup();
	await t.settle();
	await ranWith(t, 'ls', {stdout: 'a'});
	await type(t, '/x');
	assert.equal(t.c.sends[0]?.text, '/x');
	assert.equal(t.c.sends[0]?.opts, undefined);
	await type(t, 'next');
	assert.ok(t.c.sends[1]?.opts?.context?.includes('<bash-input>ls</bash-input>'));
});

test('a send that throws keeps the context pending', async () => {
	const t = setup();
	await t.settle();
	await ranWith(t, 'ls', {stdout: 'a'});
	t.c.failNext = true;
	await type(t, 'one');
	assert.equal(t.c.sends.length, 0);
	assert.match(plain(t), /1 shell run goes with your next message/);
	t.press(ENTER);
	await t.settle();
	assert.ok(t.c.sends[0]?.opts?.context?.includes('<bash-input>ls</bash-input>'));
});

test('with a context pending a message during a turn is queued, not steered, and the flush carries the context', async () => {
	const t = setup();
	await t.settle();
	await ranWith(t, 'ls', {stdout: 'a'});
	t.c.setState('running');
	await t.settle();
	await type(t, 'later');
	assert.deepEqual(t.c.steered, []);
	assert.match(plain(t), /queued: later/);
	t.c.setState('idle');
	t.c.emit({type: 'turn-end', outcome: 'ok'});
	await t.settle();
	assert.equal(t.c.sends.length, 1);
	assert.equal(t.c.sends[0]?.text, 'later');
	assert.ok(t.c.sends[0]?.opts?.context?.includes('<bash-input>ls</bash-input>'));
});

test('without a context a message during a turn still steers it', async () => {
	const t = setup();
	await t.settle();
	t.c.setState('running');
	await t.settle();
	await type(t, 'also this');
	assert.deepEqual(t.c.steered, ['also this']);
});

test('Esc stops a running command when idle', async () => {
	const t = setup();
	await t.settle();
	await type(t, '!sleep 30');
	const call = t.shell.calls[0]!;
	t.press(ESC);
	await t.settle();
	assert.equal(call.signal.aborted, true);
	assert.match(stripStyles(t.printed.join('\n')), /stopped/);
	assert.equal(t.c.calls.interrupts, 0);
});

test('Esc during a turn stops the command and does not interrupt or arm the turn', async () => {
	const t = setup();
	await t.settle();
	t.c.setState('running');
	await t.settle();
	await type(t, '!sleep 30');
	t.press(ESC);
	await t.settle();
	assert.equal(t.shell.calls[0]?.signal.aborted, true);
	assert.equal(t.c.calls.interrupts, 0);
	assert.doesNotMatch(plain(t), /Press Esc again to interrupt/);
});

test('Ctrl+C stops a running command instead of closing the chat', async () => {
	const closed = {count: 0};
	const t = setup({close: () => closed.count++});
	await t.settle();
	await type(t, '!sleep 30');
	t.press('\u0003');
	await t.settle();
	assert.equal(t.shell.calls[0]?.signal.aborted, true);
	assert.equal(closed.count, 0);
	assert.equal(t.c.calls.closes, 0);
});

test('unmounting the view aborts a running command', async () => {
	const t = setup();
	await t.settle();
	await type(t, '!sleep 30');
	const call = t.shell.calls[0]!;
	t.unmount();
	assert.equal(call.signal.aborted, true);
});

test('the initial send is text for the model, even when it starts with !', async () => {
	const t = setup({initialSend: '!rm -rf x'});
	await t.settle();
	assert.deepEqual(t.shell.calls, []);
	assert.deepEqual(t.c.sends.map(s => s.text), ['!rm -rf x']);
});

test('a message from the inbox is text for the model, even when it starts with !', async () => {
	let deliver: ((text: string) => void) | undefined;
	const t = setup({onInbox: d => (deliver = d)});
	await t.settle();
	deliver!('!touch pwned');
	await t.settle();
	assert.deepEqual(t.shell.calls, []);
	assert.deepEqual(t.c.sends.map(s => s.text), ['!touch pwned']);
	t.c.setState('running');
	await t.settle();
	deliver!('!touch again');
	await t.settle();
	assert.deepEqual(t.shell.calls, []);
});

test('a queued !line is flushed to the model as text', async () => {
	const t = setup();
	await t.settle();
	t.c.setState('running');
	await t.settle();
	t.c.steered.length = 0;
	Object.assign(t.c, {steer: undefined});
	await type(t, ' !rm x');
	t.c.setState('idle');
	t.c.emit({type: 'turn-end', outcome: 'ok'});
	await t.settle();
	assert.deepEqual(t.shell.calls, []);
	assert.deepEqual(t.c.sends.map(s => s.text), ['!rm x']);
});

test('the live rows never reach the last column', async () => {
	const columns = 40;
	const t = setup({}, {columns, rows: 24});
	await t.settle();
	await type(t, `!${'long-command '.repeat(10)}`);
	t.shell.calls[0]!.output(`${'x'.repeat(200)}\n世界世界世界世界世界世界世界世界世界世界\nsecond line\n`);
	await t.settle(400);
	const rows = plain(t).split('\n');
	assert.ok(rows.some(r => r.includes('long-command')), plain(t));
	assert.ok(rows.some(r => r.includes('second line')));
	for (const row of rows) assert.ok(styledCells(row) <= columns - 1, `${styledCells(row)}: ${row}`);
});

test('an inbox message queued during a turn does not carry the user shell context', async () => {
	let deliver: ((text: string) => void) | undefined;
	const t = setup({onInbox: d => (deliver = d)});
	await t.settle();
	await ranWith(t, 'ls', {stdout: 'a'});
	t.c.setState('running');
	await t.settle();
	Object.assign(t.c, {steer: undefined});
	deliver!('from a module');
	await t.settle();
	t.c.setState('idle');
	t.c.emit({type: 'turn-end', outcome: 'ok'});
	await t.settle();
	assert.equal(t.c.sends[0]?.text, 'from a module');
	assert.equal(t.c.sends[0]?.opts?.context, undefined);
});
