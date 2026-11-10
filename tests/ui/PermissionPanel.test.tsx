import assert from 'node:assert/strict';
import {afterEach, test} from 'node:test';
import React from 'react';
import {openSession, type ModuleSession, type PermissionDecision, type PermissionRequest} from '../../src/public.js';
import {resetModuleSessions} from '../../src/module-sessions.js';
import {createPermissionElement} from '../../src/ui/mount.js';
import {makeProvider, type FakeSession} from '../helpers/fake-provider.js';
import {registerChatProvider} from '../../src/public.js';
import {mountHarness, questionReq, toolReq} from './testkit.js';

let cleanup: Array<() => void> = [];
afterEach(async () => {
	for (const fn of cleanup.splice(0).reverse()) fn();
	await resetModuleSessions();
});

async function setup() {
	const f = makeProvider();
	cleanup.push(registerChatProvider(f.provider)!);
	const h = await openSession({owner: 'clan', prompts: 'show'});
	const s: FakeSession = f.sessions[0]!;
	const pend: PermissionRequest[] = [];
	const answers: Array<[string, PermissionDecision]> = [];
	const interrupts: number[] = [];
	const loose = s as unknown as {pendingPermissions: PermissionRequest[]; answerPermission: (id: string, d: PermissionDecision) => boolean; interrupt: () => Promise<void>};
	loose.pendingPermissions = pend;
	loose.answerPermission = (id, d) => {
		const i = pend.findIndex(r => r.id === id);
		if (i < 0) return false;
		pend.splice(i, 1);
		answers.push([id, d]);
		s.emit({type: 'permission-resolved', id, pending: pend.length});
		return true;
	};
	loose.interrupt = async () => void interrupts.push(1);
	const add = (r: PermissionRequest) => {
		pend.push(r);
		s.emit({type: 'permission-requested', request: r, pending: pend.length});
	};
	return {h, add, answers, interrupts, pend};
}

const mount = async (h: ModuleSession, request: PermissionRequest, over: {armMs?: number; onDone?: () => void} = {}) => {
	const harness = mountHarness(createPermissionElement({session: h, request, armMs: 20, ...over}) as React.ReactElement);
	cleanup.push(() => harness.unmount());
	await harness.settle(100);
	return harness;
};

test('renders a tool prompt and Enter or y allows through the session, never "always"', async () => {
	const {h, add, answers} = await setup();
	const req = toolReq({id: 'a', always: {label: 'Always allow'}});
	add(req);
	const ui = await mount(h, req);
	const frame = ui.lastFrame();
	assert.match(frame, /Bash: run this command/);
	assert.match(frame, /Allow once/);
	assert.doesNotMatch(frame, /Always allow/);
	ui.press('y');
	await ui.settle(60);
	assert.deepEqual(answers, [['a', {kind: 'allow'}]]);
});

test('renders a question and answers it', async () => {
	const {h, add, answers} = await setup();
	const req = questionReq({id: 'q'});
	add(req);
	const ui = await mount(h, req);
	assert.match(ui.lastFrame(), /Which color\?/);
	ui.press('\r');
	await ui.settle(60);
	assert.equal(answers[0]?.[0], 'q');
	assert.equal(answers[0]?.[1].kind, 'answers');
});

test('deny and deny-with-stop (others denied, interrupt)', async () => {
	const one = await setup();
	const a = toolReq({id: 'a'});
	one.add(a);
	const ui = await mount(one.h, a);
	ui.press('n');
	await ui.settle(60);
	assert.equal(one.answers[0]?.[1].kind, 'deny');
	await resetModuleSessions();
	cleanup.splice(0).reverse().forEach(fn => fn());

	const two = await setup();
	const x = toolReq({id: 'x'});
	const y = toolReq({id: 'y'});
	two.add(x);
	two.add(y);
	const ui2 = await mount(two.h, x);
	assert.match(ui2.lastFrame(), /Permission 1 of 2/);
	ui2.press('s');
	await ui2.settle(60);
	assert.deepEqual(two.answers, [['x', {kind: 'deny', stop: true}], ['y', {kind: 'deny', stop: true}]]);
	assert.equal(two.interrupts.length, 1);
});

test('keys before the arm time do nothing', async () => {
	const {h, add, answers} = await setup();
	const req = toolReq({id: 'a'});
	add(req);
	const ui = mountHarness(createPermissionElement({session: h, request: req, armMs: 5000}) as React.ReactElement);
	cleanup.push(() => ui.unmount());
	await ui.settle(60);
	ui.press('y');
	await ui.settle(60);
	assert.deepEqual(answers, []);
});

test('a request no longer pending renders nothing and calls onDone', async () => {
	const {h, add} = await setup();
	const req = toolReq({id: 'gone'});
	let done = 0;
	const ui = await mount(h, req, {onDone: () => void done++});
	assert.equal(ui.lastFrame().trim(), '');
	assert.equal(done, 1);
	add(req);
	h.deny('gone');
	await ui.settle(40);
	assert.equal(done, 1);
});

test('a foreign handle throws Not a module session', () => {
	assert.throws(() => createPermissionElement({session: {} as ModuleSession, request: toolReq()}), /Not a module session/);
});
