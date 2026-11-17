import assert from 'node:assert/strict';
import {afterEach, test} from 'node:test';
import React, {createElement} from 'react';
import {checkProfile, makeScrub, type ChatProfile} from '../../src/public.js';
import {ChatView, clearSentHistory} from '../../src/ui/ChatView.js';
import {fakeController, mountHarness, type FakeController} from './testkit.js';

void React;
const ESC = '\u001b';
const SGR = new RegExp(`${ESC}\\[[0-9;?]*[a-zA-Z]`, 'g');
const COLUMNS = 80;

const profile: ChatProfile = checkProfile({
	id: 'clan',
	owner: 'clan',
	noun: 'clan',
	appendSystemPrompt: 'Moderate.',
	mainTools: ['Agent', 'SendMessage'],
	agents: {
		skeptic: {description: 'd', prompt: 'p', label: 'Skeptic', tone: 'orange'},
		dreamer: {description: 'd', prompt: 'p', label: 'Dreamer', tone: 'violet'},
	},
	passWord: 'PASS',
});

let cleanup: Array<() => void> = [];
afterEach(() => {
	for (const fn of cleanup) fn();
	cleanup = [];
	clearSentHistory();
});

function setup(withProfile = true) {
	const titles: string[] = [];
	const listeners: Array<(e: unknown) => boolean | void> = [];
	const host = {
		isFocused: () => true,
		columns: () => COLUMNS,
		subscribe: () => () => {},
		move: () => true,
		isHostKey: () => false,
		setTitle: (title: string) => void titles.push(title),
		subscribeMouse: (l: (e: unknown) => boolean | void) => {
			listeners.push(l);
			return () => void listeners.splice(listeners.indexOf(l), 1);
		},
	};
	const printed: string[] = [];
	const controller: FakeController = fakeController();
	const h = mountHarness(
		createElement(ChatView, {controller, print: t => void printed.push(t), close() {}, scrub: makeScrub(s => s), host, ...(withProfile && {profile})}),
		{columns: COLUMNS, rows: 30},
	);
	cleanup.push(() => h.unmount());
	const frame = (): string[] => {
		const last = [...h.chunks].reverse().find(c => c.replace(SGR, '').trim() !== '') ?? '';
		const lines = last.replace(SGR, '').split('\n');
		while (lines.length > 0 && lines.at(-1) === '') lines.pop();
		return lines;
	};
	const click = (needle: string, offset = 0) => {
		const lines = frame();
		const y = lines.findIndex(l => l.includes(needle));
		assert.ok(y >= 0, `${needle} is shown:\n${lines.join('\n')}`);
		return listeners.at(-1)!({kind: 'press', button: 'left', x: lines[y]!.indexOf(needle) + offset, y, width: COLUMNS, height: lines.length, shift: false, meta: false, ctrl: false});
	};
	return {controller, h, frame, click, printed, titles};
}

const spawn = (c: FakeController, id: string, type: string) =>
	c.ui({kind: 'tool-use', toolUseId: id, name: 'Agent', input: {subagent_type: type, prompt: `Cue for ${type}`}});

test('profile agents draw no panel box and no running tool; a typing row shows instead', async () => {
	const t = setup();
	await t.h.settle();
	t.controller.setState('running');
	spawn(t.controller, 'a1', 'skeptic');
	spawn(t.controller, 'a2', 'dreamer');
	t.controller.ui({kind: 'agent-message', agentId: 'a1', items: [{type: 'text', text: 'Hmm'}]});
	await t.h.settle();
	const text = t.frame().join('\n');
	assert.match(text, /Skeptic, Dreamer typing…/);
	assert.doesNotMatch(text, /╭/);
	assert.doesNotMatch(text, /Agent\b/);
});

test('the typing row goes away on the line, on PASS, on an error and on an interrupt', async () => {
	const t = setup();
	await t.h.settle();
	t.controller.setState('running');
	spawn(t.controller, 'a1', 'skeptic');
	spawn(t.controller, 'a2', 'dreamer');
	await t.h.settle();
	t.controller.ui({kind: 'agent-message', agentId: 'a1', items: [{type: 'text', text: 'Proof?'}]});
	t.controller.ui({kind: 'tool-result', toolUseId: 'a1', isError: false, text: 'Proof?'});
	await t.h.settle();
	assert.match(t.frame().join('\n'), /Dreamer typing…/);
	assert.ok(t.printed.some(p => p.includes('Skeptic')));
	t.controller.ui({kind: 'tool-result', toolUseId: 'a2', isError: false, text: 'PASS: nothing'});
	await t.h.settle();
	assert.doesNotMatch(t.frame().join('\n'), /typing…/);

	spawn(t.controller, 'a3', 'skeptic');
	await t.h.settle();
	assert.match(t.frame().join('\n'), /Skeptic typing…/);
	t.controller.ui({kind: 'tool-result', toolUseId: 'a3', isError: true, text: 'boom'});
	await t.h.settle();
	assert.doesNotMatch(t.frame().join('\n'), /typing…/);

	spawn(t.controller, 'a4', 'dreamer');
	t.controller.ui({kind: 'agent-message', agentId: 'a4', items: [{type: 'text', text: 'Half a thou'}]});
	await t.h.settle();
	t.controller.emit({type: 'turn-end', outcome: 'interrupted'});
	t.controller.setState('idle');
	await t.h.settle();
	assert.doesNotMatch(t.frame().join('\n'), /typing…/);
	assert.ok(!t.printed.some(p => p.includes('Half a thou')));
});

test('a click on a name in the typing row opens that agent\'s run; Esc returns; ←/→ stay put', async () => {
	const t = setup();
	await t.h.settle();
	t.controller.setState('running');
	spawn(t.controller, 'a1', 'skeptic');
	spawn(t.controller, 'a2', 'dreamer');
	t.controller.ui({kind: 'agent-message', agentId: 'a2', items: [{type: 'text', text: 'Dreaming aloud'}]});
	await t.h.settle();
	assert.equal(t.click('Dreamer'), true);
	await t.h.settle();
	assert.match(t.frame().join('\n'), /Subagent dreamer · read-only/);
	assert.match(t.frame().join('\n'), /Dreaming aloud/);
	t.h.press(`${ESC}[C`);
	await t.h.settle();
	assert.match(t.frame().join('\n'), /Subagent dreamer · read-only/);
	t.h.press(ESC);
	await t.h.settle();
	assert.match(t.frame().join('\n'), /Skeptic, Dreamer typing…/);
	assert.equal(t.click('Skeptic'), true);
	await t.h.settle();
	assert.match(t.frame().join('\n'), /Subagent skeptic · read-only/);
});

test('the profile noun names the chat in the title and the notices', async () => {
	const t = setup();
	await t.h.settle();
	assert.ok(t.titles.some(x => x.includes('New clan')), t.titles.join('|'));
	const plain = setup(false);
	await plain.h.settle();
	assert.ok(plain.titles.some(x => x.includes('New chat')));
});

test('an ordinary chat still draws its agent boxes and no typing row', async () => {
	const t = setup(false);
	await t.h.settle();
	t.controller.setState('running');
	spawn(t.controller, 'a1', 'skeptic');
	await t.h.settle();
	assert.match(t.frame().join('\n'), /╭/);
	assert.doesNotMatch(t.frame().join('\n'), /typing…/);
});
