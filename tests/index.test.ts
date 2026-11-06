import assert from 'node:assert/strict';
import {test} from 'node:test';
import {gallerySections} from '../src/kit.js';
import plugin from '../src/index.js';
import {makeFakeLog} from './helpers/fake-log.js';

const host = (log?: ReturnType<typeof makeFakeLog>) => ({dataDir: '/tmp/chat-test', events: {emit: () => {}, on: () => () => {}}, ...(log && {log})}) as unknown as Parameters<typeof plugin>[0];

const SECTIONS = ['chat', 'diff', 'tools', 'status', 'plan', 'markdown'];

test('the plugin has no commands, logs the load and registers its gallery sections', async () => {
	const log = makeFakeLog();
	assert.deepEqual(await plugin(host(log)), []);
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
	assert.deepEqual(await plugin(host()), []);
});
