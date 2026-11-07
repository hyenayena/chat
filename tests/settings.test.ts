import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import type {SettingsTab} from '../../../src/api.js';
import {registerChatProvider} from '../src/public.js';
import {cleanup, openChat, setup} from './helpers/env.js';
import {makeProvider} from './helpers/fake-provider.js';

const tab = (env: ReturnType<typeof setup>): SettingsTab => env.chat.settings!;
const row = (t: SettingsTab, key: string) => t.settings.find(s => s.key === key)!;

test('the Chat tab has the four rows, and its options follow the default provider', async () => {
	const env = setup({modes: ['default', 'acceptEdits']});
	const t = tab(env);
	assert.equal(t.title, 'Chat');
	assert.deepEqual(t.settings.map(s => s.key), ['permissionMode', 'inputMode', 'keepRunning', 'provider']);
	assert.deepEqual(row(t, 'permissionMode').options.map(o => o.value), ['', 'acceptEdits']);
	assert.deepEqual(row(t, 'provider').options.map(o => o.value), ['', 'fake']);
	cleanup.push(registerChatProvider(makeProvider({id: 'other', label: 'Other'}).provider)!);
	assert.deepEqual(row(tab(env), 'provider').options.map(o => o.label), ['First installed', 'Fake Chat', 'Other']);
});

test('setting values are stored in prefs.json and read back', async () => {
	const env = setup({modes: ['default', 'plan']});
	const t = tab(env);
	await row(t, 'permissionMode').set('plan');
	await row(t, 'inputMode').set('vim');
	await row(t, 'keepRunning').set('on');
	await row(t, 'provider').set('fake');
	assert.deepEqual(JSON.parse(readFileSync(path.join(env.dataDir, 'prefs.json'), 'utf8')), {v: 1, permissionMode: 'plan', inputMode: 'vim', keepRunning: true, provider: 'fake'});
	assert.equal(await row(t, 'permissionMode').get(), 'plan');
	assert.equal(await row(t, 'keepRunning').get(), 'on');
	await row(t, 'keepRunning').set('');
	assert.equal(await row(t, 'keepRunning').get(), '');
	await assert.rejects(Promise.resolve(row(t, 'permissionMode').set('auto')), /Unknown option/);
	await assert.rejects(Promise.resolve(row(t, 'provider').set('nope')), /Unknown option/);
});

test('mode and keep apply to the open chat at once; input mode reaches the view', async () => {
	const env = setup({modes: ['default', 'plan']});
	const a = await openChat(env);
	const t = tab(env);
	await row(t, 'permissionMode').set('plan');
	await row(t, 'permissionMode').set('');
	await row(t, 'keepRunning').set('on');
	assert.deepEqual(env.fake.sessions[0]!.modes, ['plan', 'default']);
	assert.deepEqual(env.fake.sessions[0]!.keeps, [true]);
	assert.equal(env.fu.chats[0]!.inputMode!(), 'normal');
	await row(t, 'inputMode').set('vim');
	assert.equal(env.fu.chats[0]!.inputMode!(), 'vim');
	a.ctx.closeAll();
	await a.done;
});

test('a hand-over from a provider shows in the rows', async () => {
	const env = setup({legacy: {permissionMode: 'plan', inputMode: 'vim'}, modes: ['default', 'plan']});
	const t = tab(env);
	assert.equal(await row(t, 'inputMode').get(), 'vim');
	assert.equal(await row(t, 'permissionMode').get(), 'plan');
	writeFileSync(path.join(env.dataDir, 'x'), '');
});
