import assert from 'node:assert/strict';
import {test} from 'node:test';
import stringWidth from 'string-width';
import {makeScrub} from '../../src/contract/scrub.js';
import React, {createElement} from 'react';
import {stripStyles} from '../../src/kit.js';
import {makeReveal} from '../../src/contract/reveal.js';
import {ChatView} from '../../src/ui/ChatView.js';
import {liveTail} from '../../src/ui/present.js';
import {fakeController, mountHarness} from './testkit.js';

void React;

const scrub = makeScrub(s => s);

const ANSWER = [
	'# Заголовок ответа 🎉',
	'',
	'Текст на русском языке с **жирным** и `кодом`, а также 日本語のテキストと emoji 😀👍🏽 и\ttab.',
	'',
	'| Имя | Описание | 説明 | Значение |',
	'|---|---|---|---|',
	'| alpha | очень длинное описание колонки которое не помещается | 日本語日本語日本語日本語 | 😀😀😀😀😀😀 |',
	'| beta | short | x | y |',
	'',
	'- пункт один 😀',
	'- пункт два с длинным текстом, который переносится на следующую строку терминала',
	'',
	'```ts',
	'const s = "日本語日本語日本語日本語日本語日本語日本語日本語日本語日本語日本語😀😀😀😀";\t// tab',
	'const longer = "a very long line of code that for sure exceeds the narrow terminal width we test";',
	'```',
	'',
	'Конец.',
].join('\n');

const WIDTHS = [20, 40, 80, 120];

test('every live tail row stays within columns - 1 cells at every prefix of a streamed answer', () => {
	for (const columns of WIDTHS) {
		for (let n = 1; n <= ANSWER.length; n += 7) {
			for (const row of liveTail(ANSWER.slice(0, n), scrub, 30, columns)) {
				assert.ok(stringWidth(row) <= columns - 1, `${columns}: ${stringWidth(row)} ${JSON.stringify(row)}`);
				assert.ok(!row.includes('\t'), JSON.stringify(row));
			}
		}
	}
});

test('the streaming frame never shrinks mid-turn, stays inside the rows and is throttled', async () => {
	const rows = 24;
	const columns = 60;
	const controller = fakeController();
	const h = mountHarness(createElement(ChatView, {controller, print: () => {}, close: () => {}, scrub, reveal: makeReveal(s => s), armMs: 20, projectDir: '/app'}), {columns, rows});
	try {
		await h.settle(40);
		controller.setState('running');
		await h.settle(30);
		const before = h.chunks.length;
		const heights: number[] = [];
		const lines = ANSWER.split('\n');
		for (let i = 0; i < 60; i++) {
			controller.ui({kind: 'text-delta', text: `${lines[i % lines.length]}\n`});
			if (i % 3 === 0) await h.settle(5);
		}
		await h.settle(120);
		for (const chunk of h.chunks.slice(before)) {
			const frame = stripStyles(chunk).replace(/\n+$/, '');
			if (frame.trim() === '') continue;
			const rowsOf = frame.split('\n');
			heights.push(rowsOf.length);
			assert.ok(rowsOf.length <= rows - 3, `${rowsOf.length} rows`);
			for (const row of rowsOf) assert.ok(stringWidth(row) <= columns - 1, JSON.stringify(row));
		}
		assert.ok(heights.length > 1);
		for (let i = 1; i < heights.length; i++) assert.ok(heights[i]! >= heights[i - 1]!, `shrank: ${heights.join(',')}`);
		assert.ok(h.chunks.length - before < 60, `${h.chunks.length - before} frames for 60 deltas`);
	} finally {
		h.unmount();
	}
});

test('the window start moves in steps, not on every delta', () => {
	const line = (i: number) => `row ${String(i).padStart(5, '0')}\n`;
	const firsts = new Set<string>();
	let raw = '';
	for (let i = 0; raw.length < 19_000; i++) {
		raw += line(i);
		if (raw.length > 16_100) firsts.add(liveTail(raw, scrub, 5000, 80)[0]!);
	}
	assert.ok(firsts.size <= 2, `${firsts.size} distinct window starts`);
});
