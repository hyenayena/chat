import type {ChatEvent, ChatState, TurnOutcome} from './events.js';
import type {PermissionRequest} from './permission.js';

export type ModulePrompts = 'deny' | 'show';

export type ModuleSessionRequest = {
	owner: string;
	provider?: string;
	model?: string;
	mode?: 'default' | 'plan';
	prompts?: ModulePrompts;
	promptTimeoutMs?: number;
	idleTimeoutMs?: number;
	onNotice?: (text: string) => void;
};

export interface ModuleSession {
	readonly owner: string;
	readonly providerId: string;
	readonly state: ChatState;
	readonly sessionId: string | undefined;
	readonly model: string | undefined;
	readonly pendingPermissions: readonly PermissionRequest[];
	scrub(text: string): string;
	send(text: string): void;
	interrupt(): Promise<void>;
	deny(id: string): boolean;
	subscribe(cb: (e: ChatEvent) => void): () => void;
	end(): Promise<void>;
}

export type CollectOptions = {signal?: AbortSignal; timeoutMs?: number};
export type CollectedAnswer = {outcome: TurnOutcome; text: string; error?: string};
