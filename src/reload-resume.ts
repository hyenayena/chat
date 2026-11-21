import {mkdirSync, renameSync, writeFileSync} from 'node:fs';
import {lstat, readFile, unlink} from 'node:fs/promises';
import path from 'node:path';
import type {Logger} from '../../../src/api.js';
import {errClass, noopLog} from './log.js';
import {SESSION_ID_RE} from './profile-bindings.js';

const MARKER_MAX_BYTES = 4096;

export const RELOAD_RESUME_FILE = 'reload-resume.json';
export const RELOAD_RESUME_MAX_AGE_MS = 5 * 60_000;
const FUTURE_SKEW_MS = 60_000;
const PROVIDER_MAX = 64;
const MODE_MAX = 32;

export type ReloadResumeEntry = {provider: string; sessionId: string; mode?: string};

export type ReloadResume = {
	record(entry: ReloadResumeEntry): void;
	take(): Promise<ReloadResumeEntry | undefined>;
};

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function createReloadResume(opts: {dataDir: string; log?: Logger; now?: () => number}): ReloadResume {
	const log = opts.log ?? noopLog;
	const now = opts.now ?? Date.now;
	const file = path.join(opts.dataDir, RELOAD_RESUME_FILE);

	const parse = (text: string): ReloadResumeEntry | 'invalid' | 'stale' => {
		let raw: unknown;
		try {
			raw = JSON.parse(text);
		} catch {
			return 'invalid';
		}
		if (!isObject(raw) || raw['v'] !== 1) return 'invalid';
		const {at, provider, sessionId, mode} = raw;
		if (typeof at !== 'number' || !Number.isFinite(at)) return 'invalid';
		if (typeof provider !== 'string' || provider === '' || provider.length > PROVIDER_MAX) return 'invalid';
		if (typeof sessionId !== 'string' || !SESSION_ID_RE.test(sessionId)) return 'invalid';
		if (mode !== undefined && (typeof mode !== 'string' || mode === '' || mode.length > MODE_MAX)) return 'invalid';
		const t = now();
		if (t - at > RELOAD_RESUME_MAX_AGE_MS || at > t + FUTURE_SKEW_MS) return 'stale';
		return {provider, sessionId, ...(mode !== undefined && {mode})};
	};

	return {
		record: entry => {
			try {
				if (!SESSION_ID_RE.test(entry.sessionId)) throw new Error('Invalid session id');
				mkdirSync(opts.dataDir, {recursive: true});
				const tmp = `${file}.${process.pid}.tmp`;
				writeFileSync(tmp, `${JSON.stringify({v: 1, at: now(), ...entry})}\n`, {mode: 0o600});
				renameSync(tmp, file);
				log.info('reload resume recorded', {session8: entry.sessionId.slice(0, 8), provider: entry.provider});
			} catch (err) {
				log.warn('reload resume not recorded', {err});
			}
		},
		take: async () => {
			try {
				let text: string;
				try {
					const info = await lstat(file);
					// A link or an oversized file is never read: only chat writes this small regular file.
					if (!info.isFile() || info.size > MARKER_MAX_BYTES) {
						await unlink(file).catch(() => undefined);
						log.info('reload resume', {outcome: 'invalid'});
						return undefined;
					}
					text = await readFile(file, 'utf8');
				} catch (err) {
					if ((err as {code?: unknown}).code === 'ENOENT') {
						log.debug('reload resume', {outcome: 'none'});
						return undefined;
					}
					throw err;
				}
				await unlink(file).catch(() => undefined);
				const parsed = parse(text);
				if (typeof parsed === 'string') {
					log.info('reload resume', {outcome: parsed});
					return undefined;
				}
				log.info('reload resume', {outcome: 'found', session8: parsed.sessionId.slice(0, 8)});
				return parsed;
			} catch (err) {
				log.warn('reload resume unreadable', {errClass: errClass(err)});
				await unlink(file).catch(() => undefined);
				return undefined;
			}
		},
	};
}
