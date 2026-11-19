import assert from 'node:assert/strict';
import {appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterEach, test} from 'node:test';
import {createProfileStore, LINES_DIR, MAX_BINDINGS, MAX_LINES, MAX_LINES_BYTES, PROFILES_FILE} from '../src/profile-bindings.js';
import {makeFakeLog} from './helpers/fake-log.js';

const dirs: string[] = [];
const fresh = () => {
	const dir = path.join(mkdtempSync(path.join(tmpdir(), 'chat-pb-')), 'chat');
	dirs.push(path.dirname(dir));
	return dir;
};
afterEach(() => {
	for (const d of dirs.splice(0)) rmSync(d, {recursive: true, force: true});
});

const b = {id: 'clan', owner: 'clan', noun: 'clan', args: ['skeptic', 'dreamer']};
const mode = (p: string) => statSync(p).mode & 0o777;

test('bind writes the file atomically with 0600 in a 0700 directory and lookup reads it back', async () => {
	const dir = fresh();
	const s = createProfileStore({dataDir: dir});
	await s.bind('s-1', b);
	assert.equal(mode(path.join(dir, PROFILES_FILE)), 0o600);
	assert.equal(mode(dir), 0o700);
	assert.deepEqual(readdirSync(dir), [PROFILES_FILE]);
	const got = await s.lookup('s-1');
	assert.deepEqual({id: got?.id, owner: got?.owner, noun: got?.noun, args: got?.args}, b);
	assert.equal(await s.has('s-1'), true);
	assert.equal(await s.has('s-2'), false);
	assert.equal(await s.lookup('../x'), undefined);
	await assert.rejects(s.bind('../x', b), /Invalid session id/);
});

test('a second bind of the same session keeps the record and only moves last; touch sets last', async () => {
	const s = createProfileStore({dataDir: fresh()});
	await s.bind('s-1', b);
	const first = (await s.lookup('s-1'))!;
	await new Promise(r => setTimeout(r, 5));
	await s.bind('s-1', {...b, args: ['other']});
	const again = (await s.lookup('s-1'))!;
	assert.deepEqual(again.args, ['skeptic', 'dreamer']);
	assert.equal(again.at, first.at);
	assert.ok(again.last > first.last);
	await new Promise(r => setTimeout(r, 5));
	await s.touch('s-1');
	assert.ok((await s.lookup('s-1'))!.last > again.last);
	await s.touch('unknown');
	assert.equal(await s.has('unknown'), false);
});

test('listFor returns the newest first, only for that profile id', async () => {
	const s = createProfileStore({dataDir: fresh()});
	await s.bind('a', b);
	await new Promise(r => setTimeout(r, 3));
	await s.bind('b', b);
	await s.bind('c', {...b, id: 'other'});
	await new Promise(r => setTimeout(r, 3));
	await s.touch('a');
	assert.deepEqual((await s.listFor('clan', 10)).map(x => x.sessionId), ['a', 'b']);
	assert.deepEqual((await s.listFor('clan', 1)).map(x => x.sessionId), ['a']);
	assert.deepEqual([...(await s.ids())].sort(), ['a', 'b', 'c']);
});

test('the 1000 newest by last are kept and the lines of dropped sessions go with them', async () => {
	const dir = fresh();
	const s = createProfileStore({dataDir: dir});
	const sessions: Record<string, unknown> = {};
	for (let i = 0; i < MAX_BINDINGS; i++) sessions[`s${i}`] = {id: 'clan', owner: 'clan', args: [], at: 1000 + i, last: 1000 + i};
	mkdirSync(dir, {recursive: true});
	writeFileSync(path.join(dir, PROFILES_FILE), JSON.stringify({v: 1, sessions}));
	await s.addLine('s0', {n: 1, agent: 'skeptic', text: 'old'});
	await s.bind('new', b);
	const ids = await s.ids();
	assert.equal(ids.size, MAX_BINDINGS);
	assert.equal(ids.has('new'), true);
	assert.equal(ids.has('s0'), false);
	assert.equal(existsSync(path.join(dir, LINES_DIR, 's0.jsonl')), false);
});

test('an invalid file is ignored with one warning (no content) and rewritten on the next bind', async () => {
	const dir = fresh();
	const log = makeFakeLog();
	const s = createProfileStore({dataDir: dir, log});
	await s.bind('x', b);
	writeFileSync(path.join(dir, PROFILES_FILE), '{"v":1,"sessions":{"bad id":{"id":"clan"}}}');
	assert.equal(await s.has('x'), false);
	assert.equal(await s.has('x'), false);
	const warns = log.records.filter(r => r.msg === 'profile bindings invalid');
	assert.equal(warns.length, 1);
	assert.deepEqual(Object.keys(warns[0]!.fields), ['bytes']);
	await s.bind('y', b);
	assert.deepEqual([...(await s.ids())], ['y']);
	assert.equal(JSON.parse(readFileSync(path.join(dir, PROFILES_FILE), 'utf8')).v, 1);
});

test('lines are appended in order with 0600, only for a bound session, and read back', async () => {
	const dir = fresh();
	const s = createProfileStore({dataDir: dir});
	await s.addLine('s-1', {n: 1, agent: 'skeptic', text: 'unbound'});
	assert.deepEqual(await s.lines('s-1'), []);
	await s.bind('s-1', b);
	await s.addLine('s-1', {n: 1, agent: 'skeptic', text: 'one'});
	await s.addLine('s-1', {n: 2, agent: 'dreamer', text: 'two'});
	await s.addLine('s-1', {n: 2, agent: 'Bad Agent', text: 'refused'});
	assert.equal(mode(path.join(dir, LINES_DIR)), 0o700);
	assert.equal(mode(path.join(dir, LINES_DIR, 's-1.jsonl')), 0o600);
	assert.deepEqual((await s.lines('s-1')).map(l => [l.n, 'agent' in l ? l.agent : l.kind, 'text' in l ? l.text : '']), [[1, 'skeptic', 'one'], [2, 'dreamer', 'two']]);
});

test('lines are capped by count and by size, oldest dropped', async () => {
	const s = createProfileStore({dataDir: fresh()});
	await s.bind('s-1', b);
	for (let i = 0; i < MAX_LINES + 5; i++) await s.addLine('s-1', {n: i, agent: 'skeptic', text: `l${i}`});
	const lines = await s.lines('s-1');
	assert.equal(lines.length, MAX_LINES);
	assert.equal('text' in lines[0]! && lines[0].text, 'l5');
	const big = 'x'.repeat(300 * 1024);
	for (let i = 0; i < 5; i++) await s.addLine('s-1', {n: 900 + i, agent: 'skeptic', text: big});
	const after = await s.lines('s-1');
	assert.ok(after.reduce((n, l) => n + Buffer.byteLength(JSON.stringify(l)) + 1, 0) <= MAX_LINES_BYTES);
	assert.equal(after.at(-1)!.n, 904);
});

test('direction and silence records round-trip with the lines in file order; a bad kind is skipped', async () => {
	const dir = fresh();
	const s = createProfileStore({dataDir: dir});
	await s.bind('s-1', b);
	await s.addRecord('s-1', {n: 1, kind: 'direction', text: 'Skeptic, go.'});
	await s.addRecord('s-1', {n: 1, kind: 'line', agent: 'skeptic', text: 'Hm.'});
	await s.addRecord('s-1', {n: 1, kind: 'silence'});
	await s.addRecord('s-1', {n: 1, kind: 'direction', text: ' '});
	await s.addRecord('s-1', {n: 1, kind: 'direction', text: 'x'.repeat(202)});
	appendFileSync(path.join(dir, LINES_DIR, 's-1.jsonl'), `${JSON.stringify({n: 2, at: 1, kind: 'weird', text: 'x'})}\n${JSON.stringify({n: 2, at: 1, kind: 'direction', text: 'y'.repeat(300)})}\n`);
	const got = await s.lines('s-1');
	assert.deepEqual(got.map(r => ('kind' in r ? r.kind : r.agent)), ['direction', 'skeptic', 'silence']);
	assert.equal('text' in got[0]! && got[0].text, 'Skeptic, go.');
});
