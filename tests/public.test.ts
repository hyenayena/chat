import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');
const BANNED_MODULES = /^(react|ink|node:fs|node:fs\/promises|node:child_process|node:net|fs|fs\/promises|child_process|net)$/;
const BANNED_CORE = /kit\/ui\b/;
const THEME = /\b(toneSgr|sgrTable|paintTone)\b/;
const SPEC = /(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g;

function graph(entry: string): Map<string, string> {
	const seen = new Map<string, string>();
	const queue = [entry];
	while (queue.length > 0) {
		const file = queue.pop()!;
		if (seen.has(file)) continue;
		const text = readFileSync(file, 'utf8');
		seen.set(file, text);
		for (const m of text.matchAll(SPEC)) {
			const spec = m[1]!;
			if (!spec.startsWith('.')) continue;
			const target = path.resolve(path.dirname(file), spec.replace(/\.js$/, '.ts'));
			// core's text kit is pure and checked by core's own tests
			if (target.startsWith(SRC)) queue.push(target);
		}
	}
	return seen;
}

test('the public entry reaches no UI module, no process or file API and no theme table', () => {
	const files = graph(path.join(SRC, 'public.ts'));
	assert.ok(files.size > 5);
	const offenders: string[] = [];
	for (const [file, text] of files) {
		const rel = path.relative(SRC, file);
		if (rel.startsWith('ui' + path.sep) || rel === 'public-ui.ts' || rel === 'files.ts') offenders.push(`${rel}: UI or file module in the pure graph`);
		for (const m of text.matchAll(SPEC)) {
			const spec = m[1]!;
			if (BANNED_MODULES.test(spec) || BANNED_CORE.test(spec)) offenders.push(`${rel}: ${spec}`);
		}
		if (THEME.test(text)) offenders.push(`${rel}: theme table`);
	}
	assert.deepEqual(offenders, []);
});

test('the public entry exports the provider contract and the registry', async () => {
	const pub = await import('../src/public.js');
	for (const name of ['isInteractive', 'registerChatProvider', 'chatProviders', 'chatProvider']) {
		assert.equal(typeof (pub as Record<string, unknown>)[name], 'function', name);
	}
	assert.equal('currentChat' in pub, false);
});
