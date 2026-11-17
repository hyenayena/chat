import assert from 'node:assert/strict';
import {test} from 'node:test';
import {capNoun, checkProfile, isPassReply, nounOf, PROFILE_LIMITS, PROFILE_TONES, type ChatProfile} from '../../src/public.js';

const agent = () => ({description: 'A doubter', prompt: 'You doubt.', label: 'Skeptic', tone: 'orange' as const});
const base = (): ChatProfile => ({
	id: 'clan',
	owner: 'clan',
	appendSystemPrompt: 'Moderate.',
	mainTools: ['Agent', 'SendMessage'],
	agents: {skeptic: agent()},
});

const bad = (change: (p: Record<string, unknown>) => void, field: string): void => {
	const p = base() as unknown as Record<string, unknown>;
	change(p);
	assert.throws(() => checkProfile(p), new Error(`Invalid chat profile: ${field}`));
};

test('a valid profile passes and is returned deep-frozen', () => {
	const p = checkProfile({...base(), banner: 'Fiction.', turnAgentCalls: 3, keepAliveMs: 600_000, mainTier: 'standard', loadInstructions: false, passWord: 'PASS'});
	assert.equal(p.id, 'clan');
	assert.ok(Object.isFrozen(p) && Object.isFrozen(p.mainTools) && Object.isFrozen(p.agents) && Object.isFrozen(p.agents.skeptic));
	assert.equal(p.passWord, 'PASS');
});

test('the check copies: later changes to the input do not reach the result', () => {
	const input = base();
	const p = checkProfile(input);
	input.mainTools.push('Bash');
	input.agents.skeptic!.label = 'Other';
	assert.deepEqual(p.mainTools, ['Agent', 'SendMessage']);
	assert.equal(p.agents.skeptic!.label, 'Skeptic');
});

test('ids: the reserved id, bad characters and bad owners are refused', () => {
	bad(p => (p.id = 'yena'), 'id');
	bad(p => (p.id = 'Clan'), 'id');
	bad(p => (p.id = 'a'.repeat(33)), 'id');
	bad(p => (p.owner = '1x'), 'owner');
});

test('caps: prompts, descriptions, labels, agent count, tools', () => {
	bad(p => (p.appendSystemPrompt = 'x'.repeat(PROFILE_LIMITS.appendPrompt + 1)), 'appendSystemPrompt');
	bad(p => (p.appendSystemPrompt = '  '), 'appendSystemPrompt');
	bad(p => (p.banner = 'x'.repeat(PROFILE_LIMITS.description + 1)), 'banner');
	bad(p => ((p.agents as Record<string, Record<string, unknown>>).skeptic!.prompt = 'x'.repeat(PROFILE_LIMITS.agentPrompt + 1)), 'agents.skeptic.prompt');
	bad(p => ((p.agents as Record<string, Record<string, unknown>>).skeptic!.description = 'x'.repeat(PROFILE_LIMITS.description + 1)), 'agents.skeptic.description');
	bad(p => ((p.agents as Record<string, Record<string, unknown>>).skeptic!.label = 'x'.repeat(PROFILE_LIMITS.label + 1)), 'agents.skeptic.label');
	bad(p => ((p.agents as Record<string, Record<string, unknown>>).skeptic!.label = 'a\u001b[31mb'), 'agents.skeptic.label');
	bad(p => (p.agents = Object.fromEntries(Array.from({length: 9}, (_, i) => [`a${i}`, agent()]))), 'agents');
	bad(p => (p.mainTools = Array.from({length: 9}, (_, i) => `T${i}`)), 'mainTools');
	bad(p => (p.mainTools = ['bad name']), 'mainTools');
});

test('agent names, tones and tiers', () => {
	bad(p => (p.agents = {Bad: agent()}), 'agents.Bad');
	bad(p => ((p.agents as Record<string, Record<string, unknown>>).skeptic!.tone = 'red'), 'agents.skeptic.tone');
	bad(p => ((p.agents as Record<string, Record<string, unknown>>).skeptic!.tier = 'huge'), 'agents.skeptic.tier');
	assert.deepEqual(Object.keys(PROFILE_TONES).sort(), ['blue', 'green', 'orange', 'teal', 'violet', 'yellow']);
	assert.equal(checkProfile({...base(), agents: {a: {...agent(), tier: 'strong'}}}).agents.a!.tier, 'strong');
});

test('numbers, tier, instructions and the pass word', () => {
	bad(p => (p.turnAgentCalls = 0), 'turnAgentCalls');
	bad(p => (p.turnAgentCalls = 9), 'turnAgentCalls');
	bad(p => (p.turnAgentCalls = 1.5), 'turnAgentCalls');
	bad(p => (p.keepAliveMs = PROFILE_LIMITS.keepAliveMs + 1), 'keepAliveMs');
	bad(p => (p.mainTier = 'x'), 'mainTier');
	bad(p => (p.loadInstructions = true), 'loadInstructions');
	bad(p => (p.passWord = 'A B'), 'passWord');
	bad(p => (p.passWord = 'A:'), 'passWord');
	assert.throws(() => checkProfile(null), /Invalid chat profile: profile/);
});

test('isPassReply: the word alone or followed by a colon', () => {
	assert.equal(isPassReply('PASS', 'PASS'), true);
	assert.equal(isPassReply('  PASS \n', 'PASS'), true);
	assert.equal(isPassReply('PASS: not my topic', 'PASS'), true);
	assert.equal(isPassReply('PASSING by', 'PASS'), false);
	assert.equal(isPassReply('I will PASS', 'PASS'), false);
	assert.equal(isPassReply('pass', 'PASS'), false);
});

test('noun: lowercase letters only, 2 to 16, default chat', () => {
	assert.equal(checkProfile({...base(), noun: 'clan'}).noun, 'clan');
	bad(p => (p.noun = 'Clan'), 'noun');
	bad(p => (p.noun = 'a'), 'noun');
	bad(p => (p.noun = 'x'.repeat(17)), 'noun');
	bad(p => (p.noun = 'my clan'), 'noun');
	assert.equal(nounOf(undefined), 'chat');
	assert.equal(nounOf(checkProfile(base())), 'chat');
	assert.equal(nounOf(checkProfile({...base(), noun: 'clan'})), 'clan');
	assert.equal(capNoun('clan'), 'Clan');
});

test('args: at most 16 opaque names of lowercase letters, digits and dashes', () => {
	const p = checkProfile({...base(), args: ['skeptic', 'dreamer-2']});
	assert.deepEqual(p.args, ['skeptic', 'dreamer-2']);
	assert.ok(Object.isFrozen(p.args));
	assert.equal(checkProfile(base()).args, undefined);
	bad(p => (p.args = 'skeptic'), 'args');
	bad(p => (p.args = ['Skeptic']), 'args');
	bad(p => (p.args = ['-a']), 'args');
	bad(p => (p.args = ['a'.repeat(65)]), 'args');
	bad(p => (p.args = [1]), 'args');
	bad(p => (p.args = Array.from({length: PROFILE_LIMITS.args + 1}, () => 'a')), 'args');
});
