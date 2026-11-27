import assert from 'node:assert/strict';
import {afterEach, test} from 'node:test';
import React, {createElement} from 'react';
void React;
import {makeScrub} from '../../src/contract/scrub.js';
import {setMotionPref, stringCells, stripStyles} from '../../src/kit.js';
import {createBannerIntro} from '../../src/ui/banner-intro.js';
import {ChatView} from '../../src/ui/ChatView.js';
import {fakeController, mountHarness} from './testkit.js';

const scrub = makeScrub(s => s);

let cleanup: Array<() => void> = [];
afterEach(() => {
	for (const fn of cleanup) fn();
	cleanup = [];
});

function setup(size = {columns: 60, rows: 24}) {
	const printed: string[] = [];
	const intro = createBannerIntro({
		render: (columns, step) => ['┌──┐', step === undefined ? '│ok│' : `│${step}${' '.repeat(Math.max(0, columns - 6))}│`, '└──┘'].join('\n'),
		columns: () => size.columns,
		print: text => void printed.push(text),
		schedule: () => () => {},
	});
	const controller = fakeController();
	const h = mountHarness(createElement(ChatView, {controller, print: intro.print, close() {}, scrub, intro}), size);
	cleanup.push(() => h.unmount());
	return {intro, printed, h, controller};
}

test('the intro frame is drawn in the live area within columns - 1', async () => {
	const s = setup();
	await s.h.settle();
	const rows = stripStyles(s.h.lastFrame()).split('\n');
	assert.ok(rows.some(r => r.includes('┌──┐')));
	assert.ok(rows.every(r => stringCells(r) <= 59));
	assert.equal(s.printed.length, 0);
});

test('a key finishes the intro and still reaches the input', async () => {
	const s = setup();
	await s.h.settle();
	s.h.press('x');
	await s.h.settle();
	assert.equal(s.intro.active(), false);
	assert.ok(s.printed.some(p => p.includes('ok')));
	assert.match(stripStyles(s.h.lastFrame()), /x/);
});

test('a paste finishes the intro', async () => {
	const s = setup();
	await s.h.settle();
	s.h.press('\u001b[200~pasted\u001b[201~');
	await s.h.settle();
	assert.equal(s.intro.active(), false);
	assert.match(stripStyles(s.h.lastFrame()), /pasted/);
});

test('an intro that does not fit the live area finishes at once', async () => {
	const s = setup({columns: 60, rows: 4});
	await s.h.settle();
	assert.equal(s.intro.active(), false);
	assert.equal(s.printed.length, 1);
});

test('typed keys during the intro are all kept', async () => {
	const s = setup();
	await s.h.settle();
	for (const ch of 'abc') s.h.press(ch);
	await s.h.settle();
	assert.equal(s.intro.active(), false);
	assert.match(stripStyles(s.h.lastFrame()), /abc/);
});

test('reduced motion finishes the intro at once', async () => {
	const s = setup();
	await s.h.settle();
	assert.equal(s.intro.active(), true);
	setMotionPref(true);
	try {
		await s.h.settle();
		assert.equal(s.intro.active(), false);
		assert.ok(s.printed.some(p => p.includes('ok')));
	} finally {
		setMotionPref(false);
	}
});
