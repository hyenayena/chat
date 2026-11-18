import React, {useMemo, useRef} from 'react';
import {Text} from 'ink';
import {useSpinner} from './kit.js';
import {pickWorkingVerb} from './present.js';
import {chatStatusRow, type StatusInput} from './status-bar.js';

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
	const verbRef = useRef<string | undefined>(undefined);
	const verb = useMemo(() => (verbRef.current = pickWorkingVerb(Math.random, verbRef.current)), [since, beat]);
	const t = now();
	const row = chatStatusRow(
		{...input, awaiting: pending > 0, elapsedMs: Math.max(0, t - since), quietMs: lastEventAt === undefined || pending > 0 ? 0 : Math.max(0, t - lastEventAt), verb},
		Math.max(1, columns - 1),
		{frame},
	);
	return <Text wrap="truncate">{row}</Text>;
}
