import React, {useMemo, useRef} from 'react';
import {Text} from 'ink';
import {useFrame, useReducedMotion, useSpinner} from './kit.js';
import {pickWorkingVerb} from './present.js';
import {SHIMMER_STEP_MS, chatStatusRow, type StatusInput} from './status-bar.js';

export type ChatStatusBarProps = Omit<StatusInput, 'elapsedMs' | 'quietMs' | 'verb' | 'awaiting'> & {
	pending: number;
	since: number;
	beat?: number;
	lastEventAt?: number;
	columns: number;
	now?: () => number;
};

export function ChatStatusBar({pending, since, beat = 0, lastEventAt, columns, now = Date.now, ...input}: ChatStatusBarProps) {
	const running = input.phase !== 'idle' || input.status !== null;
	const frame = useSpinner(running);
	const reduced = useReducedMotion();
	const ft = useFrame(running, reduced ? 1000 : SHIMMER_STEP_MS);
	const verbRef = useRef<string | undefined>(undefined);
	const verb = useMemo(() => (verbRef.current = pickWorkingVerb(Math.random, verbRef.current)), [since, beat]);
	const t = now();
	const row = chatStatusRow(
		{...input, awaiting: pending > 0, elapsedMs: Math.max(0, t - since), quietMs: lastEventAt === undefined || pending > 0 ? 0 : Math.max(0, t - lastEventAt), verb},
		Math.max(1, columns - 1),
		{frame, ...(running && !reduced && {glint: Math.floor(ft / SHIMMER_STEP_MS)})},
	);
	return <Text wrap="truncate">{row}</Text>;
}
