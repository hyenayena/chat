import assert from 'node:assert/strict';
import {test} from 'node:test';
import React from 'react';
import {fakeController} from './ui/testkit.js';

void React;

test('the UI entry exposes exactly the stable names', async () => {
	const ui = await import('../src/public-ui.js');
	assert.deepEqual(Object.keys(ui).sort(), [
		'assistantPrint',
		'assistantRows',
		'createChatElement',
		'createPickerElement',
		'createShellElement',
		'createWaitingElement',
		'formatBanner',
		'formatFileCard',
		'formatNotice',
		'formatUserLine',
		'listProjectFiles',
	]);
});

test('createChatElement returns an element for a controller', async () => {
	const {createChatElement} = await import('../src/public-ui.js');
	const element = createChatElement({controller: fakeController(), print() {}, close() {}, scrub: s => s});
	assert.equal(typeof element, 'object');
	assert.ok(element);
});
