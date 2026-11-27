import assert from 'node:assert/strict';
import {afterEach, test} from 'node:test';
import React, {createElement} from 'react';
void React;
import {makeScrub} from '../../src/contract/scrub.js';
import {frameClock, setMotionPref, stripStyles} from '../../src/kit.js';
import {ChatStatusBar} from '../../src/ui/ChatStatusBar.js';
import {ChatView} from '../../src/ui/ChatView.js';
import {ShellActivity} from '../../src/ui/ShellActivity.js';
import {fakeController, mountHarness, wait} from './testkit.js';

const scrub = makeScrub(s => s);

let cleanup: Array<() => void> = [];
afterEach(() => {
	setMotionPref(false);
	for (const fn of cleanup) fn();
	cleanup = [];
});

function mountChat() {
	const controller = fakeController();
	const h = mountHarness(createElement(ChatView, {controller, print() {}, close() {}, scrub}));
	cleanup.push(() => h.unmount());
	return {controller, h};
}

test('an idle chat view keeps no subscriber and the frame clock does not tick', async () => {
	const t = mountChat();
	await t.h.settle(100);
	assert.equal(frameClock.size(), 0);
	const before = frameClock.tick();
	await wait(250);
	assert.equal(frameClock.tick(), before);
});

test('after a streamed turn ends the frame clock goes quiet again', async () => {
	const t = mountChat();
	t.controller.setState('running');
	t.controller.ui({kind: 'text-delta', text: 'a'});
	t.controller.ui({kind: 'text-delta', text: 'b'});
	await t.h.settle(150);
	t.controller.setState('idle');
	await t.h.settle(150);
	assert.equal(frameClock.size(), 0);
	const before = frameClock.tick();
	await wait(250);
	assert.equal(frameClock.tick(), before);
});

test('a non-streaming update renders at once and drops the pending frame request', async () => {
	const t = mountChat();
	t.controller.setState('running');
	t.controller.ui({kind: 'text-delta', text: 'first'});
	t.controller.ui({kind: 'text-delta', text: ' more'});
	t.controller.setState('idle');
	await t.h.settle(20);
	const quiet = frameClock.tick();
	await wait(250);
	assert.ok(frameClock.tick() - quiet <= 1);
	assert.equal(frameClock.size(), 0);
});

test('ShellActivity without calls starts no timer', async () => {
	const watch = {get: () => ({calls: []}), subscribe: () => () => {}};
	const h = mountHarness(createElement(ShellActivity, {watch: watch as never}));
	cleanup.push(() => h.unmount());
	await h.settle(100);
	assert.equal(frameClock.size(), 0);
	const before = frameClock.tick();
	await wait(200);
	assert.equal(frameClock.tick(), before);
});

test('the status bar stops animating when reduced motion is switched on live', async () => {
	const props = {phase: 'running', status: null, pending: 0, since: 0, columns: 80, now: () => 5000} as never;
	const h = mountHarness(createElement(ChatStatusBar, props));
	cleanup.push(() => h.unmount());
	await h.settle(200);
	setMotionPref(true);
	await h.settle(100);
	const frozen = stripStyles(h.lastFrame());
	await h.settle(300);
	assert.equal(stripStyles(h.lastFrame()), frozen);
});
