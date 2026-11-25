import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {ShellRun} from '../../src/contract/shell-context.js';
import {styledCells, stripStyles, withColorDepth, type ColorDepth} from '../../src/kit.js';
import {formatShellBlock, SHELL_OUTPUT_ROWS} from '../../src/ui/shell-block.js';

const run = (extra: Partial<ShellRun> = {}): ShellRun => ({command: 'ls -la', stdout: '', stderr: '', outcome: 'exited', exitCode: 0, truncated: false, ms: 200, ...extra});
const plain = (s: string) => s;
const text = (r: ShellRun, width = 80) => withColorDepth('none', () => formatShellBlock(r, plain, width).map(stripStyles));

test('a successful run is a header and its output, with no exit row', () => {
	const rows = text(run({stdout: 'a\nb'}));
	assert.equal(rows[0], '! ls -la');
	assert.deepEqual(rows.slice(1), ['  │ a', '  │ b']);
});

test('a run without output says so', () => {
	assert.deepEqual(text(run()).slice(1), ['  (no output)']);
});

test('a slow run shows its duration at the right edge', () => {
	const rows = text(run({ms: 8200}), 30);
	assert.equal(rows[0]?.length, 30);
	assert.ok(rows[0]?.endsWith('8.2s'));
});

test('every outcome ends with its row', () => {
	assert.equal(text(run({exitCode: 2, stderr: 'bad'})).at(-1), '  exit 2');
	assert.equal(text(run({outcome: 'stopped', exitCode: undefined})).at(-1), '  stopped');
	assert.equal(text(run({outcome: 'timed-out', exitCode: undefined})).at(-1), '  timed out after 120s');
	assert.equal(text(run({outcome: 'failed', exitCode: undefined, error: 'could not start the shell (ENOENT)'})).at(-1), '  failed: could not start the shell (ENOENT)');
	assert.equal(text(run({exitCode: undefined, signal: 'SIGKILL'})).at(-1), '  killed by SIGKILL');
});

test('long output keeps its tail', () => {
	const stdout = Array.from({length: 50}, (_, i) => `line ${i}`).join('\n');
	const rows = text(run({stdout}));
	assert.equal(rows.length, 1 + SHELL_OUTPUT_ROWS);
	assert.ok(rows[1]?.includes('earlier lines'));
	assert.ok(rows.at(-1)?.includes('line 49'));
});

test('the command and the output are scrubbed', () => {
	const scrub = (s: string) => s.split('TOPSECRET').join('[x]');
	const rows = withColorDepth('none', () => formatShellBlock(run({command: 'echo TOPSECRET\nnext', stdout: 'TOPSECRET'}), scrub, 60).map(stripStyles));
	assert.ok(!rows.join('\n').includes('TOPSECRET'));
	assert.equal(rows[0], '! echo [x] next');
});

test('rows stay within the width at every depth and in ascii', () => {
	const hostile = run({command: `${'cmd '.repeat(60)}\u001b[31m`, stdout: `${'x'.repeat(300)}\n\u001b[2Jwide 世界世界世界`, stderr: 'e'.repeat(200), exitCode: 130, ms: 3_600_000});
	for (const width of [1, 5, 20, 50, 160]) {
		for (const depth of ['truecolor', '256', '16', 'none'] as ColorDepth[]) {
			for (const ascii of [false, true]) {
				const rows = withColorDepth(depth, () => formatShellBlock(hostile, plain, width, {ascii, depth}));
				for (const row of rows) {
					assert.ok(styledCells(row) <= width, `${width} ${depth}: ${stripStyles(row)}`);
					assert.ok(!row.includes('\u001b[2J'));
				}
			}
		}
	}
});

test('the mark is painted in the shell tone and NO_COLOR leaves plain text', () => {
	const coloured = withColorDepth('256', () => formatShellBlock(run(), plain, 40, {depth: '256'}));
	assert.ok(coloured[0]?.startsWith(`${String.fromCharCode(27)}[38;5;205m!`));
	const none = withColorDepth('none', () => formatShellBlock(run({exitCode: 1}), plain, 40, {depth: 'none'}));
	const colour = new RegExp(String.fromCharCode(27) + '\\[(?:3[0-7]|9[0-7]|4[0-7]|38|48)[;m]');
	assert.ok(none.every(r => !colour.test(r)));
	assert.ok(none.some(r => r.includes('exit 1')));
});
