export type ChatMode = 'default' | 'acceptEdits' | 'plan' | 'auto';
export const MODE_CYCLE: readonly ChatMode[] = ['default', 'acceptEdits', 'plan', 'auto'];

export type Highlight = {level: 'info' | 'warn'; text: string};

export type PreviewRow = {
	kind: 'meta' | 'ctx' | 'add' | 'del' | 'gap';
	text: string;
	no?: number;
	oldNo?: number;
	newNo?: number;
	count?: number;
};

export type Preview = {
	rows: PreviewRow[];
	added: number;
	removed: number;
	truncated: boolean;
	approximate: boolean;
};

export type QuestionSpec = {
	question: string;
	header: string;
	multiSelect: boolean;
	options: {label: string; description: string}[];
};

export type ToolRequest = {
	kind: 'tool';
	id: string;
	seq: number;
	toolName: 'Bash' | 'Edit' | 'Write' | 'WebFetch' | 'ExitPlanMode' | 'Mcp' | 'Command';
	input: Record<string, unknown>;
	cwd: string;
	path?: string;
	resolvedPath?: string;
	description?: string;
	cliNote?: {text: string; type?: string};
	preview?: Preview;
	highlights: Highlight[];
	defaultToNo: boolean;
	always: false | {label: string};
	oversize: boolean;
};

export type QuestionRequest = {
	kind: 'question';
	id: string;
	seq: number;
	questions: QuestionSpec[];
};

export type PermissionRequest = ToolRequest | QuestionRequest;

export type CancelCause = 'aborted' | 'interrupted' | 'closed' | 'timeout' | 'replaced';

export type PermissionDecision =
	| {kind: 'allow'; always?: boolean}
	| {kind: 'deny'; reason?: string; stop?: boolean}
	| {kind: 'answers'; answers: Record<string, string>}
	| {kind: 'cancel'; cause: CancelCause};

export type AuditEntry = {
	outcome:
		| 'allowed'
		| 'auto-accepted'
		| 'always-allowed'
		| 'denied'
		| 'denied-by-policy'
		| 'cancelled'
		| 'answered'
		| 'dismissed';
	toolName: string;
	summary: string;
};

export const REASON_MAX = 500;
export const BASH_REVIEW_MAX = 20_000;
export const PAYLOAD_REVIEW_MAX = 200_000;

export const QUESTION_LIMITS = {
	questions: 4,
	options: 4,
	question: 300,
	header: 30,
	label: 100,
	description: 300,
	freeText: 500,
} as const;

export const DENY_MESSAGE =
	'The user denied this tool call. Do not retry it or work around the denial; explain what you need and ask the user.';
export const DENY_REASON_PREFIX = "User's reason: ";
export const CANCEL_MESSAGE =
	'The request was cancelled before the user answered (the turn was interrupted or the chat closed).';
export const DISMISS_MESSAGE = 'The user dismissed the question without answering.';
