import {COLUMN_BREAKPOINTS, columnTier, fixedRowBudget, paintTone, ROW_BREAKPOINTS, rowTier, SIDE_BY_SIDE_MIN_WIDTH, sliceStyledCells, styledCells, type ColumnTier, type GallerySection} from '../kit.js';
import {PLAN} from './plan-widget.js';

const scrub = (s: string): string => s;

const patch = {hunks: [{oldStart: 11, newStart: 11, lines: [' const rows = split(text);', '-return rows[0];', '+return rows.at(0) ?? "";']}]};

// present.ts stays out of the plugin start: it is loaded when the gallery is shown.
export const chatGallerySection: GallerySection = {
	name: 'chat',
	title: 'Chat transcript',
	description: 'The pieces of the claude chat as they are drawn today',
	load: async () => {
		const p = await import('./present.js');
		return ({width: columns}) => {
			const width = Math.max(1, columns - 1);
			const blocks = [
				p.formatUserLine('Fix the failing test in parse.ts', scrub),
				p.formatAssistantBlock('Here is the plan:\n\n- read the **test**\n- patch `parse()`', scrub, false, width),
				p.formatThinking('Looking at the parser first.', scrub),
				p.formatToolBlock({name: 'Edit', input: {file_path: 'src/parse.ts', old_string: 'return rows[0];', new_string: 'return rows.at(0) ?? "";'}, isError: false, text: '', patch}, scrub, width),
				p.formatToolBlock({name: 'Bash', input: {command: 'npm test'}, isError: true, text: '1 test failed'}, scrub, width),
				p.formatNotice('Notice: the model is unchanged', scrub),
				p.formatWarning('Warning: the session is almost full', scrub),
				p.formatError('The request failed', scrub),
			];
			return blocks.flatMap(b => b.split('\n'));
		};
	},
};

const editPatch = {
	hunks: [
		{oldStart: 11, newStart: 11, lines: [' const rows = split(text);', '-const first = rows[0];', '+const first = rows.at(0) ?? "";', ' return first.trim();']},
		{oldStart: 48, newStart: 48, lines: [' function split(text: string): string[] {', '-\treturn text.split("\\n");', '+\treturn text.split(/\\r?\\n/);', '+\t// keeps empty lines', ' }']},
	],
};

const newFile = [
	'import {readFileSync} from "node:fs";',
	'',
	'export type Row = {id: number; name: string};',
	'',
	'export function load(path: string): Row[] {',
	'\tconst text = readFileSync(path, "utf8");',
	'\t// one JSON object per line',
	'\treturn text.split("\\n").filter(Boolean).map((line, i) => ({id: i + 1, ...JSON.parse(line)}));',
	'}',
	'',
	'export const LIMIT = 100;',
	'export default load;',
].join('\n');

const longPatch = {hunks: [{oldStart: 1, newStart: 1, lines: Array.from({length: 60}, (_, i) => `+export const value${i} = ${i * 7};`)}]};

export const diffGallerySection: GallerySection = {
	name: 'diff',
	title: 'File changes',
	description: 'Edit and Write results as file cards: tinted lines, word and syntax colours, folds',
	load: async () => {
		const [card, hl, p] = await Promise.all([import('./file-card.js'), import('./highlight.js'), import('./present.js')]);
		await hl.preloadHighlighter();
		const edit = {name: 'Edit', input: {file_path: 'src/parse.ts'}, isError: false, patch: editPatch};
		const created = {name: 'Write', input: {file_path: 'src/load.ts', content: newFile}, isError: false, patch: {hunks: [], created: true as const}};
		const long = {name: 'Edit', input: {file_path: 'src/values.ts'}, isError: false, patch: longPatch};
		return ({width: columns}) => {
			const width = Math.max(1, columns - 1);
			const unified = card.formatFileCard(edit, scrub, Math.min(width, SIDE_BY_SIDE_MIN_WIDTH - 1));
			const side =
				width >= SIDE_BY_SIDE_MIN_WIDTH ? card.formatFileCard(edit, scrub, width) : `${p.sgr().muted}side-by-side from ${COLUMN_BREAKPOINTS.sideBySide} columns${p.sgr().reset}`;
			const blocks = [unified, side, card.formatFileCard(created, scrub, width), card.formatFileCard(long, scrub, width)];
			return blocks.flatMap(b => b.split('\n'));
		};
	},
};

const TIER_WIDTHS: readonly (readonly [ColumnTier, number])[] = [
	['compact', 40],
	['normal', 80],
	['wide', 120],
];

const tierSamples = (width: number): (readonly [ColumnTier, number])[] => {
	const fit = TIER_WIDTHS.filter(([, w]) => w <= width);
	return fit.length > 0 ? fit : [[columnTier(width), width]];
};

const testTail = ['> yena@1.0.0 test', '> node --test', ...Array.from({length: 9}, (_, i) => `ok ${i + 1} - case ${i + 1}`), 'not ok 10 - parses an empty file', '  AssertionError: expected 1 to equal 0'].join('\n');
const lsOutput = Array.from({length: 12}, (_, i) => `line ${i + 1} of the output`).join('\n');
const read = (file: string, lines: number, at: number) => ({
	kind: 'tool' as const,
	name: 'Read',
	input: {file_path: `src/${file}`},
	isError: false,
	text: Array.from({length: lines}, (_, i) => `${i + 1}\tcode`).join('\n'),
	startedAt: at,
	durationMs: 300,
});
const grep = (pattern: string, at: number) => ({kind: 'tool' as const, name: 'Grep', input: {pattern}, isError: false, text: 'src/a.ts\nsrc/b.ts\nsrc/c.ts', startedAt: at, durationMs: 400});

export const toolsGallerySection: GallerySection = {
	name: 'tools',
	title: 'Tool calls',
	description: 'Tool call rows: kind glyph, status mark, duration, folded runs, Bash output, errors',
	load: async () => {
		const [card, hl] = await Promise.all([import('./tool-card.js'), import('./highlight.js')]);
		await hl.preloadHighlighter();
		const ok = (name: string, input: unknown, text = '', extra: object = {}) => ({kind: 'tool' as const, name, input, isError: false, text, ...extra});
		const fail = (name: string, input: unknown, text: string, extra: object = {}) => ({kind: 'tool' as const, name, input, isError: true, text, ...extra});
		const fold = [read('present.ts', 120, 1000), read('wrap.ts', 40, 1400), read('tool-card.ts', 80, 1800), grep('TODO', 2000), grep('fixme', 2200)];
		const items = [
			ok('Glob', {pattern: 'src/**/*.ts'}, 'src/a.ts\nsrc/b.ts\nsrc/c.ts'),
			ok('Bash', {command: 'ls src'}, lsOutput, {durationMs: 1800}),
			fail('Bash', {command: 'npm test'}, `Exit code 1\n${testTail}`, {durationMs: 12_000}),
			ok('Bash', {command: 'cd packages/app\nnpm run build\nnpm run lint'}, 'built', {durationMs: 4300}),
			ok('Edit', {file_path: 'src/parse.ts'}, '', {patch, durationMs: 2100}),
			fail('Edit', {file_path: 'src/parse.ts'}, '<tool_use_error>String to replace not found in file.</tool_use_error>'),
			fail('Bash', {command: 'rm -rf build'}, "The user doesn't want to proceed with this tool use."),
			ok('WebFetch', {url: 'https://example.com/docs'}, 'page', {durationMs: 900}),
			ok('Agent', {subagent_type: 'coder', description: 'Fix the parser'}, 'done', {durationMs: 95_000}),
			ok('mcp__yena__run_command', {command: 'mod list'}, 'core 0.19.0\nclaude 0.24.0'),
			ok('mcp__github__search_issues', {query: 'tool cards'}, '3 results'),
			fail('TodoWrite', {todos: []}, '<tool_use_error>InputValidationError: todos is required</tool_use_error>'),
		];
		return ({width: columns}) => {
			const width = Math.max(1, columns - 1);
			const running = card.runningToolRow({id: 'r1', name: 'Agent', input: {subagent_type: 'coder', description: 'Fix the parser'}, elapsedSeconds: 0, startedAt: 1000, activity: {name: 'Read', input: {file_path: 'src/parse.ts'}}}, scrub, width, '⠋', 15_000);
			const blocks = [running, card.formatToolCard(read('present.ts', 120, 1000), scrub, width), card.formatToolGroup(fold, scrub, width), ...items.map(t => card.formatToolCard(t, scrub, width))];
			return blocks.flatMap(b => b.split('\n'));
		};
	},
};

const sampleSummary = {
	durationMs: 134_000,
	tools: 5,
	files: [
		{path: 'src/parse.ts', added: 30, removed: 5},
		{path: 'src/load.ts', added: 12, removed: 2, created: true as const},
	],
	filesTotal: 3,
	added: 42,
	removed: 7,
	outputTokens: 18_400,
};

export const statusGallerySection: GallerySection = {
	name: 'status',
	title: 'Status bar and turn summary',
	description: 'The status bar in the compact, normal and wide column tiers (idle, running, awaiting approval, high context) and the summary row after a turn',
	load: async () => {
		const [bar, summary] = await Promise.all([import('./status-bar.js'), import('./turn-summary.js')]);
		const base = {
			phase: 'idle' as const,
			status: null,
			awaiting: false,
			elapsedMs: 0,
			quietMs: 0,
			verb: 'Sniffing',
			model: 'claude-opus-4-5-20251101',
			route: 'task: light · chat: strong',
			context: {used: 96_000, limit: 200_000},
			account: 'work',
			limit: '5h 82%',
			tasks: [{status: 'running', background: true, taskType: 'local_agent'}],
			project: 'yena',
			branch: 'develop',
			scrub,
		};
		const states = [
			['idle', base],
			['running', {...base, phase: 'running' as const, elapsedMs: 72_000, status: {kind: 'thinking' as const, tokens: 1200}}],
			['awaiting approval', {...base, phase: 'running' as const, awaiting: true}],
			['high context', {...base, context: {used: 180_000, limit: 200_000}}],
		] as const;
		const outcomes = ['ok', 'interrupted', 'error'] as const;
		return ({width, depth, ascii}) => {
			const rows: string[] = [];
			for (const [name, input] of states) {
				rows.push(name);
				for (const [, w] of tierSamples(width)) rows.push(bar.chatStatusRow(input, w - 1, {frame: ascii ? '*' : '✻', depth, ascii}));
			}
			rows.push('turn summary');
			for (const outcome of outcomes) rows.push(summary.turnSummaryRow(sampleSummary, outcome, width - 1, {depth, ascii}));
			return rows;
		};
	},
};

const planSteps = ['Read the parser', 'Patch parse()', 'Run the tests', 'Update the docs', 'Write the changelog', 'Tag the release'];

// present.ts stays out of the plugin start: it is loaded when the gallery is shown.
export const planGallerySection: GallerySection = {
	name: 'plan',
	title: 'Plan widget',
	description: 'The pinned plan checklist, its modes and the transcript notes',
	load: async () => {
		const kit = await import('../kit.js');
		const present = await import('./present.js');
		const items = (done: number, active: boolean, n = planSteps.length) =>
			planSteps.slice(0, n).map((text, i) => ({text: i === done && active ? 'Patching parse()' : text, state: i < done ? ('done' as const) : i === done && active ? ('active' as const) : ('open' as const)}));
		const many = Array.from({length: 24}, (_, i) => ({text: `Step ${i + 1}`, state: i < 9 ? ('done' as const) : i === 9 ? ('active' as const) : ('open' as const)}));
		return ({width, rows: height, depth, ascii}) => {
			const rows: string[] = [];
			const base = {title: 'Plan', depth, ascii};
			const tier = rowTier(height);
			const spinner = ascii ? '|' : '⠹';
			const note = (text: string): string => paintTone(text, 'muted', depth);
			if (tier === 'tiny') rows.push(note(`The plan is hidden below ${ROW_BREAKPOINTS.short} rows (${height} rows here)`));
			if (tier === 'tall') {
				for (const [, w] of tierSamples(width)) {
					rows.push(`summary, running, ${w} columns`, ...kit.checklistRows({...base, items: items(1, true), width: w - 1, mode: 'summary', spinner}));
					rows.push(`summary, idle, ${w} columns`, ...kit.checklistRows({...base, items: items(1, true), width: w - 1, mode: 'summary'}));
				}
			} else if (tier !== 'tiny') {
				rows.push(note(`The summary needs ${ROW_BREAKPOINTS.tall} rows (${height} rows here)`));
			}
			rows.push('line mode', ...kit.checklistRows({...base, items: items(1, true), width: Math.min(width, 80) - 1, mode: 'line', spinner}));
			const room = Math.min(PLAN.expandedMax, Math.max(2, fixedRowBudget(height) - 3));
			rows.push(`expanded, windowed to ${room} rows`, ...kit.checklistRows({...base, items: many, width: width - 1, mode: 'full', maxRows: room}));
			rows.push('short highlight', ...kit.checklistRows({...base, items: items(2, true), width: Math.min(width, 80) - 1, mode: 'line', flash: 'Patch parse()', spinner}));
			rows.push('all done', ...kit.checklistRows({...base, items: items(planSteps.length, false), width: Math.min(width, 80) - 1, mode: 'line', doneLabel: 'done'}));
			rows.push('transcript notes');
			const notes = [
				{kind: 'new' as const, steps: 6},
				{kind: 'added' as const, steps: 2},
				{kind: 'done' as const, text: 'Read the parser'},
				{kind: 'more-done' as const, count: 2},
				{kind: 'finished' as const, done: 6, total: 6},
			];
			rows.push(...present.formatPlanNotes(notes, scrub).split('\n'));
			return rows;
		};
	},
};

const layoutPlan = {
	items: [
		{content: 'Read the parser', status: 'completed' as const},
		{content: 'Patch parse()', status: 'in_progress' as const, activeForm: 'Patching parse()'},
		{content: 'Run the tests', status: 'pending' as const},
		{content: 'Update the docs', status: 'pending' as const},
	],
	running: true,
	stale: false,
	expanded: false,
};

const streamed = [
	'The parser splits on a bare newline, so a file saved on Windows',
	'keeps a trailing carriage return on every row.',
	'I will split on an optional carriage return instead, then',
	'run the tests again to confirm the failure is gone.',
	'After that the docs only need a one-line note.',
];

export const layoutGallerySection: GallerySection = {
	name: 'layout',
	title: 'Chat layout',
	description: 'A mock chat frame laid out by the real row allocator at --width and --rows',
	load: async () => {
		const [layout, agents, bar, card, present] = await Promise.all([import('./chat-layout.js'), import('./agents.js'), import('./status-bar.js'), import('./tool-card.js'), import('./present.js')]);
		const spawn = (id: string, type: string, description: string) =>
			({type: 'ui', event: {kind: 'tool-use', toolUseId: id, name: 'Agent', input: {subagent_type: type, description}}}) as const;
		const state = [spawn('a1', 'coder', 'Fix the parser'), spawn('a2', 'tester', 'Run the suite')].reduce((s, e) => agents.reduceAgents(s, e), agents.initialAgents());
		const tools = [
			{id: 't1', name: 'Bash', input: {command: 'npm test'}, elapsedSeconds: 12, startedAt: 1000},
			{id: 't2', name: 'Read', input: {file_path: 'src/parse.ts'}, elapsedSeconds: 1, startedAt: 14_000},
			{id: 't3', name: 'Grep', input: {pattern: 'split'}, elapsedSeconds: 1, startedAt: 14_000},
		];
		const status = {
			phase: 'running' as const,
			status: null,
			awaiting: false,
			elapsedMs: 72_000,
			quietMs: 0,
			verb: 'Sniffing',
			model: 'claude-opus-4-5-20251101',
			context: {used: 96_000, limit: 200_000},
			scrub,
		};
		return ({width, rows, depth, ascii}) => {
			const look = {rows, columns: width, scrub};
			const head = layout.headerLayout(layoutPlan, state, look);
			const live = layout.liveLayout({
				rows,
				headerHeight: head.height,
				inputNeeded: 1,
				notice: 0,
				menu: 0,
				vim: false,
				queued: 0,
				tools: tools.length,
				tail: streamed.length,
				hint: true,
			});
			const cut = (row: string): string => (styledCells(row) > width - 1 ? sliceStyledCells(row, 0, Math.max(0, width - 1)) : row);
			const rule = (ascii ? '-' : '─').repeat(Math.max(1, width - 1));
			const frame = [
				...head.planRows,
				...head.panel.rows.map(r => r.map(s => s.text).join('')),
				...(live.tail > 0 ? streamed.slice(-live.tail) : []),
				...tools.slice(0, live.tools).map(t => card.runningToolRow(t, scrub, width - 1, ascii ? '*' : '⠋', 15_000)),
				...(live.rules > 0 ? [paintTone(rule, 'muted', depth)] : []),
				paintTone('> ', 'muted', depth),
				...(live.rules > 0 ? [paintTone(rule, 'muted', depth)] : []),
				...(live.hint > 0 ? [paintTone(`  ${present.modeHint('acceptEdits')}`, 'muted', depth)] : []),
				bar.chatStatusRow({...status, panelShown: head.panel.height > 0}, width - 1, {frame: ascii ? '*' : '✻', depth, ascii}),
			];
			const filler = Array.from({length: Math.max(0, rows - frame.length)}, () => paintTone('· transcript ·', 'muted', depth));
			return [...filler, ...frame].map(cut);
		};
	},
};
