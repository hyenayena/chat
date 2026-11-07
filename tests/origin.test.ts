import assert from 'node:assert/strict';
import {test} from 'node:test';
import {originOf} from '../src/origin.js';
import {isInteractive, type Origin} from '../src/public.js';
import {makeCtx} from './helpers/fake-ctx.js';
import {openChat, run, setup, tick} from './helpers/env.js';

test('originOf: no signal is the user, the yena caller is the assistant, anything else is unattended', () => {
	assert.equal(originOf({}), 'user');
	assert.equal(originOf({caller: 'yena'}), 'user');
	assert.equal(originOf({signal: new AbortController().signal, caller: 'yena'}), 'assistant');
	assert.equal(originOf({signal: new AbortController().signal, caller: 'scheduler'}), 'unattended');
	assert.equal(originOf({signal: new AbortController().signal}), 'unattended');
});

test('only the user and the assistant are interactive; module and unknown values are not', () => {
	assert.deepEqual((['user', 'assistant', 'unattended', 'module', 'x'] as Origin[]).map(isInteractive), [true, true, false, false, false]);
});

test('an unattended send into the open chat needs admitSend to accept it', async () => {
	const env = setup();
	const a = await openChat(env);
	const ctx = makeCtx({signal: true});
	await run(env.chat, ['send', 'from', 'cron'], ctx);
	assert.deepEqual(env.fu.delivered, ['from cron']);
	assert.deepEqual(env.fake.admitSendCalls, ['unattended']);
	a.ctx.closeAll();
	await a.done;
});

test('a refusing admitSend leaves the chat untouched and delivers nothing', async () => {
	const env = setup({
		admitSend: () => {
			throw new Error('API_KEY_ONLY refused');
		},
	});
	const a = await openChat(env);
	await assert.rejects(run(env.chat, ['send', 'x'], makeCtx({signal: true})), /API_KEY_ONLY refused/);
	await assert.rejects(run(env.chat, ['send', 'x'], makeCtx({signal: true, caller: 'scheduler'})), /API_KEY_ONLY refused/);
	assert.deepEqual(env.fu.delivered, []);
	assert.equal(env.fake.sessions[0]!.closed, 0);
	a.ctx.closeAll();
	await a.done;
});

test('a provider without admitSend does not take unattended sends, nor command passthrough', async () => {
	const env = setup({admitSend: null, hints: [{name: 'compact'}], session: {commands: [{name: 'compact'}]} as never});
	const a = await openChat(env);
	await assert.rejects(run(env.chat, ['send', 'x'], makeCtx({signal: true})), /The open chat does not take messages from unattended runs/);
	await assert.rejects(run(env.chat, ['compact'], makeCtx({signal: true})), /does not take messages from unattended runs/);
	assert.deepEqual(env.fu.delivered, []);
	assert.deepEqual(env.fake.sessions[0]!.sent, []);
	a.ctx.closeAll();
	await a.done;
});

test('interactive sends (user, assistant) never ask admitSend', async () => {
	const env = setup({admitSend: null});
	const a = await openChat(env);
	await run(env.chat, ['send', 'typed'], makeCtx());
	await run(env.chat, ['send', 'by yena'], makeCtx({signal: true, caller: 'yena'}));
	assert.deepEqual(env.fu.delivered, ['typed', 'by yena']);
	a.ctx.closeAll();
	await a.done;
});

test('every open and start passes the origin to admit and open: user, assistant, unattended', async () => {
	const env = setup();
	const user = await openChat(env);
	await run(env.chat, ['start', 'a'], makeCtx({signal: true, caller: 'yena'}));
	await tick();
	await run(env.chat, ['start', 'b'], makeCtx({signal: true, caller: 'cron'}));
	await tick();
	assert.deepEqual(env.fake.admits, ['user', 'assistant', 'unattended']);
	assert.deepEqual(env.fake.opens.map(o => o.origin), ['user', 'assistant', 'unattended']);
	user.ctx.closeAll();
	await user.done;
});

test('an unattended start refused by admit leaves the open chat untouched', async () => {
	const env = setup({
		admit: async o => {
			if (o !== 'user') throw new Error('API_KEY_ONLY');
		},
	});
	const a = await openChat(env);
	await assert.rejects(run(env.chat, ['start', 'x'], makeCtx({signal: true, caller: 'cron'})), /API_KEY_ONLY/);
	assert.equal(env.fake.sessions[0]!.closed, 0);
	assert.equal(env.fake.opens.length, 1);
	a.ctx.closeAll();
	await a.done;
});

test('an unattended ask reaches the provider with its origin', async () => {
	const env = setup();
	await run(env.chat, ['ask', 'q'], makeCtx({signal: true, caller: 'cron'}));
	assert.equal(env.fake.asks[0]?.origin, 'unattended');
});
