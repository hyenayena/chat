import assert from 'node:assert/strict';
import {readdirSync, readFileSync} from 'node:fs';
import {test} from 'node:test';

const dir = new URL('../../src/ui/', import.meta.url);
const files = readdirSync(dir).filter(f => /\.tsx?$/.test(f));
const ALLOWED_TIMEOUT = new Set(['ChatView.tsx', 'WaitingView.tsx']);

test('no UI file starts an interval of its own', () => {
	assert.ok(files.length > 0);
	for (const f of files) assert.doesNotMatch(readFileSync(new URL(f, dir), 'utf8'), /\bsetInterval\b/, f);
});

test('setTimeout stays only in the non-visual ChatView and WaitingView timers', () => {
	for (const f of files) {
		if (ALLOWED_TIMEOUT.has(f)) continue;
		assert.doesNotMatch(readFileSync(new URL(f, dir), 'utf8'), /\bsetTimeout\b/, f);
	}
});
