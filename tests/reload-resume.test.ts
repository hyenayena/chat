import assert from 'node:assert/strict';
import {existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import type {EventBus} from '../../../src/api.js';
import {createChatCommands} from '../src/commands.js';
import {RELOAD_TOPIC} from '../src/kit.js';
import {createReloadResume, RELOAD_RESUME_FILE, RELOAD_RESUME_MAX_AGE_MS} from '../src/reload-resume.js';
import {registerChatProfile, registerChatProvider} from '../src/public.js';
import {makeCtx} from './helpers/fake-ctx.js';
import {makeFakeLog} from './helpers/fake-log.js';
import {makeProvider, type FakeOptions} from './helpers/fake-provider.js';
import {makeUi} from './helpers/fake-ui.js';
import {cleanup, run, tick} from './helpers/env.js';

const tmp = (): string => {
	const dir = mkdtempSync(path.join(tmpdir(), 'chat-reload-'));
	cleanup.push(() => rmSync(dir, {recursive: true, force: true}));
	return dir;
};

const bus = (): EventBus & {fire(payload: unknown): void} => {
	const handlers: Array<(p: unknown) => void> = [];
	return {emit: (_t, p) => handlers.forEach(h => h(p)), on: (_t, h) => (handlers.push(h), () => {}), fire: p => handlers.forEach(h => h(p))};
};

function setup(opts: FakeOptions = {}, dataDir = tmp()) {
	const events = bus();
	const fake = makeProvider(opts);
	cleanup.push(registerChatProvider(fake.provider)!);
	const fu = makeUi();
	const log = makeFakeLog();
	const commands = createChatCommands({dataDir, log, events, flow: {loadUi: async () => fu.ui}, devFailure: async () => undefined});
	return {dataDir, fake, fu, log, events, chat: commands.find(c => c.name === 'chat')!, file: path.join(dataDir, RELOAD_RESUME_FILE)};
}

async function open(env: ReturnType<typeof setup>, args: string[] = []) {
	const ctx = makeCtx();
	const done = run(env.chat, args, ctx);
	for (let i = 0; i < 100 && ctx.mounts === 0; i++) await new Promise<void>(r => setTimeout(r, 5));
	return {ctx, done};
}

const entry = (over: Record<string, unknown> = {}) => JSON.stringify({v: 1, at: Date.now(), provider: 'fake', sessionId: 'sess-1', ...over});

test('the store round-trips an entry, writes 0600 and deletes the file when taken', async () => {
	const dir = tmp();
	const store = createReloadResume({dataDir: dir});
	store.record({provider: 'fake', sessionId: 'sess-1', mode: 'plan'});
	const file = path.join(dir, RELOAD_RESUME_FILE);
	assert.equal(statSync(file).mode & 0o777, 0o600);
	assert.deepEqual(await store.take(), {provider: 'fake', sessionId: 'sess-1', mode: 'plan'});
	assert.equal(existsSync(file), false);
	assert.equal(await store.take(), undefined);
});

test('stale, future, invalid and unparsable files are deleted and ignored', async () => {
	const dir = tmp();
	const file = path.join(dir, RELOAD_RESUME_FILE);
	const now = 10_000_000;
	const store = createReloadResume({dataDir: dir, now: () => now});
	const cases: Array<[string, string]> = [
		['stale', entry({at: now - RELOAD_RESUME_MAX_AGE_MS - 1})],
		['future', entry({at: now + 120_000})],
		['bad id', entry({at: now, sessionId: '../x'})],
		['no provider', entry({at: now, provider: ''})],
		['long mode', entry({at: now, mode: 'm'.repeat(33)})],
		['bad version', entry({at: now, v: 2})],
		['junk', 'not json'],
	];
	for (const [label, text] of cases) {
		writeFileSync(file, text);
		assert.equal(await store.take(), undefined, label);
		assert.equal(existsSync(file), false, label);
	}
	writeFileSync(file, entry({at: now - RELOAD_RESUME_MAX_AGE_MS}));
	assert.equal((await store.take())?.sessionId, 'sess-1');
});

test('record refuses a bad session id and never throws on a write failure', () => {
	const dir = tmp();
	const log = makeFakeLog();
	createReloadResume({dataDir: dir, log}).record({provider: 'fake', sessionId: 'a/b'});
	assert.equal(existsSync(path.join(dir, RELOAD_RESUME_FILE)), false);
	const blocked = path.join(dir, 'file');
	writeFileSync(blocked, '');
	createReloadResume({dataDir: path.join(blocked, 'sub'), log}).record({provider: 'fake', sessionId: 'sess-1'});
	assert.equal(log.records.filter(r => r.msg === 'reload resume not recorded').length, 2);
});

test('a reload from the main view or the assistant records the open session; others record nothing', async () => {
	const env = setup();
	env.events.fire({via: 'view', view: 'main'});
	assert.equal(existsSync(env.file), false, 'no chat is open');
	const a = await open(env);
	for (const payload of [{via: 'console'}, {via: 'view', view: 'panel'}, {via: 'bridge', caller: 'scheduler'}, {via: 'bridge'}, 'junk']) {
		env.events.fire(payload);
		assert.equal(existsSync(env.file), false, JSON.stringify(payload));
	}
	env.events.fire({via: 'view', view: 'main'});
	const saved = JSON.parse(readFileSync(env.file, 'utf8'));
	assert.deepEqual({v: saved.v, provider: saved.provider, sessionId: saved.sessionId, mode: saved.mode}, {v: 1, provider: 'fake', sessionId: 'aaaaaaaa-1111', mode: 'default'});
	rmSync(env.file);
	env.events.fire({via: 'bridge', caller: 'yena'});
	assert.equal(existsSync(env.file), true);
	a.ctx.closeAll();
	await a.done;
});

test('the first bare chat after the start reopens the recorded session with attach and the recorded mode', async () => {
	const first = setup({titles: {'aaaaaaaa-1111': 'T'}});
	const a = await open(first);
	first.events.fire({via: 'view', view: 'main'});
	a.ctx.closeAll();
	await a.done;

	const restarted = createChatCommands({dataDir: first.dataDir, log: makeFakeLog(), events: bus(), flow: {loadUi: async () => makeUi().ui}, devFailure: async () => undefined});
	const chat = restarted.find(c => c.name === 'chat')!;
	const ctx = makeCtx();
	const done = run(chat, [], ctx);
	for (let i = 0; i < 100 && ctx.mounts === 0; i++) await new Promise<void>(r => setTimeout(r, 5));
	const req = first.fake.opens[1]!;
	assert.equal(req.resume, 'aaaaaaaa-1111');
	assert.equal(req.fresh, false);
	assert.equal(req.attach, true);
	assert.equal(req.mode, 'default');
	assert.equal(req.origin, 'user');
	assert.equal(existsSync(first.file), false);
	ctx.closeAll();
	await done;
	const c = makeCtx();
	const again = run(chat, [], c);
	for (let i = 0; i < 100 && c.mounts === 0; i++) await new Promise<void>(r => setTimeout(r, 5));
	assert.equal(first.fake.opens[2]?.fresh, true, 'only the first bare chat consumes the marker');
	c.closeAll();
	await again;
});

test('a marker whose session is gone, or whose open throws, falls back to a new chat with a notice', async () => {
	const dir = tmp();
	const env = setup({}, dir);
	writeFileSync(env.file, entry());
	const a = await open(env);
	assert.equal(env.fake.opens[0]?.fresh, true);
	assert.equal(env.fake.opens[0]?.attach, true);
	assert.ok(a.ctx.lines.some(l => l.includes('Could not reopen the chat after reload')));
	assert.equal('notice' in env.fake.opens[0]!, false);
	a.ctx.closeAll();
	await a.done;
});

test('a signal or headless ctx does not consume the marker', async () => {
	const env = setup({titles: {'sess-1': 'T'}});
	writeFileSync(env.file, entry());
	const a = makeCtx({signal: true});
	const done = run(env.chat, [], a);
	await tick();
	assert.equal(existsSync(env.file), true);
	assert.equal(env.fake.opens[0]?.fresh, true);
	a.closeAll();
	await done;
	const h = {...makeCtx(), headless: true};
	const hd = run(env.chat, [], h);
	await tick();
	assert.equal(existsSync(env.file), true);
	h.closeAll();
	await hd;
});

test('a profile session goes through the profile path', async () => {
	const env = setup();
	writeFileSync(path.join(env.dataDir, 'profiles.json'), JSON.stringify({v: 1, sessions: {'clan-1': {id: 'clan', owner: 'clan', noun: 'clan', args: ['skeptic'], at: 1, last: 2}}}));
	cleanup.push(
		registerChatProfile({
			id: 'clan',
			owner: 'clan',
			build: async args => ({id: 'clan', owner: 'clan', noun: 'clan', args, appendSystemPrompt: 'M.', mainTools: ['Agent'], agents: {skeptic: {description: 'd', prompt: 'p', label: 'S', tone: 'teal'}}}),
		})!,
	);
	writeFileSync(env.file, entry({sessionId: 'clan-1'}));
	const a = await open(env);
	const req = env.fake.opens[0]!;
	assert.equal(req.resume, 'clan-1');
	assert.equal(req.attach, false);
	assert.equal(req.keep, false);
	assert.equal(req.profile?.id, 'clan');
	a.ctx.closeAll();
	await a.done;
});

test('record replaces a symlink at the marker path without writing through it', async () => {
	const dir = tmp();
	const target = path.join(dir, 'target.txt');
	writeFileSync(target, 'keep');
	const file = path.join(dir, RELOAD_RESUME_FILE);
	symlinkSync(target, file);
	const store = createReloadResume({dataDir: dir});
	store.record({provider: 'fake', sessionId: 'sess-1'});
	assert.equal(readFileSync(target, 'utf8'), 'keep');
	assert.equal(lstatSync(file).isSymbolicLink(), false);
	assert.equal((await store.take())?.sessionId, 'sess-1');
});

test('take never reads through a symlink: a link to a valid marker is removed and ignored', async () => {
	const dir = tmp();
	const target = path.join(dir, 'elsewhere.json');
	writeFileSync(target, entry());
	const file = path.join(dir, RELOAD_RESUME_FILE);
	symlinkSync(target, file);
	assert.equal(await createReloadResume({dataDir: dir}).take(), undefined);
	assert.equal(existsSync(file), false);
	assert.equal(readFileSync(target, 'utf8'), entry({at: JSON.parse(readFileSync(target, 'utf8')).at}));
});

test('a marker that is a directory or an oversize junk file never throws and leaves no entry', async () => {
	const dir = tmp();
	const file = path.join(dir, RELOAD_RESUME_FILE);
	const store = createReloadResume({dataDir: dir});
	mkdirSync(file);
	assert.equal(await store.take(), undefined);
	rmSync(file, {recursive: true, force: true});
	writeFileSync(file, 'x'.repeat(2_000_000));
	assert.equal(await store.take(), undefined);
	assert.equal(existsSync(file), false);
});

test('inherited keys and extra fields are not trusted', async () => {
	const dir = tmp();
	const file = path.join(dir, RELOAD_RESUME_FILE);
	const store = createReloadResume({dataDir: dir});
	writeFileSync(file, `{"v":1,"at":${Date.now()},"provider":"fake","sessionId":"sess-1","__proto__":{"mode":"x"},"extra":"y"}`);
	assert.deepEqual(await store.take(), {provider: 'fake', sessionId: 'sess-1'});
	for (const id of ['a b', 'a\nb', '..', 'a\u0000b', '']) {
		writeFileSync(file, entry({sessionId: id}));
		assert.equal(await store.take(), undefined, JSON.stringify(id));
	}
});

test("a caller like 'yena ' or 'Yena' does not record", async () => {
	const env = setup();
	const a = await open(env);
	for (const caller of ['yena ', 'Yena', 'scheduler', ' yena']) {
		env.events.fire({via: 'bridge', caller});
		assert.equal(existsSync(env.file), false, caller);
	}
	a.ctx.closeAll();
	await a.done;
});

test('two bare chats started together consume the marker once and the notice hides provider error text', async () => {
	const env = setup({titles: {'sess-1': 'T'}});
	writeFileSync(env.file, entry());
	const c1 = makeCtx();
	const c2 = makeCtx();
	const d1 = run(env.chat, [], c1);
	const d2 = run(env.chat, [], c2);
	for (let i = 0; i < 100 && c1.mounts + c2.mounts < 2; i++) await new Promise<void>(r => setTimeout(r, 5));
	assert.equal(env.fake.opens.filter(o => o.resume === 'sess-1').length, 1);
	assert.equal(existsSync(env.file), false);
	c1.closeAll();
	c2.closeAll();
	await Promise.all([d1, d2]);
});

test('the fallback notice carries no provider error text', async () => {
	const env = setup();
	writeFileSync(env.file, entry({sessionId: 'sess-secret-1'}));
	const a = await open(env);
	const notice = a.ctx.lines.filter(l => l.includes('Could not reopen'));
	assert.equal(notice.length, 1);
	assert.equal(notice[0]!.includes('sess-secret-1'), false);
	a.ctx.closeAll();
	await a.done;
});
