import assert from 'node:assert/strict';
import {afterEach, test} from 'node:test';
import React, {createElement} from 'react';
import {liveRowCap, stripStyles} from '../../src/kit.js';
import {makeReveal} from '../../src/contract/reveal.js';
import {makeScrub} from '../../src/contract/scrub.js';
import {ChatView} from '../../src/ui/ChatView.js';
import {fakeController, mountHarness, toolReq} from './testkit.js';

void React;
let cleanup: Array<() => void> = [];
afterEach(() => {
	for (const fn of cleanup) fn();
	cleanup = [];
});

test('a bash prompt and the status bar fill exactly the live cap', async () => {
	for (const rows of [17, 24, 40]) {
		const controller = fakeController();
		controller.pendingPermissions.push(toolReq({input: {command: `echo hi\n${'line\n'.repeat(80)}`}}));
		const h = mountHarness(createElement(ChatView, {controller, print: () => {}, close: () => {}, scrub: makeScrub(s => s), reveal: makeReveal(s => s), armMs: 20, projectDir: '/app'}), {columns: 100, rows});
		cleanup.push(() => h.unmount());
		await h.until(() => stripStyles(h.lastFrame()).includes('awaiting approval'), 600);
		const lines = stripStyles(h.lastFrame()).replace(/\n+$/, '').split('\n');
		assert.equal(lines.length, liveRowCap(rows), `rows ${rows}`);
	}
});
