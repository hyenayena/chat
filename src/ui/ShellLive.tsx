import React from 'react';
import {Box, Text} from 'ink';
import {formatElapsed, glyph, inkTone, truncateCells} from '../kit.js';
import {OutputTail, useSpinner} from './kit.js';
import {SHELL_LIVE_MAX_ROWS} from './chat-layout.js';
import type {Scrub} from './tool-args.js';
import type {RunningShell} from './use-shell-run.js';

export const shellLiveRows = (running: RunningShell | undefined, pending: number): number => {
	if (running) return SHELL_LIVE_MAX_ROWS;
	return pending > 0 ? 1 : 0;
};

export const pendingText = (pending: number): string => `${pending} shell run${pending === 1 ? '' : 's'} go${pending === 1 ? 'es' : ''} with your next message`;

export function ShellLive({running, pending, width, maxRows, scrub, now}: {running: RunningShell | undefined; pending: number; width: number; maxRows: number; scrub: Scrub; now?: number}) {
	const frame = useSpinner(running !== undefined);
	if (maxRows <= 0) return null;
	if (!running) {
		if (pending === 0) return null;
		return <Text {...inkTone('muted')}>{truncateCells(pendingText(pending), width)}</Text>;
	}
	const elapsed = formatElapsed((now ?? Date.now()) - running.startedAt);
	const head = truncateCells(`${frame} ${glyph('shell')} ${scrub(running.command).replace(/\s+/g, ' ')} · ${elapsed}`, width);
	return (
		<Box flexDirection="column" minHeight={maxRows}>
			<Text {...inkTone('shell')}>{head}</Text>
			{maxRows > 1 && running.live.lines.length > 0 && <OutputTail lines={running.live.lines.map(scrub)} width={width} rows={maxRows - 1} />}
		</Box>
	);
}
