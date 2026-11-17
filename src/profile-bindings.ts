import {appendFile, mkdir, readFile, rename, rm, stat, writeFile} from 'node:fs/promises';
import path from 'node:path';
import type {Logger} from '../../../src/api.js';
import {PROFILE_AGENT_RE, PROFILE_ARG_RE, PROFILE_ID_RE, PROFILE_LIMITS} from './contract/profile.js';
import {noopLog} from './log.js';

export const PROFILES_FILE = 'profiles.json';
export const LINES_DIR = 'profile-lines';
export const MAX_BINDINGS = 1000;
export const MAX_LINES = 500;
export const MAX_LINES_BYTES = 1024 * 1024;

export const SESSION_ID_RE = /^[A-Za-z0-9-]{1,128}$/;
const NOUN_RE = /^[a-z]{2,16}$/;

export type ProfileBinding = {id: string; owner: string; noun?: string; args: string[]; at: number; last: number};
export type BoundSession = ProfileBinding & {sessionId: string};
export type SavedLine = {n: number; at: number; agent: string; text: string};

export type ProfileStore = {
	bind(sessionId: string, binding: {id: string; owner: string; noun?: string; args?: readonly string[]}): Promise<void>;
	touch(sessionId: string): Promise<void>;
	lookup(sessionId: string): Promise<ProfileBinding | undefined>;
	has(sessionId: string): Promise<boolean>;
	ids(): Promise<ReadonlySet<string>>;
	listFor(id: string, limit: number): Promise<BoundSession[]>;
	addLine(sessionId: string, line: {n: number; agent: string; text: string}): Promise<void>;
	lines(sessionId: string): Promise<SavedLine[]>;
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isTime = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

function parseBinding(v: unknown): ProfileBinding | undefined {
	if (!isRecord(v)) return undefined;
	const {id, owner, noun, args, at, last} = v;
	if (typeof id !== 'string' || !PROFILE_ID_RE.test(id) || typeof owner !== 'string' || !PROFILE_ID_RE.test(owner)) return undefined;
	if (noun !== undefined && (typeof noun !== 'string' || !NOUN_RE.test(noun))) return undefined;
	if (!Array.isArray(args) || args.length > PROFILE_LIMITS.args || args.some(a => typeof a !== 'string' || !PROFILE_ARG_RE.test(a))) return undefined;
	if (!isTime(at) || !isTime(last)) return undefined;
	return {id, owner, ...(noun !== undefined && {noun}), args: args as string[], at, last};
}

function parseLine(raw: string): SavedLine | undefined {
	let v: unknown;
	try {
		v = JSON.parse(raw);
	} catch {
		return undefined;
	}
	if (!isRecord(v)) return undefined;
	const {n, at, agent, text} = v;
	if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || !isTime(at)) return undefined;
	if (typeof agent !== 'string' || !PROFILE_AGENT_RE.test(agent) || typeof text !== 'string' || text === '') return undefined;
	return {n, at, agent, text};
}

export function createProfileStore(opts: {dataDir: string; log?: Logger}): ProfileStore {
	const log = opts.log ?? noopLog;
	const file = path.join(opts.dataDir, PROFILES_FILE);
	const linesDir = path.join(opts.dataDir, LINES_DIR);
	let queue: Promise<unknown> = Promise.resolve();
	let invalidWarned = false;
	const counts = new Map<string, number>();

	const serial = <T>(task: () => Promise<T>): Promise<T> => {
		const run = queue.then(task, task);
		queue = run.catch(() => {});
		return run;
	};

	const read = async (): Promise<Map<string, ProfileBinding>> => {
		let raw: string;
		try {
			raw = await readFile(file, 'utf8');
		} catch (err) {
			if ((err as {code?: unknown}).code === 'ENOENT') return new Map();
			throw err;
		}
		const out = new Map<string, ProfileBinding>();
		try {
			const parsed: unknown = JSON.parse(raw);
			if (!isRecord(parsed) || parsed['v'] !== 1 || !isRecord(parsed['sessions'])) throw new Error('shape');
			const entries = Object.entries(parsed['sessions']);
			for (const [sessionId, value] of entries) {
				const binding = parseBinding(value);
				if (!SESSION_ID_RE.test(sessionId) || !binding) throw new Error('entry');
				out.set(sessionId, binding);
			}
		} catch {
			if (!invalidWarned) {
				invalidWarned = true;
				log.warn('profile bindings invalid', {bytes: raw.length});
			}
			return new Map();
		}
		return out;
	};

	const write = async (map: Map<string, ProfileBinding>): Promise<void> => {
		const dropped: string[] = [];
		if (map.size > MAX_BINDINGS) {
			const newest = [...map.entries()].sort((a, b) => b[1].last - a[1].last).slice(0, MAX_BINDINGS);
			const keep = new Set(newest.map(([id]) => id));
			for (const id of map.keys()) if (!keep.has(id)) dropped.push(id);
			for (const id of dropped) map.delete(id);
		}
		await mkdir(opts.dataDir, {recursive: true, mode: 0o700});
		const tmp = `${file}.${process.pid}.tmp`;
		await writeFile(tmp, `${JSON.stringify({v: 1, sessions: Object.fromEntries(map)})}\n`, {mode: 0o600});
		await rename(tmp, file);
		invalidWarned = false;
		for (const id of dropped) counts.delete(id);
		for (const id of dropped) await rm(path.join(linesDir, `${id}.jsonl`), {force: true}).catch(() => {});
		if (dropped.length > 0) log.info('profile bindings pruned', {dropped: dropped.length});
	};

	const checkId = (sessionId: string): void => {
		if (!SESSION_ID_RE.test(sessionId)) throw new Error('Invalid session id');
	};

	const lineFile = (sessionId: string): string => path.join(linesDir, `${sessionId}.jsonl`);

	const readLines = async (sessionId: string): Promise<SavedLine[]> => {
		let raw: string;
		try {
			raw = await readFile(lineFile(sessionId), 'utf8');
		} catch (err) {
			if ((err as {code?: unknown}).code === 'ENOENT') return [];
			throw err;
		}
		return raw
			.split('\n')
			.filter(l => l !== '')
			.flatMap(l => parseLine(l) ?? []);
	};

	return {
		bind: (sessionId, b) =>
			serial(async () => {
				checkId(sessionId);
				const map = await read();
				const now = Date.now();
				const old = map.get(sessionId);
				const next = old ? {...old, last: now} : parseBinding({id: b.id, owner: b.owner, ...(b.noun !== undefined && {noun: b.noun}), args: [...(b.args ?? [])], at: now, last: now});
				// One invalid entry makes read() discard the whole file, so refuse it here.
				if (!next) throw new Error('Invalid profile binding');
				map.set(sessionId, next);
				await write(map);
			}),
		touch: sessionId =>
			serial(async () => {
				checkId(sessionId);
				const map = await read();
				const old = map.get(sessionId);
				if (!old) return;
				map.set(sessionId, {...old, last: Date.now()});
				await write(map);
			}),
		lookup: sessionId => serial(async () => (SESSION_ID_RE.test(sessionId) ? (await read()).get(sessionId) : undefined)),
		has: sessionId => serial(async () => SESSION_ID_RE.test(sessionId) && (await read()).has(sessionId)),
		ids: () => serial(async () => new Set((await read()).keys())),
		listFor: (id, limit) =>
			serial(async () =>
				[...(await read()).entries()]
					.filter(([, b]) => b.id === id)
					.sort((a, b) => b[1].last - a[1].last)
					.slice(0, Math.max(0, limit))
					.map(([sessionId, b]) => ({sessionId, ...b})),
			),
		addLine: (sessionId, line) =>
			serial(async () => {
				checkId(sessionId);
				if (!(await read()).has(sessionId) || !PROFILE_AGENT_RE.test(line.agent) || line.text.trim() === '') return;
				const entry: SavedLine = {n: line.n, at: Date.now(), agent: line.agent, text: line.text};
				const target = lineFile(sessionId);
				await mkdir(linesDir, {recursive: true, mode: 0o700});
				const before = counts.get(sessionId) ?? (await readLines(sessionId)).length;
				await appendFile(target, `${JSON.stringify(entry)}\n`, {mode: 0o600});
				counts.set(sessionId, before + 1);
				const size = (await stat(target)).size;
				if (before + 1 <= MAX_LINES && size <= MAX_LINES_BYTES) return;
				const serialized = (await readLines(sessionId)).map(l => `${JSON.stringify(l)}\n`);
				let from = Math.max(0, serialized.length - MAX_LINES);
				let total = 0;
				for (let i = serialized.length - 1; i >= from; i--) {
					total += Buffer.byteLength(serialized[i]!);
					if (total > MAX_LINES_BYTES) {
						from = i + 1;
						break;
					}
				}
				const tmp = `${target}.${process.pid}.tmp`;
				await writeFile(tmp, serialized.slice(from).join(''), {mode: 0o600});
				await rename(tmp, target);
				counts.set(sessionId, serialized.length - from);
			}),
		lines: sessionId => serial(async () => (SESSION_ID_RE.test(sessionId) ? readLines(sessionId) : [])),
	};
}
