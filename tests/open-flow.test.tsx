import assert from 'node:assert/strict';
import {test} from 'node:test';
import React from 'react';
void React;
import {setActivityEvents} from '../src/activity.js';
import {withColorDepth, type ColorDepth} from '../src/kit.js';
import {bannerAnimationOn, loadUiChecked, NEEDS_MOUNT_MESSAGE, runChatView, UI_MISSING_MESSAGE} from '../src/open-flow.js';
import {checkProfile, makeScrub} from '../src/public.js';
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

test('a notice prints after the banner and never reaches the provider', async () => {
	const plain = await flow();
	const plainLines = plain.ctx.lines.length;
	plain.ctx.closeAll();
	await plain.done;
	const r = await flow({}, {notice: 'Could not reopen it'});
	assert.equal(r.ctx.lines.length, plainLines + 1);
	assert.match(r.ctx.lines.at(-1)!, /Could not reopen it/);
	assert.equal('notice' in r.f.opens[0]!, false);
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

const clanProfile = {id: 'clan', owner: 'clan', banner: 'The clan is here', appendSystemPrompt: 'p', mainTools: [], agents: {}};

test('a profile chat hands the profile to the view and prints its banner once after the chat banner', async () => {
	const plain = await flow();
	const plainLines = plain.ctx.lines.length;
	plain.ctx.closeAll();
	await plain.done;
	const r = await flow({}, {profile: clanProfile as never});
	assert.equal(r.fu.chats[0]!.profile?.id, 'clan');
	assert.equal(r.ctx.lines.length, plainLines + 1);
	assert.match(r.ctx.lines.at(-1)!, /The clan is here/);
	assert.equal(r.ctx.lines.filter(l => l.includes('The clan is here')).length, 1);
	r.ctx.closeAll();
	await r.done;
});

test('a profile without a banner prints nothing extra, and a plain chat has no profile prop', async () => {
	const plain = await flow();
	const plainLines = plain.ctx.lines.length;
	assert.equal(plain.fu.chats[0]!.profile, undefined);
	plain.ctx.closeAll();
	await plain.done;
	const {banner: _banner, ...noBanner} = clanProfile;
	const r = await flow({}, {profile: noBanner as never});
	assert.equal(r.ctx.lines.length, plainLines);
	r.ctx.closeAll();
	await r.done;
});

test('a profile banner goes through the scrub and loses control bytes', async () => {
	const r = await flow({opened: {scrub: makeScrub(s => s.replace('hunter2', '***'))}}, {profile: {...clanProfile, banner: 'hi hunter2\u001b[31m'} as never});
	const text = r.ctx.lines.at(-1)!;
	assert.ok(!text.includes('hunter2'));
	assert.ok(!text.includes('\u001b[31m'));
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

test('the user chat reports activity as chat:user and releases it when the view ends', async () => {
	const sent: Array<{source: string; id: string; label: string; state: string}> = [];
	setActivityEvents({emit: (_t, p) => void sent.push(p as (typeof sent)[number]), on: () => () => {}});
	try {
		const r = await flow({session: {title: 'secret title'} as never});
		r.ctx.closeAll();
		await r.done;
		assert.equal(sent.at(-1)?.state, 'gone');
		assert.ok(sent.every(x => x.source === 'chat' && x.id === 'user' && x.label === 'chat'));
	} finally {
		setActivityEvents(undefined);
	}
});

const nounProfile = () =>
	checkProfile({id: 'clan', owner: 'clan', noun: 'clan', appendSystemPrompt: 'M.', mainTools: ['Agent'], agents: {a: {description: 'd', prompt: 'p', label: 'A', tone: 'teal'}}});

test('a profile with a noun names itself in the activity label and the closing line', async () => {
	const sent: Array<{label: string}> = [];
	setActivityEvents({emit: (_t, p) => void sent.push(p as (typeof sent)[number]), on: () => () => {}});
	try {
		const r = await flow({session: {sessionId: 'abcdef0123456789'} as never}, {profile: nounProfile()});
		r.ctx.closeAll();
		await r.done;
		assert.ok(sent.length > 0 && sent.every(x => x.label === 'clan'));
		assert.match(r.ctx.lines.at(-1)!, /^\[clan closed · session abcdef01/);
	} finally {
		setActivityEvents(undefined);
	}
});

function fakeStore(saved: Array<{n: number; at: number; agent: string; text: string} | {n: number; at: number; kind: 'direction'; text: string} | {n: number; at: number; kind: 'silence'}> = []) {
	const calls: unknown[][] = [];
	const store = {
		bind: async (...a: unknown[]) => void calls.push(['bind', ...a]),
		touch: async (...a: unknown[]) => void calls.push(['touch', ...a]),
		addRecord: async (...a: unknown[]) => void calls.push(['addRecord', ...a]),
		lines: async () => saved,
		lookup: async () => undefined,
		has: async () => false,
		ids: async () => new Set<string>(),
		listFor: async () => [],
	};
	return {store: store as never, calls};
}

const skeptic = {skeptic: {description: 'd', prompt: 'p', label: 'Skeptic', tone: 'orange'}};

test('a profile chat binds the session once on the session event, touches it on every send and records the finished lines', async () => {
	const {store, calls} = fakeStore();
	const f = makeProvider({history: async () => [{role: 'user', text: 'a'}, {role: 'assistant', text: 'b'}, {role: 'user', text: 'c'}]});
	const fu = makeUi();
	const ctx = makeCtx();
	const profile = checkProfile({id: 'clan', owner: 'clan', noun: 'clan', args: ['skeptic'], appendSystemPrompt: 'p', mainTools: [], agents: skeptic});
	const done = runChatView(f.provider, {origin: 'user', fresh: false, resume: 'sess-1', profile}, ctx, {loadUi: async () => fu.ui, registerAbort: () => () => {}, profiles: store});
	await tick();
	const session = f.sessions[0]!;
	session.emit({type: 'ui', event: {kind: 'session', sessionId: 'sess-1'}});
	session.emit({type: 'ui', event: {kind: 'session', sessionId: 'sess-1'}});
	session.emit({type: 'sent', text: 'hi'});
	fu.chats[0]!.onProfileRecord!({kind: 'line', agent: 'skeptic', text: 'Hm.'});
	await tick();
	assert.deepEqual(calls, [
		['bind', 'sess-1', {id: 'clan', owner: 'clan', noun: 'clan', args: ['skeptic']}],
		['touch', 'aaaaaaaa-1111'],
		['addRecord', 'aaaaaaaa-1111', {n: 3, kind: 'line', agent: 'skeptic', text: 'Hm.'}],
	]);
	ctx.closeAll();
	await done;
});

test('a plain chat records nothing', async () => {
	const {store, calls} = fakeStore();
	const f = makeProvider();
	const fu = makeUi();
	const ctx = makeCtx();
	const done = runChatView(f.provider, {origin: 'user', fresh: true}, ctx, {loadUi: async () => fu.ui, registerAbort: () => () => {}, profiles: store});
	await tick();
	f.sessions[0]!.emit({type: 'ui', event: {kind: 'session', sessionId: 's'}});
	f.sessions[0]!.emit({type: 'sent', text: 'hi'});
	assert.equal(fu.chats[0]!.onProfileRecord, undefined);
	assert.deepEqual(calls, []);
	ctx.closeAll();
	await done;
});

test('a resumed profile chat puts the saved persona lines back after the user message they followed', async () => {
	const {store} = fakeStore([
		{n: 1, at: 1, agent: 'skeptic', text: 'FIRST-LINE'},
		{n: 2, at: 2, agent: 'skeptic', text: 'SECOND-LINE'},
	]);
	const f = makeProvider({
		history: async () => [
			{role: 'user', text: 'U-ONE'},
			{role: 'assistant', text: 'A-ONE'},
			{role: 'user', text: 'U-TWO'},
			{role: 'assistant', text: 'A-TWO'},
		],
	});
	const fu = makeUi();
	const ctx = makeCtx();
	const profile = checkProfile({id: 'clan', owner: 'clan', appendSystemPrompt: 'p', mainTools: [], agents: skeptic});
	const done = runChatView(f.provider, {origin: 'user', fresh: false, resume: 'sess-1', profile}, ctx, {loadUi: async () => fu.ui, registerAbort: () => () => {}, profiles: store});
	await tick();
	const at = (needle: string) => ctx.lines.findIndex(l => l.includes(needle));
	assert.ok(at('U-ONE') < at('FIRST-LINE') && at('FIRST-LINE') < at('A-ONE'));
	assert.ok(at('A-ONE') < at('U-TWO') && at('U-TWO') < at('SECOND-LINE') && at('SECOND-LINE') < at('A-TWO'));
	assert.equal(ctx.lines.some(l => l.includes('Earlier agent lines')), false);
	ctx.closeAll();
	await done;
});

test('a resumed direction-mode chat skips assistant history and prints the saved records in file order', async () => {
	const {store} = fakeStore([
		{n: 1, at: 1, kind: 'direction', text: 'DIRECTION-ONE'},
		{n: 1, at: 2, agent: 'skeptic', text: 'LINE-ONE'},
		{n: 2, at: 3, kind: 'silence'},
	]);
	const f = makeProvider({
		history: async () => [
			{role: 'user', text: 'U-ONE'},
			{role: 'assistant', text: 'A-ONE'},
			{role: 'user', text: 'U-TWO'},
			{role: 'assistant', text: 'A-TWO'},
		],
	});
	const fu = makeUi();
	const ctx = makeCtx();
	const profile = checkProfile({id: 'clan', owner: 'clan', appendSystemPrompt: 'p', mainTools: [], agents: skeptic, mainText: 'direction'});
	const done = runChatView(f.provider, {origin: 'user', fresh: false, resume: 'sess-1', profile}, ctx, {loadUi: async () => fu.ui, registerAbort: () => () => {}, profiles: store});
	await tick();
	const at = (needle: string) => ctx.lines.findIndex(l => l.includes(needle));
	assert.ok(at('U-ONE') < at('DIRECTION-ONE') && at('DIRECTION-ONE') < at('LINE-ONE') && at('LINE-ONE') < at('U-TWO'));
	assert.ok(at('U-TWO') < at('No one answered'));
	assert.equal(at('A-ONE'), -1);
	assert.equal(at('A-TWO'), -1);
	ctx.closeAll();
	await done;
});

test('the banner animation needs the pref, a colour depth, a terminal and no headless run', () => {
	const on = {pref: true, depth: '16' as ColorDepth, tty: true, headless: false};
	assert.equal(bannerAnimationOn(on), true);
	assert.equal(bannerAnimationOn({...on, pref: false}), false);
	assert.equal(bannerAnimationOn({...on, depth: 'none'}), false);
	assert.equal(bannerAnimationOn({...on, tty: false}), false);
	assert.equal(bannerAnimationOn({...on, headless: true}), false);
});

async function animated(opts: {depth?: ColorDepth; pref?: boolean; tty?: boolean} = {}, popts: Parameters<typeof makeProvider>[0] = {}, req: Partial<Parameters<typeof runChatView>[1]> = {}) {
	const f = makeProvider(popts);
	const fu = makeUi();
	const ctx = makeCtx();
	const realMount = ctx.mount!;
	ctx.mount = build => withColorDepth(opts.depth ?? '16', () => realMount(control => build({...control, host: {columns: () => 120} as never})));
	const done = runChatView(f.provider, {origin: 'user', fresh: true, ...req}, ctx, {
		loadUi: async () => fu.ui,
		log: makeFakeLog(),
		registerAbort: () => () => {},
		isTTY: () => opts.tty ?? true,
		bannerAnimation: () => opts.pref ?? true,
	});
	await tick();
	return {fu, ctx, done};
}

test('an animated new chat prints nothing until the intro finishes, then the banner and the notices in order', async () => {
	const r = await animated({}, {}, {notice: 'Could not reopen it', profile: clanProfile as never});
	const intro = r.fu.chats[0]!.intro!;
	assert.ok(intro);
	assert.equal(intro.active(), true);
	assert.deepEqual(r.ctx.lines, []);
	intro.finish();
	assert.equal(r.ctx.lines.length, 3);
	assert.match(r.ctx.lines[0]!, /yena/);
	assert.match(r.ctx.lines[1]!, /The clan is here/);
	assert.match(r.ctx.lines[2]!, /Could not reopen it/);
	r.ctx.closeAll();
	await r.done;
});

test('closing the view while the intro runs still prints the banner', async () => {
	const r = await animated();
	r.fu.chats[0]!.close();
	await r.done;
	assert.match(r.ctx.lines[0]!, /yena/);
});

test('no intro for a resumed chat, a reattached chat, no colour, pref off or no terminal', async () => {
	const cases = [
		await animated({}, {history: async () => []}, {fresh: false, resume: 'sess-1'}),
		await animated({}, {opened: {reattached: {startedAt: Date.now()}}}),
		await animated({depth: 'none'}),
		await animated({pref: false}),
		await animated({tty: false}),
	];
	for (const r of cases) {
		assert.equal(r.fu.chats[0]!.intro, undefined);
		r.ctx.closeAll();
		await r.done;
	}
});

test('the scrollback after the intro is the banner of a chat without animation', async () => {
	const plainRun = await animated({pref: false}, {}, {notice: 'Could not reopen it'});
	const animatedRun = await animated({}, {}, {notice: 'Could not reopen it'});
	animatedRun.fu.chats[0]!.intro!.finish();
	assert.deepEqual(animatedRun.ctx.lines, plainRun.ctx.lines);
	for (const r of [plainRun, animatedRun]) {
		r.ctx.closeAll();
		await r.done;
	}
});
