import type {CommandBridge} from '../../../../src/api.js';
import type {ChatController, ToolPatch} from './events.js';
import type {ChatMode} from './permission.js';
import type {ShellFeed} from './shell.js';
import type {ChatUsage} from './usage.js';

export type Origin = 'user' | 'assistant' | 'unattended' | 'module';

// A value this code does not know (read at runtime) is not interactive: the check fails closed.
export const isInteractive = (o: Origin): boolean => o === 'user' || o === 'assistant';

export type ProviderCommand = {name: string; description?: string; argumentHint?: string};

export type TaskInfo = {
	id: string;
	status: 'running' | 'completed' | 'failed' | 'stopped';
	description: string;
	background: boolean;
	startedAt: number;
	summary?: string;
	taskType?: string;
	toolUseId?: string;
	subagentType?: string;
};

export type RewindResult = {canRewind: boolean; error?: string; filesChanged?: string[]; insertions?: number; deletions?: number};

export type McpServerStatus = {name: string; status: string; error?: string};

export type SessionSummary = {sessionId: string; title: string; modified: number; prompts: number};
export type HistoryMessage = {role: 'user' | 'assistant'; text: string};
export type PromptEntry = {uuid: string; parentUuid: string | null; text: string};

export type DetailFile = {kind: 'file'; name: string; input: unknown; patch?: ToolPatch; isError: boolean};
export type DetailText = {kind: 'text'; text: string};
export type DetailLine = string | DetailFile | DetailText;

export interface ChatSession extends ChatController {
	readonly commands?: readonly ProviderCommand[];
	readonly tasks?: readonly TaskInfo[];
	readonly usage?: ChatUsage;
	stopTask?(id: string): Promise<void>;
	mcpStatus?(): Promise<McpServerStatus[] | undefined>;
	reconnectMcp?(name: string): Promise<void>;
	rewindFiles?(userMessageId: string): Promise<RewindResult>;
	setTitle?(title: string): void;
	setKeep?(keep: boolean): void;
	end?(): void;
}

export type OpenRequest = {
	origin: Origin;
	fresh: boolean;
	attach?: boolean;
	model?: string;
	resume?: string;
	fork?: boolean;
	resumeAt?: string;
	historyUntil?: string;
	draft?: string;
	mode?: ChatMode;
	keep?: boolean;
};

export type OpenEnv = {
	print: (text: string) => void;
	notice: (text: string) => void;
	wait: (check: () => Promise<{free: boolean; title?: string}>) => Promise<boolean>;
	commandBridge?: CommandBridge;
};

export type OpenedChat = {
	session: ChatSession;
	scrub: (s: string) => string;
	reveal: (s: string) => string;
	projectDir: string;
	model?: string;
	account?: string;
	resume?: string;
	reattached?: {startedAt: number};
	detachedWhileRunning(): boolean;
	shell?: {feed: ShellFeed; hasTmp: boolean};
	pin?: {current(): string | undefined; subscribe(cb: () => void): () => void};
	admitSend(origin: Origin): void;
	close(): void;
	flush(): Promise<void>;
};

export type RunningInfo = {
	kind: 'chat' | 'ask';
	where: 'local' | 'background';
	state?: 'running' | 'idle' | 'waiting-permission';
	title?: string;
	session8?: string;
	startedAt: number;
	pid: number;
	pending: number;
	queued: number;
	attached?: boolean;
};

export type RunningState = {sessions: RunningInfo[]; starting: boolean};

export type StopResult = {kind: 'chat' | 'ask'; via: 'socket' | 'signal'};

export type AskRequest = {origin: Origin; text: string; fresh: boolean};
export type AskEnv = {print: (text: string) => void; signal?: AbortSignal};

export type DescribeRow = {label: string; value: string};

export type LegacyChatPrefs = {permissionMode?: 'acceptEdits' | 'plan' | 'auto'; inputMode?: 'vim'; keepRunning?: boolean};

export interface ChatProvider {
	readonly id: string;
	readonly label: string;
	readonly modes: readonly ChatMode[];
	redact(text: string): string;
	admit(origin: Origin): Promise<void>;
	open(req: OpenRequest, env: OpenEnv): Promise<OpenedChat | undefined>;
	lastSession(): Promise<string | undefined>;
	sessions(limit?: number): Promise<SessionSummary[]>;
	history(id: string, opts?: {limit?: number; until?: string}): Promise<HistoryMessage[]>;
	prompts(id: string): Promise<PromptEntry[]>;
	detail(id: string): Promise<DetailLine[]>;
	title(id: string): Promise<string | undefined>;
	rename(id: string, name: string): Promise<void>;
	projectDir(): string;
	running(): Promise<RunningState>;
	stop(id?: string): Promise<StopResult | undefined>;
	commandHints(): readonly ProviderCommand[];
	describe(session?: ChatSession): Promise<DescribeRow[]>;
	ask(req: AskRequest, env: AskEnv): Promise<void>;
	validModel(model: string): boolean;
	legacyPrefs?(): Promise<LegacyChatPrefs>;
	clearLegacyPrefs?(): Promise<void>;
}
