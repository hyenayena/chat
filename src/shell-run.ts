import {spawn as nodeSpawn, type ChildProcess} from 'node:child_process';
import {StringDecoder} from 'node:string_decoder';
import type {Logger} from '../../../src/api.js';
import {MAX_DURATION_MS} from './contract/turn-stats.js';
import {SHELL_LIMITS, type ShellOutcome, type ShellRun, type ShellRunner} from './contract/shell-context.js';
import {createCapture, scrubSecretEnv, type Capture} from './kit.js';
import {errClass} from './log.js';

const LINE_MAX = 4096;
const PIPE_GRACE_MS = 500;

export type ShellRunnerOptions = {
	cwd: string;
	log: Logger;
	env?: NodeJS.ProcessEnv;
	timeoutMs?: number;
	killGraceMs?: number;
	spawn?: typeof nodeSpawn;
};

type Lines = {write: (chunk: Buffer) => string; end: () => void; capture: Capture};

function lineSplitter(): Lines {
	const capture = createCapture({chars: SHELL_LIMITS.streamChars, lines: SHELL_LIMITS.streamLines});
	const decoder = new StringDecoder('utf8');
	let pending = '';
	const take = (text: string) => {
		pending += text;
		let at = pending.indexOf('\n');
		while (at !== -1) {
			capture.push(pending.slice(0, at).replace(/\r$/, ''));
			pending = pending.slice(at + 1);
			at = pending.indexOf('\n');
		}
		if (pending.length > LINE_MAX) {
			capture.push(pending);
			pending = '';
		}
	};
	return {
		capture,
		write(chunk) {
			const text = decoder.write(chunk);
			take(text);
			return text;
		},
		end() {
			take(decoder.end());
			if (pending) capture.push(pending);
			pending = '';
		},
	};
}

export function createShellRunner(o: ShellRunnerOptions): ShellRunner {
	const spawn = o.spawn ?? nodeSpawn;
	const timeoutMs = o.timeoutMs ?? SHELL_LIMITS.timeoutMs;
	const graceMs = o.killGraceMs ?? SHELL_LIMITS.killGraceMs;

	return req =>
		new Promise<ShellRun>(resolve => {
			const startedAt = Date.now();
			const out = lineSplitter();
			const err = lineSplitter();
			let child: ChildProcess | undefined;
			let exited = false;
			let closed = false;
			let finished = false;
			let stopping = false;
			let aborted = false;
			let timedOut = false;
			let exitCode: number | undefined;
			let signal: string | undefined;
			let spawnError: string | undefined;
			let spawnErrClass: string | undefined;
			let timeoutTimer: NodeJS.Timeout | undefined;
			let killTimer: NodeJS.Timeout | undefined;
			let pipeTimer: NodeJS.Timeout | undefined;

			const killGroup = (sig: NodeJS.Signals) => {
				const pid = child?.pid;
				if (pid === undefined) return;
				try {
					process.kill(-pid, sig);
				} catch {
					try {
						child?.kill(sig);
					} catch {
						// already gone
					}
				}
			};

			const stop = () => {
				if (stopping || exited || closed || child?.pid === undefined) return;
				stopping = true;
				killGroup('SIGTERM');
				killTimer = setTimeout(() => killGroup('SIGKILL'), graceMs);
				killTimer.unref();
			};

			const onAbort = () => {
				if (exited || closed) return;
				aborted = true;
				stop();
			};

			const finish = () => {
				if (finished) return;
				finished = true;
				clearTimeout(timeoutTimer);
				clearTimeout(pipeTimer);
				if (closed) clearTimeout(killTimer);
				req.signal.removeEventListener('abort', onAbort);
				if (!closed) {
					child?.stdout?.destroy();
					child?.stderr?.destroy();
				}
				out.end();
				err.end();
				const failed = spawnError !== undefined;
				const outcome: ShellOutcome = failed ? 'failed' : timedOut ? 'timed-out' : aborted ? 'stopped' : 'exited';
				const stdout = out.capture.text();
				const stderr = err.capture.text();
				const ms = Math.min(MAX_DURATION_MS, Math.max(0, Date.now() - startedAt));
				const truncated = out.capture.truncated || err.capture.truncated;
				o.log.info('shell run', {
					exitCode: exitCode ?? null,
					ms,
					outputChars: stdout.length + stderr.length,
					truncated,
					aborted,
					timedOut,
					...(failed && {errClass: spawnErrClass}),
				});
				resolve({
					command: req.command,
					stdout,
					stderr,
					outcome,
					...(exitCode !== undefined && {exitCode}),
					...(signal !== undefined && {signal}),
					...(spawnError !== undefined && {error: spawnError}),
					truncated,
					ms,
				});
			};

			if (req.signal.aborted) {
				aborted = true;
				finish();
				return;
			}

			try {
				child = spawn('sh', ['-c', req.command], {
					cwd: o.cwd,
					env: scrubSecretEnv(o.env ?? process.env),
					detached: true,
					stdio: ['ignore', 'pipe', 'pipe'],
				});
			} catch (e) {
				spawnError = 'could not start the shell';
				spawnErrClass = errClass(e);
				finish();
				return;
			}

			const feed = (lines: Lines, stream: 'stdout' | 'stderr') => (chunk: Buffer) => {
				const text = lines.write(chunk);
				if (text) req.onOutput?.(stream, text);
			};
			child.stdout?.on('data', feed(out, 'stdout'));
			child.stderr?.on('data', feed(err, 'stderr'));
			child.stdout?.on('error', () => {});
			child.stderr?.on('error', () => {});
			child.on('error', e => {
				if (child?.pid !== undefined) return;
				const code = (e as NodeJS.ErrnoException).code;
				spawnError = `could not start the shell${code ? ` (${code})` : ''}`;
				spawnErrClass = errClass(e);
				closed = true;
				finish();
			});
			child.on('exit', (code, sig) => {
				exited = true;
				if (code !== null) exitCode = code;
				if (sig !== null) signal = sig;
				pipeTimer = setTimeout(finish, PIPE_GRACE_MS);
			});
			child.on('close', () => {
				closed = true;
				finish();
			});
			timeoutTimer = setTimeout(() => {
				timedOut = true;
				stop();
			}, timeoutMs);
			req.signal.addEventListener('abort', onAbort, {once: true});
		});
}
