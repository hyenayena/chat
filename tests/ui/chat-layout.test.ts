import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {ChatEvent, PlanItem} from '../../src/public.js';
import {fixedRowBudget, liveRowCap, ROW_BREAKPOINTS} from '../../src/kit.js';
import {PANEL} from '../../src/ui/agent-panel.js';
import {initialAgents, reduceAgents, type AgentsState} from '../../src/ui/agents.js';
import {headerLayout, liveLayout, promptBudget, viewerHeight, type LiveHeights, type LiveNeeds} from '../../src/ui/chat-layout.js';
import type {PlanView} from '../../src/ui/plan-widget.js';

const scrub = (s: string) => s;
const spawn = (id: string): ChatEvent => ({type: 'ui', event: {kind: 'tool-use', toolUseId: id, name: 'Agent', input: {subagent_type: `Worker${id}`}}});
const agents = (n: number): AgentsState => Array.from({length: n}, (_, i) => spawn(`a${i}`)).reduce(reduceAgents, initialAgents());
const items: PlanItem[] = Array.from({length: 6}, (_, i) => ({id: String(i), content: `Step ${i}`, status: i < 2 ? 'completed' : i === 2 ? 'in_progress' : 'pending'}));
const plan = (patch: Partial<PlanView> = {}): PlanView => ({items, running: true, stale: false, expanded: false, ...patch});
const noPlan = (): PlanView => plan({items: []});

const ROWS = Array.from({length: 55}, (_, i) => i + 6);
const COLUMNS = [40, 100, 160];

const needs = (patch: Partial<LiveNeeds> = {}): LiveNeeds => ({
	rows: 24,
	headerHeight: 0,
	inputNeeded: 4,
	notice: 0,
	menu: 0,
	vim: false,
	queued: 2,
	tools: 3,
	tail: 8,
	hint: true,
	...patch,
});

const frameOf = (h: LiveHeights, status = 1): number => h.input + h.notice + h.menu + h.vim + h.queued + h.tools + h.tail + h.rules + h.hint + status;

test('header plus live area stay within the fixed budget and the frame within the live cap', () => {
	for (const columns of COLUMNS) {
		for (const rows of ROWS) {
			for (const [name, p, a] of [
				['both', plan(), agents(3)],
				['expanded', plan({expanded: true}), agents(8)],
				['plan', plan(), agents(0)],
				['agents', noPlan(), agents(2)],
				['none', noPlan(), agents(0)],
			] as const) {
				const header = headerLayout(p, a, {rows, columns, scrub});
				const live = liveLayout(needs({rows, headerHeight: header.height}));
				const tag = `${name} ${columns}x${rows}`;
				assert.equal(header.height, header.planHeight + header.panel.height, tag);
				assert.ok(header.height + live.used <= liveRowCap(rows), `${tag}: used ${header.height + live.used}`);
				if (rows >= ROW_BREAKPOINTS.short) assert.ok(header.height + live.used <= fixedRowBudget(rows), `${tag}: ${header.height + live.used} > ${fixedRowBudget(rows)}`);
				assert.equal(frameOf(live), live.used, tag);
			}
		}
	}
});

test('below 12 rows only the status bar, the input and what is bound to the input remain', () => {
	for (const rows of ROWS.filter(r => r < ROW_BREAKPOINTS.short)) {
		const header = headerLayout(plan(), agents(3), {rows, columns: 100, scrub});
		assert.equal(header.height, 0, `rows ${rows}`);
		const live = liveLayout(needs({rows, notice: 2, menu: 3, vim: true}));
		assert.equal(live.queued + live.tools + live.tail + live.rules + live.hint, 0, `rows ${rows}`);
		assert.equal(live.input, 1, `rows ${rows}`);
		assert.ok(live.notice >= 1 && live.menu >= 1 && live.vim === 1, `rows ${rows}: ${JSON.stringify(live)}`);
		assert.ok(frameOf(live) <= liveRowCap(rows) || rows < 6, `rows ${rows}: ${frameOf(live)}`);
	}
});

test('the live parts drop in the documented order as the room shrinks', () => {
	const order: [string, (h: LiveHeights) => boolean][] = [
		['tail', h => h.tail > 0],
		['queued', h => h.queued > 0],
		['hint', h => h.hint > 0],
		['rules', h => h.rules > 0],
		['tools', h => h.tools > 0],
		['vim', h => h.vim > 0],
		['menu', h => h.menu > 0],
		['notice', h => h.notice > 0],
	];
	for (const rows of ROWS.filter(r => r >= ROW_BREAKPOINTS.short)) {
		for (let headerHeight = 0; headerHeight <= liveRowCap(rows) - 2; headerHeight++) {
			const live = liveLayout(needs({rows, headerHeight, notice: 1, menu: 1, vim: true}));
			order.forEach(([name, present], i) => {
				if (!present(live)) return;
				for (const [later, laterPresent] of order.slice(i + 1)) assert.ok(laterPresent(live), `${rows}/${headerHeight}: ${name} is shown but ${later} is not: ${JSON.stringify(live)}`);
			});
			assert.ok(live.input >= 1, `${rows}/${headerHeight}`);
		}
	}
});

test('extra input rows drop before the rules around the input, those before extra tool rows', () => {
	const live = liveLayout(needs({rows: 24, headerHeight: 8, inputNeeded: 6, tools: 4}));
	assert.equal(live.budget, 4);
	assert.equal(frameOf(live), live.used);
	assert.equal(live.rules, 0, 'the rules go before the extra tool rows');
	assert.equal(live.input, 1);
	assert.equal(live.tools, 2, 'the freed row goes to a second tool row, not to the input');
});

test('at 24 rows a full agent box still fits, and the live tail is squeezed while the boxes are full', () => {
	const header = headerLayout(noPlan(), agents(2), {rows: 24, columns: 100, scrub});
	assert.equal(header.panel.height, PANEL.fullHeight);
	assert.equal(fixedRowBudget(24), 12);
	const live = liveLayout(needs({rows: 24, headerHeight: header.height}));
	assert.equal(live.tail, 0);
	assert.ok(live.input >= 1 && live.tools >= 1);
	assert.ok(header.height + live.used <= 12);
	const calm = liveLayout(needs({rows: 24, headerHeight: 0}));
	assert.ok(calm.tail > 0);
});

test('the agent panel shrinks before the plan, and neither takes the status, input or activity rows', () => {
	const roomy = headerLayout(plan({expanded: true}), agents(2), {rows: 24, columns: 100, scrub});
	assert.equal(roomy.planHeight, 6, 'the expanded plan is windowed to what is left after the minimums');
	assert.equal(roomy.panel.height, PANEL.tinyHeight, 'the boxes gave way to their minimum');
	assert.ok(roomy.height <= fixedRowBudget(24) - 3);
	const alone = headerLayout(noPlan(), agents(2), {rows: 24, columns: 100, scrub});
	assert.ok(alone.height <= fixedRowBudget(24) - 3);
});

test('the plan is one line, a summary on the tall tier or the expanded list', () => {
	assert.equal(headerLayout(plan(), agents(0), {rows: 24, columns: 100, scrub}).planHeight, 3);
	assert.equal(headerLayout(plan(), agents(0), {rows: 23, columns: 100, scrub}).planHeight, 1);
	assert.equal(headerLayout(plan({expanded: true}), agents(0), {rows: 23, columns: 100, scrub}).planHeight, 7);
	assert.equal(headerLayout(plan(), agents(0), {rows: ROW_BREAKPOINTS.short - 1, columns: 100, scrub}).planHeight, 0);
	assert.equal(headerLayout(plan(), agents(0), {rows: ROW_BREAKPOINTS.short, columns: 100, scrub}).planHeight, 1);
});

test('header and panel agree: the panel is laid out at the budget the allocator gave it', () => {
	for (const rows of [12, 17, 24, 40]) {
		const h = headerLayout(plan(), agents(5), {rows, columns: 100, scrub});
		assert.ok(h.panel.height <= h.panelMax, `rows ${rows}`);
		assert.ok(h.planHeight <= h.planMax, `rows ${rows}`);
	}
});

test('prompt and viewer budgets come from the live cap', () => {
	assert.equal(promptBudget(24, 0), 21);
	assert.equal(promptBudget(24, 3), 18);
	assert.equal(promptBudget(10, 0), 9);
	assert.equal(promptBudget(3, 5), 0);
	assert.equal(viewerHeight(24, 0), 19);
	assert.equal(viewerHeight(24, 7), 12);
	assert.equal(viewerHeight(10, 0), 7);
	assert.equal(viewerHeight(5, 9), 3);
});
