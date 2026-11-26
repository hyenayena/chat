import assert from 'node:assert/strict';
import {afterEach, test} from 'node:test';
import React, {createElement} from 'react';
void React;
import {makeScrub} from '../../src/contract/scrub.js';
import {ChatView} from '../../src/ui/ChatView.js';
import {startFrameMetrics} from '../../src/ui/kit.js';
import {fakeController, mountHarness} from './testkit.js';

const scrub = makeScrub(s => s);

const records: Array<Record<string, unknown> | undefined> = [];
let cleanup: Array<() => void> = [];
afterEach(() => {
	for (const fn of cleanup) fn();
	cleanup = [];
	startFrameMetrics();
});

function setup() {
	records.length = 0;
	startFrameMetrics({
		log: {debug: (_m, f) => void records.push(f), level: () => 'debug'},
		now: () => 0,
		timers: {setInterval: () => ({}), clearInterval() {}},
	});
	const c = fakeController();
	const t = mountHarness(createElement(ChatView, {controller: c, print() {}, close() {}, scrub}));
	cleanup.push(() => t.unmount());
	return {c, t};
}

test('sent then turn-end writes one frames record with the outcome', async () => {
	const {c, t} = setup();
	c.emit({type: 'sent', text: 'hi'});
	c.setState('running');
	await t.settle();
	c.setState('idle');
	c.emit({type: 'turn-end', outcome: 'ok'});
	await t.settle();
	assert.equal(records.length, 1);
	assert.equal(records[0]!.kind, 'turn');
	assert.equal(records[0]!.outcome, 'ok');
});

test('a steer during a turn does not open a second turn', async () => {
	const {c, t} = setup();
	c.emit({type: 'sent', text: 'hi'});
	c.setState('running');
	await t.settle();
	c.emit({type: 'sent', text: 'more'});
	await t.settle();
	c.setState('idle');
	c.emit({type: 'turn-end', outcome: 'ok'});
	await t.settle();
	assert.equal(records.length, 1);
});

test('unmounting mid-turn writes no record', async () => {
	const {c, t} = setup();
	c.emit({type: 'sent', text: 'hi'});
	await t.settle();
	t.unmount();
	assert.equal(records.length, 0);
});

test('a turn that starts without sent is counted', async () => {
	const {c, t} = setup();
	c.setState('running');
	await t.settle();
	c.emit({type: 'turn-end', outcome: 'interrupted'});
	await t.settle();
	assert.equal(records.length, 1);
	assert.equal(records[0]!.outcome, 'interrupted');
});
