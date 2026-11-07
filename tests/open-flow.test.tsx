import assert from 'node:assert/strict';
import {test} from 'node:test';
import React from 'react';
void React;
import {loadUiChecked, NEEDS_MOUNT_MESSAGE, runChatView, UI_MISSING_MESSAGE} from '../src/open-flow.js';
import {makeScrub} from '../src/public.js';
import {makeFakeLog} from './helpers/fake-log.js';
import {makeCtx} from './helpers/fake-ctx.js';
import {makeProvider} from './helpers/fake-provider.js';
import {makeUi} from './helpers/fake-ui.js';

const tick = () => new Promise<void>(r => setTimeout(r, 20));

async function flow(opts: Parameters<typeof makeProvider>[0] = {}, req: Partial<Parameters<typeof runChatView>[1]> = {}, ctxOpts: Parameters<typeof makeCtx>[0] = {}) {
	const f = makeProvider(opts);
	const fu = makeUi();
	const ctx = makeCtx(ctxOpts);
	const log = makeFakeLog();
	const done = runChatView(f.provider, {origin: 'user', fresh: true, ...req}, ctx, {loadUi: async () => fu.ui, log, registerAbort: () => () => {}});
	await tick();
	return {f, fu, ctx, log, done};
}

test('the view gets the controller, scrub, reveal, project dir, pin, model and account from the opened chat', async () => {
	const pin = {current: () => 'main', subscribe: () => () => {}};
	const r = await flow({opened: {model: 'm-x', account: 'work', pin, reveal: s => `R${s}`}, projectDir: '/proj'});
	const props = r.fu.chats[0]!;
	assert.equal(props.controller, r.f.opened[0]!.session);
	assert.equal(props.projectDir, '/proj');
	assert.equal(props.pin, pin);
	assert.equal(props.initialModel, 'm-x');
	assert.equal(props.initialAccount, 'work');
	assert.equal(props.reveal!('a'), 'Ra');
	assert.equal(typeof props.onInbox, 'undefined');
	assert.equal(props.initialSessionId, undefined);
	r.ctx.closeAll();
	await r.done;
});

test('draft and send reach the view; the editor hand-off exists only with a terminal handoff', async () => {
	const r = await flow({}, {draft: 'my draft', send: 'go'});
	assert.equal(r.fu.chats[0]!.initialDraft, 'my draft');
	assert.equal(r.fu.chats[0]!.initialSend, 'go');
	assert.equal(r.fu.chats[0]!.openEditor, undefined);
	r.ctx.closeAll();
	await r.done;
});

test('a new chat prints the banner, a resumed one replays the history instead', async () => {
	const fresh = await flow();
	assert.ok(fresh.ctx.lines.some(l => l.includes('yena') || l.length > 0));
	const bannerLines = fresh.ctx.lines.length;
	assert.ok(bannerLines >= 1);
	fresh.ctx.closeAll();
	await fresh.done;

	const until: Array<string | undefined> = [];
	const r = await flow(
		{
			history: async (_id, o) => {
				until.push(o?.until);
				return [
					{role: 'user', text: 'old question'},
					{role: 'assistant', text: 'old answer'},
				];
			},
		},
		{fresh: false, resume: 'sess-1', historyUntil: 'u7'},
	);
	assert.deepEqual(until, ['u7']);
	assert.equal(r.fu.chats[0]!.initialSessionId, 'sess-1');
	const text = r.ctx.lines.join('\n');
	assert.match(text, /old question/);
	assert.match(text, /old answer/);
	assert.match(text, /Resumed — earlier messages above\./);
	r.ctx.closeAll();
	await r.done;
});

test('a fork replays the history of the source but does not claim its session id', async () => {
	const r = await flow({history: async () => [{role: 'user', text: 'q'}]}, {fresh: false, resume: 'src', fork: true});
	assert.equal(r.fu.chats[0]!.initialSessionId, undefined);
	assert.match(r.ctx.lines.join('\n'), /Resumed — earlier messages above\./);
	r.ctx.closeAll();
	await r.done;
});

test('a reattached chat shows the notice and no banner or history', async () => {
	let asked = 0;
	const r = await flow({opened: {reattached: {startedAt: new Date(2026, 0, 1, 9, 5).getTime()}}, history: async () => (asked++, [])});
	assert.match(r.ctx.lines.join('\n'), /Reattached to a session working since 09:05/);
	assert.equal(asked, 0);
	assert.equal(r.ctx.lines.length, 1);
	r.ctx.closeAll();
	await r.done;
});

test('closing: close, then flush once, then the closing line without control bytes', async () => {
	const r = await flow({session: {model: 'm\u001b[31m1\u0007', sessionId: 'abcdef0123456789'} as never, opened: {scrub: makeScrub(s => s)}});
	r.ctx.closeAll();
	await r.done;
	assert.deepEqual(r.f.events, ['open', 'close', 'flush']);
	const last = r.ctx.lines.at(-1)!;
	assert.match(last, /^\[chat closed · session abcdef01 · model m/);
	assert.doesNotMatch(last, /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/);
	assert.ok(r.log.records.some(x => x.msg === 'chat closed'));
	assert.doesNotMatch(JSON.stringify(r.log.records), /abcdef0123456789/);
});

test('a chat left running in the background says so; one without a session says closed', async () => {
	const a = await flow({opened: {detachedWhileRunning: () => true}});
	a.ctx.closeAll();
	await a.done;
	assert.match(a.ctx.lines.at(-1)!, /^\[chat left running in the background · session aaaaaaaa · model m1\]$/);
	const b = await flow({session: {sessionId: undefined} as never});
	b.ctx.closeAll();
	await b.done;
	assert.equal(b.ctx.lines.at(-1), '[chat closed]');
});

test('a mount that fails still closes and flushes the opened chat', async () => {
	const f = makeProvider();
	const fu = makeUi();
	const ctx = makeCtx();
	ctx.mount = () => Promise.reject(new Error('A view is already mounted'));
	await assert.rejects(runChatView(f.provider, {origin: 'user', fresh: true}, ctx, {loadUi: async () => fu.ui, registerAbort: () => () => {}}), /already mounted/);
	assert.deepEqual(f.events, ['open', 'close', 'flush']);
});

test('the waiting view: cancelling opens no chat, being freed lets the provider go on', async () => {
	let outcome: boolean | undefined;
	const f = makeProvider({
		open: async (_req, env) => {
			outcome = await env.wait(async () => ({free: false, title: 'busy'}));
			return undefined;
		},
	});
	const fu = makeUi();
	const ctx = makeCtx();
	const done = runChatView(f.provider, {origin: 'user', fresh: true}, ctx, {loadUi: async () => fu.ui, waitPollMs: 7, registerAbort: () => () => {}});
	await tick();
	assert.equal(fu.waits[0]!.pollMs, 7);
	fu.waits[0]!.onCancel();
	await done;
	assert.equal(outcome, false);
	assert.equal(fu.chats.length, 0);

	let freed: boolean | undefined;
	const g = makeProvider({
		open: async (_req, env) => {
			freed = await env.wait(async () => ({free: true}));
			return undefined;
		},
	});
	const ctx2 = makeCtx();
	const done2 = runChatView(g.provider, {origin: 'user', fresh: true}, ctx2, {loadUi: async () => fu.ui, registerAbort: () => () => {}});
	await tick();
	fu.waits[1]!.onFree();
	await done2;
	assert.equal(freed, true);
});

test('the env prints notices through the chat formatting and passes the command bridge on', async () => {
	let seen: Parameters<ReturnType<typeof makeProvider>['provider']['open']>[1] | undefined;
	const bridge = {} as never;
	const f = makeProvider({
		open: async (_req, env) => {
			seen = env;
			env.notice('hello notice');
			env.print('plain');
			return undefined;
		},
	});
	const fu = makeUi();
	const ctx = Object.assign(makeCtx(), {commandBridge: bridge});
	await runChatView(f.provider, {origin: 'user', fresh: true}, ctx, {loadUi: async () => fu.ui});
	assert.equal(seen!.commandBridge, bridge);
	assert.match(ctx.lines[0]!, /hello notice/);
	assert.equal(ctx.lines[1], 'plain');
});

test('without a mount the flow refuses at once; the opened chat is never created', async () => {
	const f = makeProvider();
	await assert.rejects(runChatView(f.provider, {origin: 'user', fresh: true}, makeCtx({mount: false})), new RegExp(NEEDS_MOUNT_MESSAGE.replace(/[.*+?^${}()|[\]\\"]/g, '\\$&')));
	assert.deepEqual(f.events, []);
});

test('a missing ink or react maps to the host dependency error before the provider opens; other errors pass', async () => {
	const f = makeProvider();
	const ctx = makeCtx();
	const missing = Object.assign(new Error("Cannot find package 'ink'"), {code: 'ERR_MODULE_NOT_FOUND'});
	await assert.rejects(runChatView(f.provider, {origin: 'user', fresh: true}, ctx, {loadUi: async () => Promise.reject(missing)}), {message: UI_MISSING_MESSAGE});
	assert.deepEqual(f.events, []);
	await assert.rejects(loadUiChecked(async () => Promise.reject(new Error('syntax')), makeFakeLog()), /syntax/);
});

test('a provider that fails to open leaves no view and no closing line', async () => {
	const f = makeProvider({
		open: async () => {
			throw new Error('API_KEY_ONLY');
		},
	});
	const fu = makeUi();
	const ctx = makeCtx();
	await assert.rejects(runChatView(f.provider, {origin: 'unattended', fresh: true}, ctx, {loadUi: async () => fu.ui}), /API_KEY_ONLY/);
	assert.equal(fu.chats.length, 0);
	assert.equal(ctx.lines.length, 0);
});

test('a session that closes itself (a remote stop) ends the view', async () => {
	const r = await flow();
	r.f.sessions[0]!.emit({type: 'state', state: 'closed'});
	await r.done;
	assert.deepEqual(r.f.events, ['open', 'close', 'flush']);
});
