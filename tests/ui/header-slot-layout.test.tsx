import assert from 'node:assert/strict';
import {afterEach, test} from 'node:test';
import React, {createElement, type ReactElement} from 'react';
import {fixedRowBudget, liveRowCap, stripStyles} from '../../src/kit.js';
import {makeScrub} from '../../src/contract/scrub.js';
import type {PlanItem} from '../../src/public.js';
import {ChatView, clearSentHistory} from '../../src/ui/ChatView.js';
import {fakeController, mountHarness} from './testkit.js';

void React;
const scrub = makeScrub(s => s);

let cleanup: Array<() => void> = [];
afterEach(() => {
	for (const fn of cleanup) fn();
	cleanup = [];
	clearSentHistory();
});

const plan: PlanItem[] = Array.from({length: 14}, (_, i) => ({
	id: String(i + 1),
	content: `Step ${i + 1}`,
	status: i < 3 ? 'completed' : i === 3 ? 'in_progress' : 'pending',
	...(i === 3 && {activeForm: 'Doing step 4'}),
}));

function hostFake(columns: number) {
	const headers: unknown[] = [];
	const listeners: Array<(e: unknown) => boolean | void> = [];
	const host = {
		isFocused: () => true,
		columns: () => columns,
		subscribe: () => () => {},
		move: () => false,
		isHostKey: () => false,
		setHeader: (element: unknown) => void headers.push(element),
		subscribeMouse: (l: (e: unknown) => boolean | void) => {
			listeners.push(l);
			return () => void listeners.splice(listeners.indexOf(l), 1);
		},
	};
	const press = (x: number, y: number) =>
		listeners.at(-1)!({kind: 'press', button: 'left', shift: false, meta: false, ctrl: false, width: columns, height: 60, x, y, region: 'header'});
	return {host, headers, press};
}

async function mountBoth(rows: number, columns: number) {
	const f = hostFake(columns);
	const controller = fakeController();
	const view = mountHarness(createElement(ChatView, {controller, print: () => {}, close: () => {}, scrub, host: f.host as never}), {columns, rows});
	cleanup.push(() => view.unmount());
	await view.settle(40);
	controller.setState('running');
	controller.ui({kind: 'plan', items: plan});
	for (const [id, type] of [['a1', 'Explore'], ['a2', 'Coder']] as const) {
		controller.ui({kind: 'tool-use', toolUseId: id, name: 'Agent', input: {subagent_type: type, prompt: `Prompt of ${type}`}});
	}
	await view.settle(80);
	const header = mountHarness(f.headers.at(-1) as ReactElement, {columns, rows});
	cleanup.push(() => header.unmount());
	await header.settle(60);
	return {f, controller, view, header};
}

const lineCount = (frame: string): number => (stripStyles(frame).trim() === '' ? 0 : stripStyles(frame).replace(/\n+$/, '').split('\n').length);

test('the header tree and the chat tree share the rows: together within rows - 3, the header within its half', async () => {
	for (const rows of [10, 11, 12, 13, 17, 23, 24, 30]) {
		for (const columns of [59, 60, 160]) {
			const {view, header} = await mountBoth(rows, columns);
			const headerRows = lineCount(header.lastFrame());
			const viewRows = lineCount(view.lastFrame());
			const tag = `${rows}x${columns}`;
			if (rows < 12) assert.equal(headerRows, 0, `${tag}: a tiny terminal draws no header`);
			else assert.ok(headerRows <= fixedRowBudget(rows) - 2, `${tag}: header ${headerRows} rows`);
			assert.ok(headerRows + viewRows <= Math.max(liveRowCap(rows), 1), `${tag}: ${headerRows} + ${viewRows} rows`);
			assert.ok(viewRows >= 1, `${tag}: the chat tree keeps its status row`);
		}
	}
});

test('header clicks hit the plan and the agent boxes at the heights both trees agree on', async () => {
	const {f, view, header} = await mountBoth(30, 100);
	const planRows = lineCount(header.lastFrame().split('╭')[0] ?? '');
	assert.ok(planRows >= 1);
	assert.equal(f.press(2, 0), true);
	await view.settle(60);
	const expanded = mountHarness(f.headers.at(-1) as ReactElement, {columns: 100, rows: 30});
	cleanup.push(() => expanded.unmount());
	await expanded.settle(60);
	assert.match(stripStyles(expanded.lastFrame()), /Step 1\b/);
	const expandedPlanRows = lineCount(expanded.lastFrame().split('╭')[0] ?? '');
	assert.ok(expandedPlanRows > planRows);
	assert.equal(f.press(3, expandedPlanRows + 1), true);
	await view.settle(60);
	assert.match(stripStyles(view.lastFrame()), /Subagent (Explore|Coder) · read-only/);
});
