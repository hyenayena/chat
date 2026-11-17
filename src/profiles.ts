import type {CommandContext} from '../../../src/api.js';
import {checkProfile, PROFILE_ID_RE, type ChatProfile, type ChatProfileSource, type ProfileSessionInfo} from './contract/profile.js';

type Opener = (profile: ChatProfile, ctx: CommandContext) => Promise<void>;
type SessionHandlers = {
	sessions(id: string, limit: number): Promise<ProfileSessionInfo[]>;
	resume(sessionId: string, ctx: CommandContext): Promise<void>;
};

const NOT_LOADED = 'The chat module is not loaded';
const SOURCES_MAX = 32;

let opener: Opener | undefined;
let handlers: SessionHandlers | undefined;
const sources = new Map<string, ChatProfileSource>();

export function setProfileOpener(open: Opener | undefined): void {
	opener = open;
}

export function setProfileSessions(next: SessionHandlers | undefined): void {
	handlers = next;
}

export async function openProfileChat(profile: ChatProfile, ctx: CommandContext): Promise<void> {
	const checked = checkProfile(profile);
	if (!opener) throw new Error(NOT_LOADED);
	await opener(checked, ctx);
}

// Returns an unregister function, or undefined when the source is refused.
export function registerChatProfile(src: ChatProfileSource): (() => void) | undefined {
	const ok =
		typeof src === 'object' &&
		src !== null &&
		typeof src.id === 'string' &&
		PROFILE_ID_RE.test(src.id) &&
		src.id !== 'yena' &&
		typeof src.owner === 'string' &&
		PROFILE_ID_RE.test(src.owner) &&
		typeof src.build === 'function';
	if (!ok || sources.has(src.id) || sources.size >= SOURCES_MAX) return undefined;
	const entry: ChatProfileSource = {id: src.id, owner: src.owner, build: src.build};
	sources.set(entry.id, entry);
	return () => {
		if (sources.get(entry.id) === entry) sources.delete(entry.id);
	};
}

export const resolveProfile = (id: string): ChatProfileSource | undefined => sources.get(id);

export async function profileSessions(id: string, limit = 50): Promise<ProfileSessionInfo[]> {
	if (!handlers) throw new Error(NOT_LOADED);
	return handlers.sessions(id, Math.max(0, Math.min(Math.floor(limit), 1000)));
}

export async function resumeProfileChat(sessionId: string, ctx: CommandContext): Promise<void> {
	if (!handlers) throw new Error(NOT_LOADED);
	await handlers.resume(sessionId, ctx);
}
