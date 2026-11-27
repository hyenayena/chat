import assert from 'node:assert/strict';
import {test} from 'node:test';
import {stringCells} from '../../src/kit.js';
import {hintRowText} from '../../src/ui/hint-row.js';

test('a key hint wins over the mode confirmation, which wins over a notice', () => {
	assert.equal(hintRowText({keyHint: 'key', confirm: 'confirm', notice: 'notice', vimNormal: false}, 80), 'key');
	assert.equal(hintRowText({confirm: 'confirm', notice: 'notice', vimNormal: false}, 80), 'confirm');
	assert.equal(hintRowText({notice: 'notice', vimNormal: false}, 80), 'notice');
	assert.equal(hintRowText({vimNormal: false}, 80), '');
});

test('vim normal mode prefixes the label, alone when there is no text', () => {
	assert.equal(hintRowText({vimNormal: true}, 80), '-- NORMAL --');
	assert.equal(hintRowText({notice: 'saved', vimNormal: true}, 80), '-- NORMAL -- · saved');
});

test('the text is one row cut inside the width', () => {
	const out = hintRowText({notice: 'a long\nnotice '.repeat(10), vimNormal: true}, 30);
	assert.ok(stringCells(out) <= 30, out);
	assert.ok(out.endsWith('…'));
	assert.ok(!out.includes('\n'));
	assert.ok(stringCells(hintRowText({notice: 'x'.repeat(50), vimNormal: false}, 0)) <= 1);
});

test('line breaks and wide characters in a notice never leave the row', () => {
	const notice = `a${String.fromCharCode(27)}[31mred${String.fromCharCode(27)}[0m\rb\nc${String.fromCharCode(7)} ${'日本語'.repeat(30)}`;
	for (const width of [10, 39, 79, 199]) {
		const out = hintRowText({notice, vimNormal: true}, width);
		assert.ok(stringCells(out) <= width, `${width}: ${out}`);
		assert.ok(!/[\r\n]/.test(out), JSON.stringify(out));
	}
});

test('control characters in a notice are stripped', () => {
	const out = hintRowText({notice: `a${String.fromCharCode(27)}[31mred${String.fromCharCode(27)}[0m b${String.fromCharCode(7)}`, vimNormal: false}, 80);
	assert.ok(!/[\x00-\x1f\x7f-\x9f]/.test(out), JSON.stringify(out));
	assert.match(out, /red/);
});
