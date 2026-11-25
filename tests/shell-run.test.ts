import assert from 'node:assert/strict';
import {mkdtempSync, realpathSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {after, before, test} from 'node:test';
import type {ShellRun} from '../src/contract/shell-context.js';
import {createShellRunner} from '../src/shell-run.js';
import {makeFakeLog} from './helpers/fake-log.js';

let cwd = '';
before(() => {
	cwd = realpathSync(mkdtempSync(join(tmpdir(), 'chat-shell-')));
});
after(() => rmSync(cwd, {recursive: true, force: true}));

const runner = (extra: Partial<Parameters<typeof createShellRunner>[0]> = {}) => {
	const log = makeFakeLog();
	return {log, run: createShellRunner({cwd, log, ...extra})};
};
const go = (run: ReturnType<typeof runner>['run'], command: string, signal = new AbortController().signal): Promise<ShellRun> => run({command, signal});
const alive = (pid: number): boolean => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};

test('stdout, stderr and the exit code come back, run in the given directory', async () => {
	const {run} = runner();
	const ok = await go(run, 'pwd; echo err >&2');
	assert.equal(ok.outcome, 'exited');
	assert.equal(ok.exitCode, 0);
	assert.equal(ok.stdout, cwd);
	assert.equal(ok.stderr, 'err');
	const bad = await go(run, 'exit 3');
	assert.equal(bad.exitCode, 3);
	assert.equal(bad.outcome, 'exited');
});

test('secrets and the agent socket are not visible to the child', async () => {
	const {run} = runner({env: {PATH: process.env.PATH, HOME: '/root', YENA_TEST_API_KEY: 'k', SSH_AUTH_SOCK: '/s', PLAIN: 'p'}});
	const out = await go(run, 'echo "[$YENA_TEST_API_KEY][$SSH_AUTH_SOCK][$PLAIN]"');
	assert.equal(out.stdout, '[][][p]');
});

test('the child has no stdin', async () => {
	const {run} = runner();
	const out = await go(run, 'cat; echo done');
	assert.equal(out.stdout, 'done');
});

test('output is passed on while the command runs', async () => {
	const {run} = runner();
	const seen: string[] = [];
	const out = await run({command: 'echo one; echo two >&2', signal: new AbortController().signal, onOutput: (stream, text) => seen.push(`${stream}:${text.trim()}`)});
	assert.deepEqual(seen.sort(), ['stderr:two', 'stdout:one']);
	assert.equal(out.stdout, 'one');
});

test('a command over the timeout is stopped and reported as timed out', async () => {
	const {run} = runner({timeoutMs: 100, killGraceMs: 100});
	const out = await go(run, 'sleep 30');
	assert.equal(out.outcome, 'timed-out');
	assert.ok(out.ms < 5000);
});

test('an abort stops the whole process group', async () => {
	const {run} = runner({killGraceMs: 200});
	const controller = new AbortController();
	const pending = go(run, 'sleep 30 & echo $!; wait', controller.signal);
	await new Promise(r => setTimeout(r, 300));
	controller.abort();
	const out = await pending;
	assert.equal(out.outcome, 'stopped');
	const pid = Number(out.stdout.trim());
	assert.ok(pid > 0);
	await new Promise(r => setTimeout(r, 100));
	assert.equal(alive(pid), false);
});

test('a command that ignores SIGTERM is killed after the grace period', async () => {
	const {run} = runner({killGraceMs: 150});
	const controller = new AbortController();
	const pending = go(run, "trap '' TERM; while :; do sleep 0.1; done", controller.signal);
	await new Promise(r => setTimeout(r, 200));
	controller.abort();
	const out = await pending;
	assert.equal(out.outcome, 'stopped');
	assert.ok(out.ms < 5000);
});

test('an already aborted signal runs nothing', async () => {
	const {run} = runner();
	const controller = new AbortController();
	controller.abort();
	const out = await go(run, 'echo hi', controller.signal);
	assert.equal(out.outcome, 'stopped');
	assert.equal(out.stdout, '');
});

test('a background child that holds the pipes does not keep the run open', async () => {
	const {run} = runner();
	const started = Date.now();
	const out = await go(run, 'sleep 3 & echo started');
	assert.equal(out.outcome, 'exited');
	assert.equal(out.stdout, 'started');
	assert.ok(Date.now() - started < 2500);
});

test('a missing directory is a failed start', async () => {
	const {run, log} = runner({cwd: join(cwd, 'missing')});
	const out = await go(run, 'echo hi');
	assert.equal(out.outcome, 'failed');
	assert.match(out.error ?? '', /could not start the shell/);
	assert.ok(!(out.error ?? '').includes(cwd));
	assert.equal(log.records.at(-1)?.fields.errClass, 'Error');
});

test('long output is truncated and flagged', async () => {
	const {run} = runner();
	const out = await go(run, 'i=0; while [ $i -lt 2000 ]; do echo "line $i"; i=$((i+1)); done');
	assert.equal(out.truncated, true);
	assert.ok(out.stdout.length < 20_000);
	assert.ok(out.stdout.includes('line 0'));
	assert.ok(out.stdout.includes('line 1999'));
	assert.match(out.stdout, /omitted/);
});

test('a very long line is split rather than held in memory', async () => {
	const {run} = runner();
	const out = await go(run, 'head -c 100000 /dev/zero | tr "\\0" x; echo');
	assert.equal(out.truncated, true);
	assert.ok(out.stdout.length < 20_000);
});

test('the log holds counts only, never the command or its output', async () => {
	const {run, log} = runner();
	await go(run, 'echo TOPSECRET-OUT; echo TOPSECRET-ERR >&2');
	const text = JSON.stringify(log.records);
	assert.ok(!text.includes('TOPSECRET'));
	assert.ok(!text.includes('echo'));
	const record = log.records.at(-1);
	assert.equal(record?.msg, 'shell run');
	assert.equal(record?.fields.exitCode, 0);
	assert.equal(typeof record?.fields.ms, 'number');
	assert.ok(Number(record?.fields.outputChars) > 0);
});
