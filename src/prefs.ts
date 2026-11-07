import {mkdir, rename, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import type {Logger} from '../../../src/api.js';
import type {ChatProvider, LegacyChatPrefs} from './contract/provider.js';
import {errClass, noopLog} from './log.js';
import {chatProvider, chatProviders} from './registry.js';

export type ChatPrefs = {permissionMode?: 'acceptEdits' | 'plan' | 'auto'; inputMode?: 'vim'; keepRunning?: boolean; provider?: string};

export const PREFS_FILE = 'prefs.json';
const PROVIDER_MAX = 40;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function parsePrefs(raw: unknown): ChatPrefs | undefined {
	if (!isObject(raw) || raw['v'] !== 1) return undefined;
	const out: ChatPrefs = {};
	const {permissionMode, inputMode, keepRunning, provider} = raw;
	if (permissionMode !== undefined) {
		if (permissionMode !== 'acceptEdits' && permissionMode !== 'plan' && permissionMode !== 'auto') return undefined;
		out.permissionMode = permissionMode;
	}
	if (inputMode !== undefined) {
		if (inputMode !== 'vim') return undefined;
		out.inputMode = inputMode;
	}
	if (keepRunning !== undefined) {
		if (typeof keepRunning !== 'boolean') return undefined;
		out.keepRunning = keepRunning;
	}
	if (provider !== undefined) {
		if (typeof provider !== 'string' || provider === '' || provider.length > PROVIDER_MAX) return undefined;
		out.provider = provider;
	}
	return out;
}

const fromLegacy = (l: LegacyChatPrefs): ChatPrefs => parsePrefs({v: 1, ...l}) ?? {};
const isEmpty = (l: LegacyChatPrefs): boolean => l.permissionMode === undefined && l.inputMode === undefined && l.keepRunning === undefined;

export type Prefs = {
	load(): Promise<ChatPrefs>;
	cached(): ChatPrefs;
	update(patch: {[K in keyof ChatPrefs]: ChatPrefs[K] | undefined}): Promise<ChatPrefs>;
	defaultProvider(): ChatProvider;
};

export function createPrefs(opts: {dataDir: string; log?: Logger}): Prefs {
	const log = opts.log ?? noopLog;
	const file = path.join(opts.dataDir, PREFS_FILE);
	let cache: ChatPrefs = {};
	let loading: Promise<ChatPrefs> | undefined;

	const registered = (): ChatProvider[] => chatProviders().flatMap(p => chatProvider(p.id) ?? []);

	const write = async (prefs: ChatPrefs): Promise<void> => {
		await mkdir(opts.dataDir, {recursive: true});
		const tmp = `${file}.${process.pid}.tmp`;
		await writeFile(tmp, `${JSON.stringify({v: 1, ...prefs})}\n`, {mode: 0o600});
		await rename(tmp, file);
	};

	// Runs once and only when the file is missing; the old values are cleared only after the new file is written.
	const handOver = async (): Promise<ChatPrefs | undefined> => {
		const list = registered();
		if (list.length === 0) return undefined;
		let found: LegacyChatPrefs | undefined;
		try {
			for (const p of list) {
				const legacy = await p.legacyPrefs?.();
				if (legacy && !isEmpty(legacy)) {
					found = legacy;
					break;
				}
			}
			const prefs = found ? fromLegacy(found) : {};
			await write(prefs);
			for (const p of list) {
				try {
					await p.clearLegacyPrefs?.();
				} catch (err) {
					log.warn('legacy prefs not cleared', {errClass: errClass(err)});
				}
			}
			return prefs;
		} catch (err) {
			log.warn('prefs hand-over failed', {errClass: errClass(err)});
			return {};
		}
	};

	const read = async (): Promise<ChatPrefs | undefined> => {
		let text: string;
		try {
			text = await readFile(file, 'utf8');
		} catch (err) {
			if ((err as {code?: unknown}).code === 'ENOENT') return handOver();
			log.warn('prefs unreadable', {errClass: errClass(err)});
			return {};
		}
		try {
			const parsed = parsePrefs(JSON.parse(text));
			if (parsed) return parsed;
		} catch {
			// falls through to the warning below
		}
		log.warn('prefs invalid; using the defaults');
		return {};
	};

	const load = (): Promise<ChatPrefs> => {
		loading ??= read().then(prefs => {
			// Without a provider the hand-over could not run; the next call tries again.
			if (prefs === undefined) loading = undefined;
			else cache = prefs;
			return prefs ?? {};
		});
		return loading;
	};

	return {
		load,
		cached: () => cache,
		update: async patch => {
			const current = await load();
			const next: ChatPrefs = {...current};
			for (const key of Object.keys(patch) as (keyof ChatPrefs)[]) {
				if (patch[key] === undefined) delete next[key];
				else (next as Record<string, unknown>)[key] = patch[key];
			}
			await write(next);
			cache = next;
			loading = Promise.resolve(next);
			return next;
		},
		defaultProvider: () => {
			const saved = cache.provider !== undefined ? chatProvider(cache.provider) : undefined;
			const first = chatProviders()[0];
			const found = saved ?? (first ? chatProvider(first.id) : undefined);
			if (!found) throw new Error('No chat provider is installed');
			return found;
		},
	};
}
