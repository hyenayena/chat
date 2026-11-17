import assert from 'node:assert/strict';
import {test} from 'node:test';
import {openProfileChat, profileSessions, registerChatProfile, resumeProfileChat, type ChatProfile} from '../src/public.js';
import {setProfileOpener, setProfileSessions} from '../src/profiles.js';
import {makeCtx} from './helpers/fake-ctx.js';
import {release, setup} from './helpers/env.js';

const profile = (): ChatProfile => ({
	id: 'clan',
	owner: 'clan',
	banner: 'Fiction.',
	appendSystemPrompt: 'Moderate.',
	mainTools: ['Agent', 'SendMessage'],
	agents: {skeptic: {description: 'd', prompt: 'p', label: 'Skeptic', tone: 'orange'}},
});

test('without the chat module loaded the open fails', async () => {
	setProfileOpener(undefined);
	await assert.rejects(openProfileChat(profile(), makeCtx()), /The chat module is not loaded/);
});

test('an invalid profile is refused before anything opens', async () => {
	const env = setup();
	await assert.rejects(openProfileChat({...profile(), id: 'yena'}, makeCtx()), /Invalid chat profile: id/);
	assert.equal(env.fake.opens.length, 0);
	release();
});

test('only the user opens a profile chat', async () => {
	const env = setup();
	await assert.rejects(openProfileChat(profile(), makeCtx({signal: true, caller: 'yena'})), /A module chat opens only from the user's console/);
	await assert.rejects(openProfileChat(profile(), makeCtx({signal: true})), /A module chat opens only from the user's console/);
	assert.equal(env.fake.opens.length, 0);
	release();
});

test('a provider without profiles is refused', async () => {
	const env = setup();
	delete (env.fake.provider as {profiles?: true}).profiles;
	await assert.rejects(openProfileChat(profile(), makeCtx()), /does not support module profiles/);
	assert.equal(env.fake.opens.length, 0);
	release();
});

test('the profile reaches the provider as a fresh chat that neither attaches nor is kept', async () => {
	const env = setup();
	const ctx = makeCtx();
	const done = openProfileChat(profile(), ctx);
	for (let i = 0; i < 100 && ctx.mounts === 0; i++) await new Promise<void>(r => setTimeout(r, 5));
	const req = env.fake.opens[0]!;
	assert.equal(req.profile?.id, 'clan');
	assert.ok(Object.isFrozen(req.profile));
	assert.equal(req.attach, false);
	assert.equal(req.keep, false);
	assert.equal(req.fresh, true);
	assert.equal(req.origin, 'user');
	assert.equal(req.mode, 'default');
	assert.equal(env.fu.chats[0]?.profile?.id, 'clan');
	assert.ok(ctx.lines.some(l => l.includes('Fiction.')));
	ctx.closeAll();
	await done;
	release();
});

test('registerChatProfile refuses a bad id, yena, a duplicate and a source without build; unregister frees the id', () => {
	const build = async () => profile();
	assert.equal(registerChatProfile({id: 'Bad', owner: 'clan', build}), undefined);
	assert.equal(registerChatProfile({id: 'yena', owner: 'clan', build}), undefined);
	assert.equal(registerChatProfile({id: 'clan', owner: 'clan'} as never), undefined);
	const off = registerChatProfile({id: 'tprof', owner: 'clan', build});
	assert.equal(typeof off, 'function');
	assert.equal(registerChatProfile({id: 'tprof', owner: 'other', build}), undefined);
	off!();
	const again = registerChatProfile({id: 'tprof', owner: 'clan', build});
	assert.equal(typeof again, 'function');
	again!();
});

test('profileSessions and resumeProfileChat delegate to the chat module and fail when it is not loaded', async () => {
	setProfileSessions(undefined);
	await assert.rejects(profileSessions('clan'), /The chat module is not loaded/);
	await assert.rejects(resumeProfileChat('s', makeCtx()), /The chat module is not loaded/);
	const calls: unknown[] = [];
	setProfileSessions({
		sessions: async (id, limit) => (calls.push([id, limit]), []),
		resume: async sessionId => void calls.push(sessionId),
	});
	await profileSessions('clan');
	await profileSessions('clan', 5);
	await resumeProfileChat('abc', makeCtx());
	assert.deepEqual(calls, [['clan', 50], ['clan', 5], 'abc']);
	setProfileSessions(undefined);
});
