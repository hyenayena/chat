import assert from 'node:assert/strict';
import {existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterEach, test} from 'node:test';
import {createProfileStore, LINES_DIR, PROFILES_FILE} from '../src/profile-bindings.js';

const dirs: string[] = [];
const fresh = () => {
	const root = mkdtempSync(path.join(tmpdir(), 'chat-pbh-'));
	dirs.push(root);
	return path.join(root, 'chat');
};
afterEach(() => {
	for (const d of dirs.splice(0)) rmSync(d, {recursive: true, force: true});
});

const b = {id: 'clan', owner: 'clan', noun: 'clan', args: ['skeptic']};
const hostileIds = ['../evil', '..', 'a/b', 'a\\b', '', 'x'.repeat(129), 'ключ', 'a b', 'a\0b', 'a.b', '__proto__'];

test('hostile session ids never become a file name: writes throw, reads return nothing', async () => {
	const dir = fresh();
	const s = createProfileStore({dataDir: dir});
	for (const id of hostileIds) {
		await assert.rejects(s.bind(id, b), /Invalid session id/);
		await assert.rejects(s.touch(id), /Invalid session id/);
		await assert.rejects(s.addLine(id, {n: 1, agent: 'skeptic', text: 'x'}), /Invalid session id/);
		assert.equal(await s.lookup(id), undefined);
		assert.equal(await s.has(id), false);
		assert.deepEqual(await s.lines(id), []);
	}
	assert.equal(existsSync(path.join(dir, LINES_DIR)), false);
	assert.equal(existsSync(path.join(path.dirname(dir), 'evil.jsonl')), false);
});

test('a profiles.json with a hostile session key is ignored as a whole and never prunes outside the lines dir', async () => {
	const dir = fresh();
	mkdirSync(dir, {recursive: true});
	const outside = path.join(path.dirname(dir), 'evil.jsonl');
	writeFileSync(outside, 'keep');
	const rec = {id: 'clan', owner: 'clan', args: [], at: 1, last: 1};
	writeFileSync(path.join(dir, PROFILES_FILE), JSON.stringify({v: 1, sessions: {'../../evil': rec, ok: rec}}));
	const s = createProfileStore({dataDir: dir});
	assert.equal((await s.ids()).size, 0);
	assert.equal(existsSync(outside), true);
});

test('wrong types, huge or odd values in profiles.json never throw', async () => {
	const dir = fresh();
	mkdirSync(dir, {recursive: true});
	const rec = {id: 'clan', owner: 'clan', args: [], at: 1, last: 1};
	const bad: unknown[] = [
		'not json{',
		'[]',
		'null',
		JSON.stringify({v: 2, sessions: {}}),
		JSON.stringify({v: 1, sessions: []}),
		JSON.stringify({v: 1, sessions: {a: {...rec, args: 'x'}}}),
		JSON.stringify({v: 1, sessions: {a: {...rec, args: ['A B']}}}),
		JSON.stringify({v: 1, sessions: {a: {...rec, args: Array(1000).fill('x')}}}),
		JSON.stringify({v: 1, sessions: {a: {...rec, at: -1}}}),
		JSON.stringify({v: 1, sessions: {a: {...rec, last: '5'}}}),
		JSON.stringify({v: 1, sessions: {a: {...rec, id: 'Yena\u001b[31m'}}}),
		JSON.stringify({v: 1, sessions: {a: {...rec, noun: 'x\u001b'}}}),
		JSON.stringify({v: 1, sessions: {a: 5}}),
		'x'.repeat(2_000_000),
	];
	for (const raw of bad) {
		writeFileSync(path.join(dir, PROFILES_FILE), raw as string);
		const s = createProfileStore({dataDir: dir});
		assert.equal((await s.ids()).size, 0);
		assert.deepEqual(await s.listFor('clan', 10), []);
	}
});

test('garbled, oversized and mistyped jsonl lines are skipped; good lines survive', async () => {
	const dir = fresh();
	const s = createProfileStore({dataDir: dir});
	await s.bind('s-1', b);
	await s.addLine('s-1', {n: 1, agent: 'skeptic', text: 'first'});
	const file = path.join(dir, LINES_DIR, 's-1.jsonl');
	const good = (n: number) => JSON.stringify({n, at: 1, agent: 'skeptic', text: 'ok'});
	writeFileSync(
		file,
		[
			'{bad',
			'[]',
			JSON.stringify({n: '1', at: 1, agent: 'skeptic', text: 'x'}),
			JSON.stringify({n: 1.5, at: 1, agent: 'skeptic', text: 'x'}),
			JSON.stringify({n: -1, at: 1, agent: 'skeptic', text: 'x'}),
			JSON.stringify({n: 1, at: 1, agent: '../x', text: 'x'}),
			JSON.stringify({n: 1, at: 1, agent: 'skeptic', text: ''}),
			JSON.stringify({n: 1, at: 1, agent: 'skeptic', text: 7}),
			JSON.stringify({n: 1, at: 1, kind: 'weird', text: 'x'}),
			JSON.stringify({n: 1, at: 1, kind: 'direction', text: ''}),
			JSON.stringify({n: 1, at: 1, kind: 'direction', text: 'z'.repeat(250)}),
			JSON.stringify({n: 1, at: 1, kind: 'direction', text: 7}),
			JSON.stringify({n: 1, at: 'x', kind: 'silence'}),
			good(2),
			'\u0000\u001b[31m',
			good(3),
			'',
		].join('\n'),
	);
	assert.deepEqual((await s.lines('s-1')).map(l => l.n), [2, 3]);
	await s.addLine('s-1', {n: 4, agent: 'skeptic', text: 'after'});
	assert.deepEqual((await s.lines('s-1')).map(l => l.n), [2, 3, 4]);
});

test('a missing lines file reads as empty; a lines path that is a directory rejects instead of corrupting', async () => {
	const dir = fresh();
	const s = createProfileStore({dataDir: dir});
	await s.bind('s-1', b);
	assert.deepEqual(await s.lines('s-1'), []);
	mkdirSync(path.join(dir, LINES_DIR, 's-1.jsonl'), {recursive: true});
	await assert.rejects(s.lines('s-1'));
	await s.touch('s-1');
	assert.equal((await s.lookup('s-1'))?.id, 'clan');
});

test('a single line larger than the size cap is dropped, not kept', async () => {
	const dir = fresh();
	const s = createProfileStore({dataDir: dir});
	await s.bind('s-1', b);
	await s.addLine('s-1', {n: 1, agent: 'skeptic', text: 'y'.repeat(2 * 1024 * 1024)});
	assert.deepEqual(await s.lines('s-1'), []);
});

test('concurrent bind, touch and addLine all land and leave no temp files', async () => {
	const dir = fresh();
	const s = createProfileStore({dataDir: dir});
	const ops: Promise<void>[] = [];
	for (let i = 0; i < 30; i++) {
		ops.push(s.bind(`s-${i}`, b));
		ops.push(s.touch(`s-${i}`));
		ops.push(s.addLine(`s-${i}`, {n: i, agent: 'skeptic', text: `t${i}`}));
	}
	await Promise.all(ops);
	assert.equal((await s.ids()).size, 30);
	for (let i = 0; i < 30; i++) assert.equal((await s.lines(`s-${i}`)).length, 1);
	assert.deepEqual(readdirSync(dir).filter(f => f.endsWith('.tmp')), []);
	assert.deepEqual(readdirSync(path.join(dir, LINES_DIR)).filter(f => f.endsWith('.tmp')), []);
});

test('a failing operation does not stall the queue', async () => {
	const s = createProfileStore({dataDir: fresh()});
	const failing = s.bind('../x', b);
	const next = s.bind('ok', b);
	await assert.rejects(failing);
	await next;
	assert.equal(await s.has('ok'), true);
});

test('an invalid binding is refused and never poisons the file', async () => {
	const dir = fresh();
	const s = createProfileStore({dataDir: dir});
	await s.bind('good-1', b);
	await assert.rejects(s.bind('bad-1', {...b, args: ['Bad Arg']}), /Invalid profile binding/);
	assert.equal((await s.lookup('good-1'))?.id, 'clan');
	assert.equal(await s.has('bad-1'), false);
});
