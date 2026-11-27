import {allocateRows, fixedRowBudget, heldRows, liveRowCap, rowTier, type RowPart} from '../kit.js';
import {layoutPanel, PANEL, type PanelLayout} from './agent-panel.js';
import type {AgentsState} from './agents.js';
import {PLAN, planWidgetRows, type PlanView} from './plan-widget.js';
import type {Scrub} from './tool-args.js';
import {LIVE} from './transcript.js';

export type HeaderLook = {rows: number; columns: number; scrub: Scrub; spinner?: string};

export type HeaderLayout = {
	planRows: string[];
	panel: PanelLayout;
	planHeight: number;
	height: number;
	planMax: number;
	panelMax: number;
};

// The header is a separate React tree: both trees must call this one function to agree on the heights.
export function headerLayout(plan: PlanView, agents: AgentsState, look: HeaderLook): HeaderLayout {
	const {rows, columns, scrub} = look;
	const planLook = {columns, rows, scrub, now: 0};
	const planDesired = planWidgetRows(plan, {...planLook, maxRows: PLAN.expandedMax}).length;
	const panelDesired = layoutPanel(agents, {...look, maxRows: Number.MAX_SAFE_INTEGER}).height;
	const parts: RowPart[] = [
		{id: 'status', min: 1, desired: 1, priority: 100, fixed: true},
		{id: 'input', min: 1, desired: 1, priority: 90, fixed: true},
		{id: 'activity', min: 1, desired: 1, priority: 70},
		{
			id: 'plan',
			min: planDesired > 0 ? 1 : 0,
			desired: planDesired,
			priority: 60,
			...(!plan.expanded && planDesired > 1 && {steps: [1, planDesired]}),
		},
		{id: 'agents', min: panelDesired > 0 ? Math.min(PANEL.tinyHeight, panelDesired) : 0, desired: panelDesired, priority: 50},
	];
	const {heights} = allocateRows(parts, rows);
	const planMax = heights.plan ?? 0;
	const panelMax = heights.agents ?? 0;
	const planRows = planWidgetRows(plan, {...planLook, maxRows: planMax});
	const panel = layoutPanel(agents, {...look, maxRows: panelMax});
	return {planRows, panel, planHeight: planRows.length, height: planRows.length + panel.height, planMax, panelMax};
}

export type LiveNeeds = {
	rows: number;
	headerHeight: number;
	inputNeeded: number;
	hint: number;
	menu: number;
	queued: number;
	tools: number;
	shell?: number;
	tail: number;
	typing?: number;
};

export type LiveHeights = {
	input: number;
	hint: number;
	menu: number;
	queued: number;
	tools: number;
	shell: number;
	tail: number;
	rules: number;
	typing: number;
	budget: number;
	used: number;
};

const want = (n: number): number => (Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0);

export const SHELL_LIVE_MAX_ROWS = 6;

// Priorities run opposite to the drop order: the live tail goes first, the status bar never.
export function liveLayout(needs: LiveNeeds): LiveHeights {
	const {rows} = needs;
	const hint = Math.min(1, want(needs.hint));
	const menu = want(needs.menu);
	const queued = want(needs.queued);
	const tools = want(needs.tools);
	const shell = Math.min(SHELL_LIVE_MAX_ROWS, want(needs.shell ?? 0));
	const tail = want(needs.tail);
	const input = Math.max(1, want(needs.inputNeeded));
	const typing = rowTier(rows) === 'tiny' ? 0 : Math.min(1, want(needs.typing ?? 0));
	const parts: RowPart[] = [
		{id: 'status', min: 1, desired: 1, priority: 100, fixed: true},
		{id: 'input', min: 1, desired: 1, priority: 90, fixed: true},
		{id: 'hint', min: hint, desired: hint, priority: 80, fixed: true},
		{id: 'menu', min: Math.min(1, menu), desired: menu, priority: 75, fixed: true},
		{id: 'shellMin', min: Math.min(1, shell), desired: Math.min(1, shell), priority: 65},
		{id: 'toolMin', min: Math.min(1, tools), desired: Math.min(1, tools), priority: 60},
		{id: 'toolExtra', min: 0, desired: Math.max(0, tools - 1), priority: 50},
		{id: 'shellExtra', min: 0, desired: Math.max(0, shell - 1), priority: 45},
		{id: 'typing', min: 0, desired: typing, priority: 50},
		{id: 'rules', min: 2, desired: 2, priority: 68},
		{id: 'inputExtra', min: 0, desired: input - 1, priority: 30},
		{id: 'queued', min: Math.min(1, queued), desired: queued, priority: 10},
		{id: 'tail', min: Math.min(1, tail), desired: tail, priority: 5},
	];
	const fixedMins = parts.reduce((sum, p) => sum + (p.fixed ? p.min : 0), 0);
	const room = liveRowCap(rows) - needs.headerHeight;
	const budget = Math.max(0, Math.min(room, Math.max(fixedRowBudget(rows) - needs.headerHeight, fixedMins)));
	const alloc = allocateRows(parts, rows, {budget});
	const h = alloc.heights;
	return {
		input: 1 + (h.inputExtra ?? 0),
		hint: h.hint ?? 0,
		menu: h.menu ?? 0,
		queued: h.queued ?? 0,
		tools: (h.toolMin ?? 0) + (h.toolExtra ?? 0),
		shell: (h.shellMin ?? 0) + (h.shellExtra ?? 0),
		tail: h.tail ?? 0,
		rules: h.rules ?? 0,
		typing: h.typing ?? 0,
		budget: alloc.budget,
		used: alloc.used,
	};
}

// The rows the prompt and the status bar together may use below the header.
export const promptBudget = (rows: number, headerHeight: number): number => Math.max(0, liveRowCap(rows) - headerHeight);

export const viewerHeight = (rows: number, headerHeight: number): number => Math.max(3, liveRowCap(rows) - headerHeight - 2);

// The tail grows in steps and the tool list in single rows; the zone never shrinks within a turn.
export function activityZone(held: number, tail: number, tools: number): {held: number; tail: number} {
	const t = want(tail);
	const k = want(tools);
	const wanted = (t > 0 ? Math.ceil(t / LIVE.tailRowStep) * LIVE.tailRowStep : 0) + k;
	const next = heldRows(held, wanted, {max: LIVE.maxTailRows});
	return {held: next, tail: Math.max(0, next - k)};
}
