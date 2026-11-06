import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chatProvider, chatProviders, isInteractive, registerChatProvider, type ChatProvider, type Origin} from '../../src/public.js';

const fake = (id: string, label = 'Fake'): ChatProvider =>
	({
		id,
		label,
		modes: ['default'],
		redact: (t: string) => t,
		admit: async () => {},
		open: async () => undefined,
		ask: async () => {},
	}) as unknown as ChatProvider;

test('registerChatProvider checks the id against the pattern', () => {
	for (const id of ['', 'Claude', '1abc', 'a_b', 'a b', 'a'.repeat(33), '-a']) {
		assert.equal(registerChatProvider(fake(id)), undefined, id);
	}
	assert.deepEqual(chatProviders(), []);
	const off = registerChatProvider(fake('a'.repeat(32)))!;
	assert.equal(typeof off, 'function');
	off();
});

test('registerChatProvider refuses invalid shapes', () => {
	const refused = [
		{...fake('shape'), label: ''},
		{...fake('shape'), label: 'x'.repeat(41)},
		{...fake('shape'), label: 7},
		{...fake('shape'), open: undefined},
		{...fake('shape'), admit: 'no'},
		{...fake('shape'), ask: undefined},
		null,
		'shape',
	];
	for (const p of refused) assert.equal(registerChatProvider(p as unknown as ChatProvider), undefined);
	assert.deepEqual(chatProviders(), []);
	const off = registerChatProvider({...fake('shape'), label: 'x'.repeat(40)})!;
	assert.ok(off);
	off();
});

test('the first registration of an id wins and a duplicate is refused', () => {
	const first = fake('dup', 'First');
	const off = registerChatProvider(first)!;
	assert.equal(registerChatProvider(fake('dup', 'Second')), undefined);
	assert.equal(chatProvider('dup'), first);
	assert.deepEqual(chatProviders(), [{id: 'dup', label: 'First'}]);
	off();
});

test('the returned function removes only its own registration', () => {
	const a = registerChatProvider(fake('one'))!;
	const b = registerChatProvider(fake('two'))!;
	a();
	a();
	assert.deepEqual(chatProviders().map(p => p.id), ['two']);
	assert.equal(registerChatProvider(fake('two')), undefined);
	const again = registerChatProvider(fake('one'))!;
	assert.ok(again);
	// the old handle for "one" is spent and must not remove the new registration
	a();
	assert.deepEqual(chatProviders().map(p => p.id), ['two', 'one']);
	b();
	again();
	assert.deepEqual(chatProviders(), []);
});

test('chatProviders lists in registration order', () => {
	const offs = ['zeta', 'alpha', 'mid'].map(id => registerChatProvider(fake(id, id.toUpperCase()))!);
	assert.deepEqual(chatProviders(), [
		{id: 'zeta', label: 'ZETA'},
		{id: 'alpha', label: 'ALPHA'},
		{id: 'mid', label: 'MID'},
	]);
	for (const off of offs) off();
});

test('chatProvider looks a provider up by id', () => {
	const p = fake('look');
	const off = registerChatProvider(p)!;
	assert.equal(chatProvider('look'), p);
	assert.equal(chatProvider('missing'), undefined);
	off();
	assert.equal(chatProvider('look'), undefined);
});

test('isInteractive is true for user and assistant only', () => {
	assert.equal(isInteractive('user'), true);
	assert.equal(isInteractive('assistant'), true);
	assert.equal(isInteractive('unattended'), false);
	assert.equal(isInteractive('module'), false);
});

test('isInteractive fails closed on a value it does not know', () => {
	for (const v of ['x', '', 'User', 'USER', undefined, null, 1, {}]) assert.equal(isInteractive(v as unknown as Origin), false);
});
