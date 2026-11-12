import assert from 'node:assert/strict';
import {existsSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {gallerySections} from '../src/kit.js';
import plugin from '../src/index.js';
import {registerChatProvider} from '../src/public.js';
import {makeFakeLog} from './helpers/fake-log.js';
import {makeProvider} from './helpers/fake-provider.js';

const host = (log?: ReturnType<typeof makeFakeLog>) => ({dataDir: '/tmp/chat-test', events: {emit: () => {}, on: () => () => {}}, ...(log && {log})}) as unknown as Parameters<typeof plugin>[0];

const SECTIONS = ['chat', 'diff', 'tools', 'status', 'plan', 'layout', 'markdown'];

test('the plugin returns the chat and fix commands, logs the load and registers its gallery sections', async () => {
	const log = makeFakeLog();
	assert.deepEqual((await plugin(host(log))).map(c => c.name), ['chat', 'fix']);
	assert.deepEqual(log.records.filter(r => r.level === 'info').map(r => r.msg), ['plugin loaded']);
	const names = gallerySections().map(s => s.name);
	for (const name of SECTIONS) assert.ok(names.includes(name), name);
});

test('a second load warns for each section that is already registered', async () => {
	const log = makeFakeLog();
	await plugin(host(log));
	const skipped = log.records.filter(r => r.level === 'warn' && r.msg === 'gallery section skipped').map(r => r.fields['section']);
	assert.deepEqual(skipped, SECTIONS);
});

test('a host without log falls back to a noop logger', async () => {
	assert.deepEqual((await plugin(host())).map(c => c.name), ['chat', 'fix']);
});

test('loading the plugin never reads or hands over legacy prefs, even with a provider registered', async () => {
	const dataDir = mkdtempSync(path.join(tmpdir(), 'chat-load-'));
	const fake = makeProvider({legacy: {keepRunning: true}});
	let reads = 0;
	fake.provider.legacyPrefs = async () => (reads++, {keepRunning: true});
	const unregister = registerChatProvider(fake.provider)!;
	try {
		await plugin({dataDir, events: {emit: () => {}, on: () => () => {}}} as unknown as Parameters<typeof plugin>[0]);
		assert.equal(reads, 0);
		assert.equal(existsSync(path.join(dataDir, 'prefs.json')), false);
	} finally {
		unregister();
		rmSync(dataDir, {recursive: true, force: true});
	}
});
