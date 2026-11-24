import type {BuildInfo} from '../../../../src/api.js';
import {stringCells, truncateCells} from '../kit.js';
import {sgr, type Sgr} from './sgr.js';
import type {Scrub} from './present.js';

export const MASCOT = [
	'     ███╗ ███╗',
	'███╗ ███║ ███║ ███╗',
	'███║ ╚══╝ ╚══╝ ███║',
	'╚══╝  ███████╗ ╚══╝',
	'    ███████████╗',
	'    ╚══════════╝',
];

export const PAW_STEPS = 4;

export const PAW_PARTS: readonly string[] = [
	'     2222 3333',
	'1111 2222 3333 4444',
	'1111 2222 3333 4444',
	'1111  pppppppp 4444',
	'    pppppppppppp',
	'    pppppppppppp',
];

export function pawFrame(step: number): string[] {
	const k = Math.min(Math.max(Math.trunc(step), 0), PAW_STEPS);
	return MASCOT.map((row, i) => {
		const parts = PAW_PARTS[i] ?? '';
		let out = '';
		for (let c = 0; c < row.length; c++) {
			const part = parts[c] ?? ' ';
			out += part === 'p' || (part !== ' ' && Number(part) <= k) ? row[c] : ' ';
		}
		return out;
	});
}

export const WORDMARK = [
	'██╗   ██╗███████╗███╗   ██╗ █████╗',
	'╚██╗ ██╔╝██╔════╝████╗  ██║██╔══██╗',
	' ╚████╔╝ █████╗  ██╔██╗ ██║███████║',
	'  ╚██╔╝  ██╔══╝  ██║╚██╗██║██╔══██║',
	'   ██║   ███████╗██║ ╚████║██║  ██║',
	'   ╚═╝   ╚══════╝╚═╝  ╚═══╝╚═╝  ╚═╝',
];

export const PLAIN_LOGO = 'YENA';

const MAX_WIDTH = 100;
const ART_GAP = ' ';
const INFO_GAP = '   ';
const MODULES_LABEL = 'modules  ';
const DEV_LABEL = 'dev      ';

export type BannerInfo = {
	build?: BuildInfo;
	model?: string;
	columns: number;
};

const blockWidth = (rows: readonly string[]): number => Math.max(0, ...rows.map(stringCells));
const padTo = (s: string, cells: number): string => s + ' '.repeat(Math.max(0, cells - stringCells(s)));

const pawWithWordmark = (): string[] => {
	const paw = blockWidth(MASCOT);
	return MASCOT.map((m, i) => (padTo(m, paw) + ART_GAP + (WORDMARK[i] ?? '')).trimEnd());
};

export const LOGOS: readonly (readonly string[])[] = [pawWithWordmark(), MASCOT, [PLAIN_LOGO]];

type Segment = {text: string; style?: string};
type Row = Segment[];

const rowCells = (row: Row): number => row.reduce((n, s) => n + stringCells(s.text), 0);

function wrapItems(label: string, items: string[], width: number): string[] {
	const indent = ' '.repeat(stringCells(label));
	const lines: string[] = [];
	let line = label;
	let fresh = true;
	for (const item of items) {
		const piece = fresh ? item : ` · ${item}`;
		if (!fresh && stringCells(line + piece) > width) {
			lines.push(line);
			line = indent + item;
		} else line += piece;
		fresh = false;
	}
	lines.push(line);
	return lines;
}

function infoLines(info: BannerInfo, scrub: Scrub, width: number, sg: Sgr): {rows: Row[]; complete: boolean} {
	const version = `yena ${scrub(info.build?.version ?? 'unknown')}`;
	const model = `model ${scrub(info.model ?? 'default')}`;
	const head = `${version} · ${model}`;
	const rows: Row[] =
		stringCells(head) <= width ? [[{text: head, style: sg.bold}]] : [[{text: version, style: sg.bold}], [{text: model, style: sg.bold}]];
	if (info.build?.root?.mode === 'dev') rows.push([{text: DEV_LABEL, style: sg.muted}, {text: scrub(info.build.root.path), style: sg.warn}]);
	const modules = (info.build?.modules ?? []).map(m => `${scrub(m.name)} ${scrub(m.version)}`);
	if (modules.length === 0) return {rows, complete: true};
	const fits = (lines: string[]): boolean => lines.every(l => stringCells(l) <= width);
	const beside = wrapItems(MODULES_LABEL, modules, width);
	if (fits(beside)) {
		const list = beside.map((line, i): Row =>
			i === 0 ? [{text: MODULES_LABEL, style: sg.muted}, {text: line.slice(MODULES_LABEL.length)}] : [{text: line}],
		);
		return {rows: [...rows, ...list], complete: true};
	}
	const under = wrapItems('', modules, width);
	if (!fits(under)) return {rows, complete: false};
	return {rows: [...rows, [{text: MODULES_LABEL.trimEnd(), style: sg.muted}], ...under.map((line): Row => [{text: line}])], complete: true};
}

const truncateRow = (row: Row, width: number): Row => {
	let left = width;
	return row.map(s => {
		const text = truncateCells(s.text, Math.max(0, left));
		left -= stringCells(text);
		return {...s, text};
	});
};

const logoFor = (inner: number): readonly string[] => LOGOS.find(l => blockWidth(l) <= inner)!;
const innerOf = (columns: number): number => Math.min(Math.max(columns, 0), MAX_WIDTH) - 4;

export function bannerAnimates(columns: number): boolean {
	const inner = innerOf(columns);
	return inner >= PLAIN_LOGO.length && logoFor(inner).length > 1;
}

const GLINT_WIDTH = 3;
// Terminal cells are about twice as tall as wide, so a row shifts the band by two cells to keep it diagonal.
const GLINT_SLANT = 2;

function glintRow(text: string, row: number, at: number, base: string, shine: string): Segment[] {
	const from = Math.max(0, Math.min(text.length, at - row * GLINT_SLANT));
	const to = Math.max(0, Math.min(text.length, at - row * GLINT_SLANT + GLINT_WIDTH));
	return [
		{text: text.slice(0, from), style: base},
		{text: text.slice(from, to), style: shine},
		{text: text.slice(to), style: base},
	].filter(s => s.text !== '');
}

export function formatBanner(info: BannerInfo, scrub: Scrub, opts?: {pawStep?: number; glint?: number}): string {
	const sg = sgr();
	const inner = innerOf(info.columns);
	if (inner < PLAIN_LOGO.length) return '';
	const logo = logoFor(inner);
	const step = opts?.pawStep;
	const paw = step === undefined || step >= PAW_STEPS || logo.length === 1 ? undefined : pawFrame(step);
	const shown = paw ? logo.map((l, i) => paw[i]! + l.slice(paw[i]!.length)) : logo;
	const logoWidth = blockWidth(logo);
	const logoStyle = logo.length === 1 ? sg.bold + sg.running : sg.running;
	const glint = paw || logo.length === 1 || opts?.glint === undefined ? undefined : Math.min(Math.max(opts.glint, 0), 1);
	const span = logoWidth + (logo.length - 1) * GLINT_SLANT + GLINT_WIDTH;
	const logoRow = (text: string, i: number): Segment[] =>
		glint === undefined ? [{text, style: logoStyle}] : glintRow(text, i, Math.round(glint * span) - GLINT_WIDTH, logoStyle, sg.bold);

	const rightWidth = inner - logoWidth - INFO_GAP.length;
	const side = rightWidth > 0 ? infoLines(info, scrub, rightWidth, sg) : {rows: [], complete: false};
	const right = side.rows;
	const fitsRight = side.complete && right.length > 0 && right.length <= logo.length && right.every(r => rowCells(r) <= rightWidth);

	let rows: Row[];
	if (fitsRight) {
		const top = Math.floor((logo.length - right.length) / 2);
		rows = shown.map((l, i) => {
			const side = right[i - top];
			return side ? [...logoRow(padTo(l, logoWidth), i), {text: INFO_GAP}, ...side] : logoRow(l, i);
		});
	} else {
		rows = [...shown.map(logoRow), [], ...infoLines(info, scrub, inner, sg).rows.map(r => truncateRow(r, inner))];
	}

	const border = (s: string): string => `${sg.muted}${s}${sg.reset}`;
	const paint = (s: Segment): string => (s.style && s.text ? `${s.style}${s.text}${sg.reset}` : s.text);
	const body = rows.map(r => `${border('│')} ${r.map(paint).join('')}${' '.repeat(inner - rowCells(r))} ${border('│')}`);
	return [border(`╭${'─'.repeat(inner + 2)}╮`), ...body, border(`╰${'─'.repeat(inner + 2)}╯`)].join('\n');
}
