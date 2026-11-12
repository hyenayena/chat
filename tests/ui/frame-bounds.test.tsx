import assert from 'node:assert/strict';
import {afterEach, test} from 'node:test';
import React, {createElement} from 'react';
import {stringCells, stripStyles} from '../../src/kit.js';
import {makeReveal} from '../../src/contract/reveal.js';
import {makeScrub} from '../../src/contract/scrub.js';
import type {PlanItem} from '../../src/public.js';
import {ChatView, clearSentHistory} from '../../src/ui/ChatView.js';
import {fakeController, mountHarness, toolReq, type FakeController} from './testkit.js';

void React;
const scrub = makeScrub(s => s);
const reveal = makeReveal(s => s);

let cleanup: Array<() => void> = [];
afterEach(() => {
	for (const fn of cleanup) fn();
	cleanup = [];
	clearSentHistory();
});

const plan: PlanItem[] = Array.from({length: 12}, (_, i) => ({
	id: String(i + 1),
	content: `Step ${i + 1}`,
	status: i < 3 ? 'completed' : i === 3 ? 'in_progress' : 'pending',
	...(i === 3 && {activeForm: 'Doing step 4'}),
}));

function busy(controller: FakeController): void {
	controller.setState('running');
	controller.ui({kind: 'plan', items: plan});
	for (const [id, type] of [['a1', 'Explore'], ['a2', 'Coder'], ['a3', 'Reviewer']] as const) {
		controller.ui({kind: 'tool-use', toolUseId: id, name: 'Agent', input: {subagent_type: type, prompt: `Prompt of ${type}`}});
	}
}

function mount(rows: number, columns: number, withPrompt: boolean) {
	const controller = fakeController();
	if (withPrompt) controller.pendingPermissions.push(toolReq({input: {command: `echo ${'x'.repeat(200)}\n${'line\n'.repeat(40)}`}}));
	const h = mountHarness(
		createElement(ChatView, {controller, print: () => {}, close: () => {}, scrub, reveal, armMs: 20, projectDir: '/app'}),
		{columns, rows},
	);
	cleanup.push(() => h.unmount());
	return {controller, ...h};
}

function check(frame: string, rows: number, columns: number, tag: string, edge = columns - 1): void {
	const lines = stripStyles(frame).replace(/\n+$/, '').split('\n');
	assert.ok(frame.trim() !== '', `${tag}: empty frame`);
	assert.ok(lines.length <= rows - 1, `${tag}: ${lines.length} rows`);
	if (rows >= 12) assert.ok(lines.length <= rows - 3, `${tag}: ${lines.length} rows leaves no spare rows`);
	for (const line of lines) {
		assert.ok(stringCells(line) <= edge, `${tag}: ${stringCells(line)} cells in ${JSON.stringify(line)}`);
	}
}

const ROWS = [4, 6, 8, 11, 12, 13, 17, 23, 24, 40];
const COLUMNS = [40, 59, 60, 160];

for (const withPrompt of [false, true]) {
	test(`${withPrompt ? 'a prompt over' : 'a live turn with'} a plan and agents stays inside rows - 1 and columns - 1 at every tier`, async () => {
		for (const rows of ROWS) {
			for (const columns of COLUMNS) {
				const t = mount(rows, columns, withPrompt);
				await t.settle(40);
				busy(t.controller);
				await t.until(() => stripStyles(t.lastFrame()).includes(withPrompt ? 'awaiting approval' : 'Step'), 600);
				await t.settle(40);
				check(t.lastFrame(), rows, columns, `${withPrompt ? 'prompt' : 'live'} ${rows}x${columns}`);
			}
		}
	});
}

test('resizing across the 11/12 and 23/24 row tiers and the 59/60 and 159/160 column tiers keeps the frame inside the terminal', async () => {
	const t = mount(24, 160, false);
	await t.settle(40);
	busy(t.controller);
	await t.settle(60);
	for (const [rows, columns] of [[24, 160], [23, 159], [12, 60], [11, 59], [12, 60], [24, 160], [4, 20], [24, 160]] as const) {
		t.resize(columns, rows);
		await t.settle(60);
		check(t.lastFrame(), rows, columns, `resize ${rows}x${columns}`);
	}
});
