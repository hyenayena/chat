import {formatShellContext, SHELL_LIMITS, type ShellRun} from '../contract/shell-context.js';

export const SHELL_NOTICES = Object.freeze({
	oneLine: 'A shell command is one line.',
	running: 'A shell command is already running (Esc stops it).',
	unavailable: 'Shell commands are not available in this chat.',
	tooLong: `A shell command is at most ${SHELL_LIMITS.commandChars} characters.`,
});

export const LIVE_LINES = 20;
export const LIVE_LINE_CHARS = 1024;

export const isShellLine = (raw: string): boolean => raw.startsWith('!');

export const shellCommandOf = (raw: string): string => raw.slice(1).trim();

export function addPending(list: readonly ShellRun[], run: ShellRun): ShellRun[] {
	return [...list, run].slice(-SHELL_LIMITS.pendingRuns);
}

export const pendingContext = (list: readonly ShellRun[], scrub: (s: string) => string): string | undefined =>
	formatShellContext(list, scrub);

export type LiveLines = {lines: readonly string[]; open: boolean};

export const EMPTY_LIVE: LiveLines = Object.freeze({lines: [], open: false});

export function pushLive(live: LiveLines, text: string): LiveLines {
	if (text === '') return live;
	const pieces = text.replace(/\r\n?/g, '\n').split('\n');
	const endsOpen = pieces[pieces.length - 1] !== '';
	if (!endsOpen) pieces.pop();
	const lines = [...live.lines];
	pieces.forEach((piece, i) => {
		if (i === 0 && live.open && lines.length > 0) lines[lines.length - 1] = (lines[lines.length - 1] + piece).slice(0, LIVE_LINE_CHARS);
		else lines.push(piece.slice(0, LIVE_LINE_CHARS));
	});
	return {lines: lines.slice(-LIVE_LINES), open: endsOpen};
}
