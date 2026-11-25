import assert from 'node:assert/strict';
import {test} from 'node:test';
import {SHELL_LIMITS, type ShellRun} from '../../src/contract/shell-context.js';
import {addPending, EMPTY_LIVE, isShellLine, LIVE_LINE_CHARS, LIVE_LINES, pendingContext, pushLive, shellCommandOf} from '../../src/ui/shell-mode.js';

const run = (command: string): ShellRun => ({command, stdout: '', stderr: '', outcome: 'exited', exitCode: 0, truncated: false, ms: 1});

test('only text that starts with ! is a shell line', () => {
	assert.equal(isShellLine('!ls'), true);
	assert.equal(isShellLine(' !ls'), false);
	assert.equal(isShellLine('ls !'), false);
	assert.equal(shellCommandOf('!  ls -la  '), 'ls -la');
	assert.equal(shellCommandOf('!'), '');
});

test('pending runs keep the newest ones', () => {
	let list: ShellRun[] = [];
	for (let i = 0; i < SHELL_LIMITS.pendingRuns + 3; i++) list = addPending(list, run(`c${i}`));
	assert.equal(list.length, SHELL_LIMITS.pendingRuns);
	assert.equal(list[0]?.command, 'c3');
	assert.equal(pendingContext([], s => s), undefined);
	assert.ok(pendingContext(list, s => s)?.includes('<bash-input>c10</bash-input>'));
});

test('the live ring joins chunks of one line and keeps the last lines, each clipped', () => {
	let live = pushLive(EMPTY_LIVE, 'par');
	live = pushLive(live, 'tial\nnext\n');
	assert.deepEqual(live.lines, ['partial', 'next']);
	assert.equal(live.open, false);
	live = pushLive(live, 'x'.repeat(5000));
	assert.equal(live.lines.at(-1)?.length, LIVE_LINE_CHARS);
	for (let i = 0; i < 50; i++) live = pushLive(live, `l${i}\r\n`);
	assert.equal(live.lines.length, LIVE_LINES);
	assert.equal(live.lines.at(-1), 'l49');
	assert.equal(pushLive(live, ''), live);
});
