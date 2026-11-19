import assert from 'node:assert/strict';
import {afterEach, test} from 'node:test';
import {MODULE_MESSAGE_MAX, postToChat, setModulePoster} from '../src/module-messages.js';

afterEach(() => setModulePoster(undefined));

test('a message needs a valid owner and text', async () => {
	setModulePoster(async () => 'sent');
	for (const owner of ['', 'Bad', '1x', 'a b', 'x'.repeat(33)]) await assert.rejects(postToChat({owner, text: 'hi'}), /Invalid module name/);
	await assert.rejects(postToChat({owner: 5 as never, text: 'hi'}), /Invalid module name/);
	for (const text of ['', '   \n', 7 as never]) await assert.rejects(postToChat({owner: 'demo', text}), /The message is empty/);
	await assert.rejects(postToChat({owner: 'demo', text: 'x'.repeat(MODULE_MESSAGE_MAX + 1)}), /longer than 20000 characters/);
	assert.equal(await postToChat({owner: 'demo', text: 'x'.repeat(MODULE_MESSAGE_MAX)}), 'sent');
});

test('without the chat module the post fails', async () => {
	await assert.rejects(postToChat({owner: 'demo', text: 'hi'}), /The chat module is not loaded/);
});

test('the poster result passes through and errors propagate', async () => {
	const seen: unknown[] = [];
	setModulePoster(async m => (seen.push(m), 'no-chat'));
	assert.equal(await postToChat({owner: 'demo', text: ' hi '}), 'no-chat');
	assert.deepEqual(seen, [{owner: 'demo', text: 'hi'}]);
	setModulePoster(async () => {
		throw new Error('refused');
	});
	await assert.rejects(postToChat({owner: 'demo', text: 'hi'}), /refused/);
});
