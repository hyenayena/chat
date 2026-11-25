import {SHELL_LIMITS, type ShellRun} from '../contract/shell-context.js';
import {formatElapsed, glyph, paintTone, ruledRows, sliceStyledCells, statusRow, truncateCells, type ColorDepth, type ThemeTone} from '../kit.js';
import {DURATION_MIN_MS} from './tool-kind.js';

export const SHELL_OUTPUT_ROWS = 12;

export type ShellBlockOptions = {ascii?: boolean; depth?: ColorDepth};

const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim();

function endRow(run: ShellRun, scrub: (s: string) => string): {text: string; tone: ThemeTone} | undefined {
	if (run.outcome === 'stopped') return {text: 'stopped', tone: 'warn'};
	if (run.outcome === 'timed-out') return {text: `timed out after ${Math.round(SHELL_LIMITS.timeoutMs / 1000)}s`, tone: 'error'};
	if (run.outcome === 'failed') return {text: `failed: ${oneLine(scrub(run.error ?? 'unknown error'))}`, tone: 'error'};
	if (run.exitCode === 0) return undefined;
	if (run.exitCode !== undefined) return {text: `exit ${run.exitCode}`, tone: 'error'};
	return {text: `killed by ${oneLine(scrub(run.signal ?? 'a signal'))}`, tone: 'error'};
}

export function formatShellBlock(run: ShellRun, scrub: (s: string) => string, width: number, o: ShellBlockOptions = {}): string[] {
	const w = Math.max(1, Math.floor(width));
	const ascii = o.ascii === true;
	const depth = o.depth;
	const rows = [
		statusRow({
			mark: paintTone(glyph('shell', {ascii}), 'shell', depth),
			title: oneLine(scrub(run.command)),
			...(run.ms >= DURATION_MIN_MS && {right: formatElapsed(run.ms)}),
			width: w,
			...(depth !== undefined && {depth}),
		}),
	];
	const ruled = (text: string, tone: ThemeTone) =>
		ruledRows([scrub(text)], {width: w, maxRows: SHELL_OUTPUT_ROWS, keep: 'tail', tone, moreHint: '', ascii, ...(depth !== undefined && {depth})});
	const out = run.stdout === '' ? [] : ruled(run.stdout, 'muted');
	const err = run.stderr === '' ? [] : ruled(run.stderr, 'error');
	rows.push(...out, ...err);
	const note = (text: string, tone: ThemeTone) => sliceStyledCells(`  ${paintTone(truncateCells(text, Math.max(1, w - 2)), tone, depth)}`, 0, w);
	if (out.length === 0 && err.length === 0) rows.push(note('(no output)', 'muted'));
	const end = endRow(run, scrub);
	if (end !== undefined) rows.push(note(end.text, end.tone));
	return rows;
}
