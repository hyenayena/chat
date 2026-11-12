import {checklistRows, rowTier, type ChecklistItem} from '../kit.js';
import type {PlanItem} from '../public.js';
import type {Scrub} from './tool-args.js';

export const PLAN = {
	minColumns: 30,
	expandedMax: 10,
	flashMs: 3000,
	meterMax: 10,
} as const;

export type PlanFlash = {text: string; until: number};

export type PlanView = {
	items: readonly PlanItem[];
	running: boolean;
	stale: boolean;
	expanded: boolean;
	flash?: PlanFlash;
};

export type PlanLook = {columns: number; rows: number; maxRows: number; scrub: Scrub; spinner?: string; now: number};

const TITLE = 'Plan';

export const planDone = (items: readonly PlanItem[]): boolean => items.length > 0 && items.every(i => i.status === 'completed');

export function planVisible(view: PlanView): boolean {
	if (view.items.length === 0 || view.stale) return false;
	return view.running || !planDone(view.items);
}

function entries(items: readonly PlanItem[], scrub: Scrub): ChecklistItem[] {
	return items.map(i => ({
		text: scrub(i.status === 'in_progress' ? (i.activeForm ?? i.content) : i.content),
		state: i.status === 'completed' ? 'done' : i.status === 'in_progress' ? 'active' : 'open',
	}));
}

export function planWidgetRows(view: PlanView, look: PlanLook): string[] {
	const tier = rowTier(look.rows);
	if (!planVisible(view) || tier === 'tiny' || look.columns < PLAN.minColumns || !(look.maxRows >= 1)) return [];
	const width = Math.max(1, look.columns - 1);
	const live = view.flash !== undefined && look.now < view.flash.until ? view.flash : undefined;
	const base = {
		title: TITLE,
		items: entries(view.items, look.scrub),
		width,
		...(view.running && look.spinner !== undefined && {spinner: look.spinner}),
		...(live !== undefined && {flash: look.scrub(live.text)}),
		doneLabel: 'done',
	};
	const room = Math.min(PLAN.expandedMax, Math.floor(look.maxRows));
	if (view.expanded && room >= 2) return checklistRows({...base, mode: 'full', maxRows: room});
	if (tier === 'tall') {
		const summary = checklistRows({...base, mode: 'summary'});
		if (summary.length <= look.maxRows) return summary;
	}
	return checklistRows({...base, mode: 'line'});
}

export function planViewerRows(items: readonly PlanItem[], width: number, scrub: Scrub): string[] {
	if (items.length === 0) return [];
	return checklistRows({title: TITLE, items: entries(items, scrub), width: Math.max(1, width), mode: 'full', doneLabel: 'done'});
}
