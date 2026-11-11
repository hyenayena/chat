import assert from 'node:assert/strict';
import {afterEach, mock, test} from 'node:test';
import {currentChat, collectAnswer, openSession, type ModuleSessionRequest, type PermissionDecision, type PermissionRequest} from '../src/public.js';
import {setActivityEvents} from '../src/activity.js';
import {moduleSessionCount, resetModuleSessions, setModuleSessionLog} from '../src/module-sessions.js';
import {makeFakeLog, serialized} from './helpers/fake-log.js';
import {makeProvider, type FakeOptions, type FakeSession} from './helpers/fake-provider.js';
import {makeCtx} from './helpers/fake-ctx.js';
import {openChat, run, setup} from './helpers/env.js';

const settle = () => new Promise<void>(r => setImmediate(r));
const toolReq = (id: string): PermissionRequest => ({kind: 'tool', id, seq: 1, toolName: 'Bash', input: {command: 'ls'}, cwd: '/app', highlights: [], defaultToNo: false, always: false, oversize: false});
const questionReq = (id: string): PermissionRequest => ({
	kind: 'question',
	id,
	seq: 1,
	questions: [{question: 'Which?', header: 'H', multiSelect: false, options: [{label: 'A', description: ''}, {label: 'B', description: ''}]}],
});

afterEach(async () => {
	mock.timers.reset();
	await resetModuleSessions();
});

function arm(s: FakeSession) {
	const pend: PermissionRequest[] = [];
	const answers: Array<[string, PermissionDecision]> = [];
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
	const interrupts: number[] = [];
	loose.interrupt = async () => void interrupts.push(1);
	const request = (r: PermissionRequest) => {
		pend.push(r);
		s.emit({type: 'permission-requested', request: r, pending: pend.length});
	};
	return {pend, answers, interrupts, request};
}

async function mod(o: FakeOptions = {}, req: Partial<ModuleSessionRequest> = {}) {
	const env = setup(o);
	const h = await openSession({owner: 'clan', ...req});
	const s = env.fake.sessions[0]!;
	return {env, h, s, ...arm(s)};
}

const turn = (s: FakeSession, text: string, outcome: 'ok' | 'error' = 'ok', error?: string) => {
	s.emit({type: 'ui', event: {kind: 'text', messageId: 'm', text}});
	s.emit({type: 'turn-end', outcome, ...(error !== undefined && {error})});
};

test('open sends exactly the module request and an env without console commands', async () => {
	const seen: Array<{wait: boolean; keys: string[]}> = [];
	const env = setup();
	const base = env.fake.provider.open;
	env.fake.provider.open = async (req, e) => {
		seen.push({wait: await e.wait(async () => ({free: true})), keys: Object.keys(e).sort()});
		return base(req, e);
	};
	await openSession({owner: 'clan', mode: 'plan', model: 'm-1'});
	assert.deepEqual(env.fake.opens[0], {origin: 'module', fresh: true, attach: false, keep: false, mode: 'plan', model: 'm-1'});
	assert.deepEqual(seen, [{wait: false, keys: ['notice', 'print', 'wait']}]);
	assert.deepEqual(env.fake.admits, ['module']);
});

test('no provider, an unknown one, and the first registered as the default', async () => {
	await assert.rejects(openSession({owner: 'clan'}), /No chat provider is registered/);
	const env = setup();
	await assert.rejects(openSession({owner: 'clan', provider: 'nope'}), /Unknown chat provider "nope"/);
	const h = await openSession({owner: 'clan'});
	assert.equal(h.providerId, env.fake.provider.id);
});

test('bad owner, mode, prompts and model are refused before admit', async () => {
	const env = setup();
	await assert.rejects(openSession({owner: 'Bad Name'}), /Invalid module name/);
	await assert.rejects(openSession({owner: ''}), /Invalid module name/);
	await assert.rejects(openSession({owner: 'clan', mode: 'acceptEdits' as 'plan'}), /cannot use the mode "acceptEdits"/);
	await assert.rejects(openSession({owner: 'clan', mode: 'auto' as 'plan'}), /cannot use the mode "auto"/);
	await assert.rejects(openSession({owner: 'clan', prompts: 'allow' as 'show'}), /Invalid prompts/);
	await assert.rejects(openSession({owner: 'clan', model: 'Bad Model!'}), /Unknown model "Bad Model!"/);
	assert.deepEqual(env.fake.admits, []);
	assert.equal(moduleSessionCount(), 0);
});

test('refused while the user chat is open, the user chat untouched', async () => {
	const env = setup();
	const user = await openChat(env);
	await assert.rejects(openSession({owner: 'clan'}), /A chat is open; a module session starts only when no chat is open/);
	assert.equal(env.fake.opens.length, 1);
	assert.equal(env.fake.sessions[0]!.closed, 0);
	user.ctx.closeAll();
	await user.done;
});

test('refused while the user chat is still opening', async () => {
	let release!: () => void;
	const gate = new Promise<void>(r => (release = r));
	const env = setup({admit: () => gate});
	const user = await openChat(env);
	await assert.rejects(openSession({owner: 'clan'}), /A chat is open/);
	assert.deepEqual(env.fake.admits, ['user']);
	release();
	for (let i = 0; i < 100 && user.ctx.mounts === 0; i++) await new Promise<void>(r => setTimeout(r, 5));
	user.ctx.closeAll();
	await user.done;
	const h = await openSession({owner: 'clan'});
	assert.equal(h.state, 'idle');
});

test('refused while another module session is open', async () => {
	const {env} = await mod();
	await assert.rejects(openSession({owner: 'other'}), /A module session is already open/);
	assert.equal(env.fake.opens.length, 1);
});

test('a failing admit rejects and registers nothing', async () => {
	const env = setup({admit: async () => Promise.reject(new Error('API_KEY_ONLY'))});
	await assert.rejects(openSession({owner: 'clan'}), /API_KEY_ONLY/);
	assert.equal(moduleSessionCount(), 0);
	assert.equal(env.fake.opens.length, 0);
});

test('an open that returns nothing is the busy error', async () => {
	setup({open: async () => undefined});
	await assert.rejects(openSession({owner: 'clan'}), /Another session is running; the module session was not opened/);
	assert.equal(moduleSessionCount(), 0);
});

test('send admits the module origin each time; a throwing admitSend blocks it', async () => {
	let block = false;
	const {env, h, s} = await mod({
		admitSend: () => {
			if (block) throw new Error('not admitted');
		},
	});
	h.send('one');
	h.send('two');
	assert.deepEqual(env.fake.admitSendCalls, ['module', 'module']);
	block = true;
	assert.throws(() => h.send('three'), /not admitted/);
	assert.deepEqual(s.sent.map(x => x.text), ['one', 'two']);
});

test('send refuses empty text, a running session and an ended one', async () => {
	const {h, s} = await mod();
	assert.throws(() => h.send('  '), /The message is empty/);
	s.state = 'running';
	assert.throws(() => h.send('x'), /The module session is answering/);
	s.state = 'idle';
	await h.end();
	assert.throws(() => h.send('x'), /The module session has ended/);
});

test('the handle is frozen and has no allow path; deny only touches pending ids', async () => {
	const {h, answers, request} = await mod({}, {prompts: 'show'});
	assert.ok(Object.isFrozen(h));
	assert.equal('answerPermission' in h, false);
	assert.equal('setMode' in h, false);
	request(toolReq('a'));
	assert.ok(Object.isFrozen(h.pendingPermissions));
	assert.throws(() => (h.pendingPermissions as PermissionRequest[]).pop());
	assert.equal(h.pendingPermissions.length, 1);
	assert.equal(h.deny('zzz'), false);
	assert.equal(h.deny('a'), true);
	assert.deepEqual(answers, [['a', {kind: 'deny'}]]);
	assert.equal(h.deny('a'), false);
});

test("prompts 'deny' denies tool and question requests at once", async () => {
	const {answers, request, h} = await mod();
	request(toolReq('t'));
	request(questionReq('q'));
	await settle();
	assert.deepEqual(answers, [['t', {kind: 'deny'}], ['q', {kind: 'deny'}]]);
	assert.equal(h.pendingPermissions.length, 0);
});

test("prompts 'show' keeps requests and cancels an unanswered one after the timeout", async () => {
	const {pend, answers, request, h} = await mod({}, {prompts: 'show', promptTimeoutMs: 5000});
	mock.timers.enable({apis: ['setTimeout']});
	request(toolReq('a'));
	request(toolReq('b'));
	assert.equal(h.pendingPermissions.length, 2);
	assert.equal(h.deny('b'), true);
	mock.timers.tick(4999);
	assert.deepEqual(pend.map(r => r.id), ['a']);
	mock.timers.tick(1);
	assert.deepEqual(answers.at(-1), ['a', {kind: 'cancel', cause: 'timeout'}]);
	assert.equal(answers.length, 2);
});

test('a resolved prompt clears its timer', async () => {
	const {answers, request, h, s} = await mod({}, {prompts: 'show', promptTimeoutMs: 5000});
	mock.timers.enable({apis: ['setTimeout']});
	request(toolReq('a'));
	h.deny('a');
	mock.timers.tick(10_000);
	assert.deepEqual(answers, [['a', {kind: 'deny'}]]);
	assert.equal(s.pendingPermissions.length, 0);
});

test('collectAnswer returns the last text scrubbed, with a scrubbed error', async () => {
	const {h, s} = await mod({opened: {scrub: (t: string) => t.replace(/SECRET/g, '***')}});
	const p = collectAnswer(h, 'q');
	s.emit({type: 'ui', event: {kind: 'text', messageId: 'a', text: 'first'}});
	turn(s, 'the SECRET answer', 'error', 'failed with SECRET');
	assert.deepEqual(await p, {outcome: 'error', text: 'the *** answer', error: 'failed with ***'});
	assert.deepEqual(s.sent.map(x => x.text), ['q']);
});

test('collectAnswer falls back to the result text', async () => {
	const {h, s} = await mod();
	const p = collectAnswer(h, 'q');
	s.emit({type: 'ui', event: {kind: 'result', text: 'from result'} as never});
	s.emit({type: 'turn-end', outcome: 'ok'});
	assert.equal((await p).text, 'from result');
});

test('abort mid-turn cancels pending, awaits interrupt and resolves interrupted', async () => {
	const {h, s, answers, interrupts, request} = await mod({}, {prompts: 'show'});
	const ac = new AbortController();
	const p = collectAnswer(h, 'q', {signal: ac.signal});
	request(toolReq('a'));
	ac.abort();
	const r = await p;
	assert.equal(r.outcome, 'interrupted');
	assert.deepEqual(answers, [['a', {kind: 'cancel', cause: 'aborted'}]]);
	assert.equal(interrupts.length, 1);
	assert.equal(s.sent.length, 1);
});

test('a pre-aborted signal sends nothing', async () => {
	const {h, s, interrupts} = await mod();
	const r = await collectAnswer(h, 'q', {signal: AbortSignal.abort()});
	assert.equal(r.outcome, 'interrupted');
	assert.equal(s.sent.length, 0);
	assert.equal(interrupts.length, 0);
});

test('timeoutMs resolves timeout and cancels pending; the value is clamped to 1 s .. 1 h', async () => {
	const {h, answers, interrupts, request} = await mod({}, {prompts: 'show'});
	mock.timers.enable({apis: ['setTimeout']});
	const p = collectAnswer(h, 'q', {timeoutMs: 1});
	request(toolReq('a'));
	mock.timers.tick(999);
	assert.equal(answers.length, 0);
	mock.timers.tick(1);
	assert.equal((await p).outcome, 'timeout');
	assert.deepEqual(answers, [['a', {kind: 'cancel', cause: 'timeout'}]]);
	assert.equal(interrupts.length, 1);
});

test('a huge timeoutMs is capped at one hour', async () => {
	const {h, s} = await mod();
	mock.timers.enable({apis: ['setTimeout']});
	const p = collectAnswer(h, 'q', {timeoutMs: 1e12});
	s.state = 'running';
	mock.timers.tick(3_599_999);
	let done = false;
	void p.then(() => (done = true));
	await settle();
	assert.equal(done, false);
	mock.timers.tick(1);
	assert.equal((await p).outcome, 'timeout');
});

test('collectAnswer refuses an ended or running session; closed mid-turn is interrupted', async () => {
	const {h, s} = await mod();
	s.state = 'running';
	await assert.rejects(collectAnswer(h, 'q'), /The module session is answering/);
	s.state = 'idle';
	const p = collectAnswer(h, 'q');
	s.emit({type: 'state', state: 'closed'});
	assert.deepEqual(await p, {outcome: 'interrupted', text: '', error: 'The session ended'});
	await h.end();
	await assert.rejects(collectAnswer(h, 'q'), /The module session has ended/);
	await assert.rejects(collectAnswer({} as never, 'q'), /Not a module session/);
});

test('end cancels pending as closed, closes then flushes once, is idempotent and unregisters', async () => {
	const {env, h, answers, request} = await mod({}, {prompts: 'show'});
	request(toolReq('a'));
	await Promise.all([h.end(), h.end()]);
	await h.end();
	assert.deepEqual(answers, [['a', {kind: 'cancel', cause: 'closed'}]]);
	assert.deepEqual(env.fake.events.slice(-2), ['close', 'flush']);
	assert.equal(env.fake.events.filter(e => e === 'flush').length, 1);
	assert.equal(moduleSessionCount(), 0);
	assert.equal(h.state, 'closed');
});

test('end unregisters even when flush throws', async () => {
	const {h} = await mod({opened: {flush: async () => Promise.reject(new Error('flush boom'))}});
	await h.end();
	assert.equal(moduleSessionCount(), 0);
	const again = await openSession({owner: 'clan'});
	assert.equal(again.state, 'idle');
});

test('an idle session ends after idleTimeoutMs (clamped), events reset it, not while running or pending', async () => {
	const {h, s, request} = await mod({}, {prompts: 'show', idleTimeoutMs: 1});
	mock.timers.enable({apis: ['setTimeout']});
	s.emit({type: 'state', state: 'idle'});
	mock.timers.tick(9999);
	assert.equal(moduleSessionCount(), 1);
	s.emit({type: 'state', state: 'idle'});
	mock.timers.tick(9999);
	assert.equal(moduleSessionCount(), 1);
	s.state = 'running';
	s.emit({type: 'state', state: 'running'});
	mock.timers.tick(100_000);
	assert.equal(moduleSessionCount(), 1);
	s.state = 'idle';
	request(toolReq('a'));
	mock.timers.tick(100_000_000);
	assert.equal(moduleSessionCount(), 1, 'a pending request keeps it');
	h.deny('a');
	mock.timers.tick(10_000);
	await settle();
	assert.equal(moduleSessionCount(), 0);
	assert.equal(h.state, 'closed');
});

test('idle and prompt timeouts are capped at one hour', async () => {
	const {request, answers} = await mod({}, {prompts: 'show', idleTimeoutMs: 1e12, promptTimeoutMs: 1e12});
	mock.timers.enable({apis: ['setTimeout']});
	request(toolReq('a'));
	mock.timers.tick(3_599_999);
	assert.equal(answers.length, 0);
	mock.timers.tick(1);
	assert.deepEqual(answers, [['a', {kind: 'cancel', cause: 'timeout'}]]);
});

test('the user chat ends a module session first and says so; a failing user admit leaves it running', async () => {
	let fail = false;
	const env = setup({
		admit: async origin => {
			if (origin === 'user' && fail) throw new Error('user admit failed');
		},
	});
	const h = await openSession({owner: 'clan'});
	const p = collectAnswer(h, 'q');
	fail = true;
	await assert.rejects(run(env.chat, [], makeCtx()), /user admit failed/);
	assert.equal(moduleSessionCount(), 1);
	fail = false;
	const user = await openChat(env);
	assert.deepEqual(await p, {outcome: 'interrupted', text: '', error: 'The user opened a chat'});
	assert.ok(user.ctx.lines.includes('Ended the session of module "clan" to open this chat.'));
	assert.equal(moduleSessionCount(), 0);
	const ev = env.fake.events;
	assert.ok(ev.indexOf('close') < ev.lastIndexOf('open'), ev.join(','));
	user.ctx.closeAll();
	await user.done;
});

test('currentChat never returns a module session', async () => {
	await mod();
	assert.equal(currentChat(), undefined);
});

test('onNotice gets scrubbed notices; without it they are dropped', async () => {
	const got: string[] = [];
	const f = makeProvider();
	f.provider.redact = t => t.replace(/SECRET/g, '***');
	const base = f.provider.open;
	f.provider.open = async (req, e) => {
		e.notice('a SECRET notice');
		e.print('printed SECRET');
		return base(req, e);
	};
	const {registerChatProvider} = await import('../src/public.js');
	const off = registerChatProvider(f.provider)!;
	try {
		await openSession({owner: 'clan', onNotice: t => void got.push(t)});
		assert.deepEqual(got.map(t => t.includes('SECRET')), [false, false]);
		await resetModuleSessions();
		await openSession({owner: 'clan'});
		assert.equal(got.length, 2);
	} finally {
		off();
	}
});

test('logs carry no message or answer text', async () => {
	const log = makeFakeLog();
	setModuleSessionLog(log);
	const {h, s} = await mod();
	const p = collectAnswer(h, 'PROMPTTEXT');
	turn(s, 'ANSWERTEXT', 'error', 'ERRORTEXT');
	await p;
	await h.end();
	const out = serialized(log);
	for (const secret of ['PROMPTTEXT', 'ANSWERTEXT', 'ERRORTEXT']) assert.equal(out.includes(secret), false, secret);
	for (const msg of ['module session opened', 'answer collected', 'module session ended']) assert.ok(log.records.some(r => r.msg === msg), msg);
});

test('the idle, prompt and answer timers never keep the process alive', async () => {
	const real = globalThis.setTimeout;
	const timers: Array<{unref: () => unknown; unrefd: boolean}> = [];
	globalThis.setTimeout = ((fn: () => void, ms?: number) => {
		const t = real(fn, ms) as unknown as {unref: () => unknown};
		const orig = t.unref.bind(t);
		const rec = {unrefd: false, unref: () => ((rec.unrefd = true), orig())};
		timers.push(rec);
		return Object.assign(t, {unref: rec.unref});
	}) as unknown as typeof setTimeout;
	try {
		const {h, s, request} = await mod({}, {prompts: 'show'});
		request(toolReq('a'));
		s.emit({type: 'state', state: 'idle'});
		const p = collectAnswer(h, 'hi', {timeoutMs: 5000});
		turn(s, 'ok');
		await p;
		assert.ok(timers.length >= 3);
		assert.deepEqual(timers.filter(t => !t.unrefd).length, 0);
	} finally {
		globalThis.setTimeout = real;
	}
});

test('neither public entry exports the internals or an allow path', async () => {
	const pub = (await import('../src/public.js')) as Record<string, unknown>;
	const ui = (await import('../src/public-ui.js')) as Record<string, unknown>;
	for (const name of ['internalsOf', 'answerPermission', 'setMode', 'resetModuleSessions', 'endModuleSessions']) {
		assert.equal(name in pub, false, `public.ts ${name}`);
		assert.equal(name in ui, false, `public-ui.ts ${name}`);
	}
	const {h} = await mod();
	for (const name of ['answerPermission', 'setMode', 'allow', 'opened', 'internals']) assert.equal(name in h, false, name);
});

test('a module session reports its activity under chat:module-<owner> and releases it on end', async () => {
	const sent: Array<{id: string; label: string; state: string}> = [];
	setActivityEvents({emit: (_t, p) => void sent.push(p as (typeof sent)[number]), on: () => () => {}});
	try {
		const {h, s} = await mod();
		s.emit({type: 'state', state: 'running'});
		s.emit({type: 'state', state: 'idle'});
		await h.end();
		assert.deepEqual(
			sent.map(r => r.state),
			['running', 'ok', 'gone'],
		);
		assert.ok(sent.every(r => r.id === 'module-clan' && r.label === 'chat · clan'));
	} finally {
		setActivityEvents(undefined);
	}
});
