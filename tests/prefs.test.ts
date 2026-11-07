import assert from 'node:assert/strict';
import {chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterEach, test} from 'node:test';
import {createPrefs, parsePrefs} from '../src/prefs.js';
import {registerChatProvider} from '../src/public.js';
import {makeFakeLog} from './helpers/fake-log.js';
import {makeProvider, type FakeOptions} from './helpers/fake-provider.js';

const cleanup: Array<() => void> = [];
afterEach(() => {
	for (const fn of cleanup.splice(0).reverse()) fn();
});

function env(opts: FakeOptions[] = [], files: Record<string, string> = {}) {
	for (const fn of cleanup.splice(0).reverse()) fn();
	const dataDir = mkdtempSync(path.join(tmpdir(), 'chat-prefs-'));
	cleanup.push(() => {
		chmodSync(dataDir, 0o700);
		rmSync(dataDir, {recursive: true, force: true});
	});
	for (const [name, text] of Object.entries(files)) writeFileSync(path.join(dataDir, name), text);
	const fakes = opts.map(o => {
		const f = makeProvider(o);
		cleanup.push(registerChatProvider(f.provider)!);
		return f;
	});
	const log = makeFakeLog();
	return {dataDir, fakes, log, prefs: createPrefs({dataDir, log}), file: path.join(dataDir, 'prefs.json')};
}

test('parsePrefs accepts the planned shape and refuses wrong versions and values', () => {
	assert.deepEqual(parsePrefs({v: 1, permissionMode: 'plan', inputMode: 'vim', keepRunning: true, provider: 'claude', extra: 1}), {permissionMode: 'plan', inputMode: 'vim', keepRunning: true, provider: 'claude'});
	for (const bad of [null, [], {}, {v: 2}, {v: 1, permissionMode: 'default'}, {v: 1, inputMode: 'emacs'}, {v: 1, keepRunning: 'on'}, {v: 1, provider: ''}, {v: 1, provider: 5}]) {
		assert.equal(parsePrefs(bad), undefined, JSON.stringify(bad));
	}
});

test('an existing file is read; invalid or unreadable content falls back to the defaults', async () => {
	const ok = env([{}], {'prefs.json': JSON.stringify({v: 1, inputMode: 'vim'})});
	assert.deepEqual(await ok.prefs.load(), {inputMode: 'vim'});
	const bad = env([{legacy: {keepRunning: true}}], {'prefs.json': '{not json'});
	assert.deepEqual(await bad.prefs.load(), {});
	assert.ok(bad.log.records.some(r => r.level === 'warn' && r.msg === 'prefs invalid; using the defaults'));
	assert.equal(readFileSync(bad.file, 'utf8'), '{not json');
	const wrong = env([{legacy: {keepRunning: true}}], {'prefs.json': JSON.stringify({v: 1, permissionMode: 'nope'})});
	assert.deepEqual(await wrong.prefs.load(), {});
});

test('the hand-over runs once, takes the first non-empty provider, writes before it clears', async () => {
	const order: string[] = [];
	const e = env([
		{id: 'first', legacy: {}, clearLegacy: async () => void order.push('clear:first')},
		{id: 'second', legacy: {permissionMode: 'plan', keepRunning: true}},
	]);
	e.fakes[1]!.provider.clearLegacyPrefs = async () => {
		order.push(`clear:second:file=${existsSync(e.file)}`);
	};
	assert.deepEqual(await e.prefs.load(), {permissionMode: 'plan', keepRunning: true});
	assert.deepEqual(JSON.parse(readFileSync(e.file, 'utf8')), {v: 1, permissionMode: 'plan', keepRunning: true});
	assert.deepEqual(order, ['clear:first', 'clear:second:file=true']);
	let calls = 0;
	e.fakes[1]!.provider.legacyPrefs = async () => (calls++, {});
	await e.prefs.load();
	assert.equal(calls, 0);
});

test('a failed write does not clear, logs the failure and goes on with the defaults', async () => {
	let cleared = 0;
	const e = env([{legacy: {inputMode: 'vim'}, clearLegacy: async () => void cleared++}]);
	mkdirSync(`${e.file}.${process.pid}.tmp`);
	assert.deepEqual(await e.prefs.load(), {});
	assert.equal(cleared, 0);
	assert.ok(e.log.records.some(r => r.level === 'warn' && r.msg === 'prefs hand-over failed'));
	assert.equal(existsSync(e.file), false);
});

test('a provider whose legacy read fails aborts the hand-over without a write', async () => {
	const e = env([{legacyThrows: true}]);
	assert.deepEqual(await e.prefs.load(), {});
	assert.equal(existsSync(e.file), false);
	assert.ok(e.log.records.some(r => r.msg === 'prefs hand-over failed'));
});

test('without a provider nothing is written, and the hand-over happens once one is registered', async () => {
	const e = env([]);
	assert.deepEqual(await e.prefs.load(), {});
	assert.equal(existsSync(e.file), false);
	const f = makeProvider({legacy: {inputMode: 'vim'}});
	cleanup.push(registerChatProvider(f.provider)!);
	assert.deepEqual(await e.prefs.load(), {inputMode: 'vim'});
});

test('update writes atomically, keeps the other keys and removes a key given as undefined', async () => {
	const e = env([{}], {'prefs.json': JSON.stringify({v: 1, inputMode: 'vim', keepRunning: true})});
	await e.prefs.update({permissionMode: 'auto', keepRunning: undefined});
	assert.deepEqual(JSON.parse(readFileSync(e.file, 'utf8')), {v: 1, inputMode: 'vim', permissionMode: 'auto'});
	assert.deepEqual(e.prefs.cached(), {inputMode: 'vim', permissionMode: 'auto'});
	assert.equal(existsSync(`${e.file}.${process.pid}.tmp`), false);
});

test('the default provider is the saved one when registered, else the first, and none throws', async () => {
	const e = env([{id: 'a', label: 'A'}, {id: 'b', label: 'B'}]);
	await e.prefs.load();
	assert.equal(e.prefs.defaultProvider().id, 'a');
	await e.prefs.update({provider: 'b'});
	assert.equal(e.prefs.defaultProvider().id, 'b');
	await e.prefs.update({provider: 'gone'});
	assert.equal(e.prefs.defaultProvider().id, 'a');
	const none = env([]);
	assert.throws(() => none.prefs.defaultProvider(), /No chat provider is installed/);
});
