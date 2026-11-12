import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tidyBlock, trimBlankRows} from '../../src/ui/print-block.js';

test('blank rows at the start and the end of a block are trimmed, inner ones stay', () => {
	assert.equal(trimBlankRows('\n \na\n\nb\n\n  \n').text, 'a\n\nb');
	assert.equal(trimBlankRows('a').text, 'a');
	assert.equal(trimBlankRows('\n\n').text, '');
});

test('copy actions follow the rows they point at', () => {
	const out = trimBlankRows('\n\na\nb\nc\n', [
		{line: 2, copy: 'a'},
		{line: 4, copy: 'c'},
		{line: 0, copy: 'gone'},
	]);
	assert.deepEqual(out.actions, [
		{line: 0, copy: 'a'},
		{line: 2, copy: 'c'},
	]);
});

test('a block with nothing in it is skipped and a render callback is trimmed too', () => {
	assert.equal(tidyBlock(' \n\n'), undefined);
	const block = tidyBlock('x', {render: width => `\n${'y'.repeat(width)}\n`})!;
	assert.equal(block.text, 'x');
	assert.equal((block.options!.render!(3) as string), 'yyy');
	const withActions = tidyBlock('\nx', {render: () => ({text: '\nz\n', actions: [{line: 1, copy: 'z'}]})})!;
	assert.deepEqual(withActions.options!.render!(5), {text: 'z', actions: [{line: 0, copy: 'z'}]});
	assert.deepEqual(tidyBlock('plain'), {text: 'plain'});
});

test('a row of only style codes is blank, and a block whose render comes out empty is skipped', () => {
	const esc = String.fromCharCode(27);
	const styledBlank = `${esc}[2m${esc}[0m`;
	assert.equal(trimBlankRows(`${styledBlank}\nrow\n${styledBlank} \n`).text, 'row');
	assert.equal(tidyBlock(`${styledBlank}\n${styledBlank}`), undefined);
	assert.equal(tidyBlock('text', {render: () => ''}), undefined);
	assert.equal(tidyBlock('text', {render: () => `${styledBlank}\n`}), undefined);
	assert.equal(tidyBlock('text', {render: () => ({text: '\n', actions: []})}), undefined);
});
