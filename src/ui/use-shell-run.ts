import {useCallback, useEffect, useRef, useState} from 'react';
import type {PrintOptions} from '../../../../src/api.js';
import {frameClock} from '../kit.js';
import type {ShellRun, ShellRunner} from '../contract/shell-context.js';
import {formatShellBlock} from './shell-block.js';
import {addPending, EMPTY_LIVE, pendingContext, pushLive, type LiveLines} from './shell-mode.js';
import type {Scrub} from './tool-args.js';

export const LIVE_THROTTLE_MS = 250;

export type RunningShell = {command: string; startedAt: number; live: LiveLines};

export type ShellControls = {
	running: RunningShell | undefined;
	pending: number;
	start(command: string): void;
	active(): boolean;
	stop(): boolean;
	peekContext(): string | undefined;
	consumeContext(): void;
};

export type ShellRunOptions = {
	runShell: ShellRunner | undefined;
	print: (text: string, options?: PrintOptions) => void;
	scrub: Scrub;
	columns: () => number;
};

const failedRun = (command: string, startedAt: number): ShellRun => ({
	command,
	stdout: '',
	stderr: '',
	outcome: 'failed',
	error: 'the shell run failed',
	truncated: false,
	ms: Math.max(0, Date.now() - startedAt),
});

export function useShellRun(o: ShellRunOptions): ShellControls {
	const latest = useRef(o);
	latest.current = o;
	const runningRef = useRef<{view: RunningShell; controller: AbortController} | undefined>(undefined);
	const pendingRef = useRef<ShellRun[]>([]);
	const timerRef = useRef<(() => void) | undefined>(undefined);
	const aliveRef = useRef(true);
	const [, setTick] = useState(0);
	const bump = useCallback(() => setTick(n => n + 1), []);

	useEffect(() => {
		aliveRef.current = true;
		return () => {
			aliveRef.current = false;
			timerRef.current?.();
			runningRef.current?.controller.abort();
		};
	}, []);

	const start = useCallback(
		(command: string) => {
			const {runShell} = latest.current;
			if (!runShell || runningRef.current) return;
			const controller = new AbortController();
			const startedAt = Date.now();
			const entry = {view: {command, startedAt, live: EMPTY_LIVE}, controller};
			runningRef.current = entry;
			bump();
			const finish = (run: ShellRun) => {
				if (runningRef.current === entry) runningRef.current = undefined;
				timerRef.current?.();
				timerRef.current = undefined;
				if (!aliveRef.current) return;
				pendingRef.current = addPending(pendingRef.current, run);
				const {print, scrub, columns} = latest.current;
				const rows = (w: number) => formatShellBlock(run, scrub, Math.max(1, w), {});
				print(rows(Math.max(1, columns() - 1)).join('\n'), {render: w => rows(w - 1).join('\n')});
				bump();
			};
			const onOutput = (_stream: 'stdout' | 'stderr', text: string) => {
				if (runningRef.current !== entry) return;
				entry.view = {...entry.view, live: pushLive(entry.view.live, text)};
				timerRef.current ??= frameClock.schedule(() => {
					timerRef.current = undefined;
					if (aliveRef.current && runningRef.current === entry) bump();
				}, LIVE_THROTTLE_MS);
			};
			let result: Promise<ShellRun>;
			try {
				result = runShell({command, signal: controller.signal, onOutput});
			} catch {
				result = Promise.resolve(failedRun(command, startedAt));
			}
			result.then(finish, () => finish(failedRun(command, startedAt)));
		},
		[bump],
	);

	const active = useCallback((): boolean => runningRef.current !== undefined, []);

	const stop = useCallback((): boolean => {
		const entry = runningRef.current;
		if (!entry || entry.controller.signal.aborted) return entry !== undefined;
		entry.controller.abort();
		return true;
	}, []);

	const peekContext = useCallback((): string | undefined => pendingContext(pendingRef.current, latest.current.scrub), []);

	const consumeContext = useCallback(() => {
		if (pendingRef.current.length === 0) return;
		pendingRef.current = [];
		bump();
	}, [bump]);

	return {
		running: runningRef.current?.view,
		pending: pendingRef.current.length,
		start,
		active,
		stop,
		peekContext,
		consumeContext,
	};
}
