import {isTier, type Tier} from './tiers.js';

export const PROFILE_ID_RE = /^[a-z][a-z0-9-]{0,31}$/;
export const PROFILE_AGENT_RE = /^[a-z][a-z0-9-]{0,31}$/;
const RESERVED_ID = 'yena';
const NOUN_RE = /^[a-z]{2,16}$/;
export const PROFILE_ARG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const TOOL_NAME_RE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const CONTROL_RE = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f]');

export const PROFILE_LIMITS = {
	appendPrompt: 32_768,
	agentPrompt: 16_384,
	description: 1024,
	label: 40,
	agents: 8,
	turnAgentCalls: 8,
	keepAliveMs: 1_800_000,
	mainTools: 8,
	passWord: 32,
	args: 16,
} as const;

export const PROFILE_TONES = {
	teal: 'accent',
	green: 'ok',
	yellow: 'warn',
	orange: 'running',
	blue: 'heading',
	violet: 'code.keyword',
} as const;

export type ProfileTone = keyof typeof PROFILE_TONES;

export type ProfileAgent = {
	description: string;
	prompt: string;
	label: string;
	tone: ProfileTone;
	tier?: Tier;
};

export type ChatProfile = {
	id: string;
	owner: string;
	banner?: string;
	noun?: string;
	args?: string[];
	appendSystemPrompt: string;
	mainTools: string[];
	agents: Record<string, ProfileAgent>;
	turnAgentCalls?: number;
	keepAliveMs?: number;
	mainTier?: Tier;
	loadInstructions?: false;
	passWord?: string;
};

export type ChatProfileSource = {
	id: string;
	owner: string;
	build(args: string[]): Promise<ChatProfile>;
};

export type ProfileSessionInfo = {sessionId: string; title?: string; startedAt: number; lastAt: number; args: string[]};

const invalid = (field: string): Error => new Error(`Invalid chat profile: ${field}`);

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const text = (v: unknown, field: string, max: number, opts: {single?: boolean} = {}): string => {
	if (typeof v !== 'string' || v.trim() === '' || v.length > max) throw invalid(field);
	if (opts.single && CONTROL_RE.test(v)) throw invalid(field);
	return v;
};

const int = (v: unknown, field: string, min: number, max: number): number => {
	if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw invalid(field);
	return v;
};

const checkAgent = (name: string, v: unknown): ProfileAgent => {
	const field = `agents.${name}`;
	if (!isRecord(v)) throw invalid(field);
	const tone = v.tone;
	if (typeof tone !== 'string' || !Object.hasOwn(PROFILE_TONES, tone)) throw invalid(`${field}.tone`);
	if (v.tier !== undefined && !isTier(v.tier)) throw invalid(`${field}.tier`);
	return Object.freeze({
		description: text(v.description, `${field}.description`, PROFILE_LIMITS.description),
		prompt: text(v.prompt, `${field}.prompt`, PROFILE_LIMITS.agentPrompt),
		label: text(v.label, `${field}.label`, PROFILE_LIMITS.label, {single: true}),
		tone: tone as ProfileTone,
		...(v.tier !== undefined && {tier: v.tier}),
	});
};

// Returns a frozen copy: the profile is data a module hands over, and nothing may change it after the check.
export function checkProfile(p: unknown): ChatProfile {
	if (!isRecord(p)) throw invalid('profile');
	if (typeof p.id !== 'string' || !PROFILE_ID_RE.test(p.id) || p.id === RESERVED_ID) throw invalid('id');
	if (typeof p.owner !== 'string' || !PROFILE_ID_RE.test(p.owner)) throw invalid('owner');
	if (p.noun !== undefined && (typeof p.noun !== 'string' || !NOUN_RE.test(p.noun))) throw invalid('noun');
	if (p.args !== undefined && (!Array.isArray(p.args) || p.args.length > PROFILE_LIMITS.args || p.args.some(a => typeof a !== 'string' || !PROFILE_ARG_RE.test(a)))) throw invalid('args');
	if (p.banner !== undefined) text(p.banner, 'banner', PROFILE_LIMITS.description, {single: true});
	const appendSystemPrompt = text(p.appendSystemPrompt, 'appendSystemPrompt', PROFILE_LIMITS.appendPrompt);

	const tools = p.mainTools;
	if (!Array.isArray(tools) || tools.length > PROFILE_LIMITS.mainTools) throw invalid('mainTools');
	for (const t of tools) if (typeof t !== 'string' || !TOOL_NAME_RE.test(t)) throw invalid('mainTools');

	if (!isRecord(p.agents)) throw invalid('agents');
	const names = Object.keys(p.agents);
	if (names.length > PROFILE_LIMITS.agents) throw invalid('agents');
	const agents: Record<string, ProfileAgent> = {};
	for (const name of names) {
		if (!PROFILE_AGENT_RE.test(name)) throw invalid(`agents.${name.slice(0, 40)}`);
		agents[name] = checkAgent(name, p.agents[name]);
	}

	if (p.mainTier !== undefined && !isTier(p.mainTier)) throw invalid('mainTier');
	if (p.loadInstructions !== undefined && p.loadInstructions !== false) throw invalid('loadInstructions');
	const passWord = p.passWord === undefined ? undefined : text(p.passWord, 'passWord', PROFILE_LIMITS.passWord, {single: true});
	if (passWord !== undefined && /\s|:/u.test(passWord)) throw invalid('passWord');

	return Object.freeze({
		id: p.id,
		owner: p.owner,
		...(p.banner !== undefined && {banner: p.banner as string}),
		...(p.noun !== undefined && {noun: p.noun as string}),
		...(p.args !== undefined && {args: Object.freeze([...(p.args as string[])]) as string[]}),
		appendSystemPrompt,
		mainTools: Object.freeze([...(tools as string[])]) as string[],
		agents: Object.freeze(agents),
		...(p.turnAgentCalls !== undefined && {turnAgentCalls: int(p.turnAgentCalls, 'turnAgentCalls', 1, PROFILE_LIMITS.turnAgentCalls)}),
		...(p.keepAliveMs !== undefined && {keepAliveMs: int(p.keepAliveMs, 'keepAliveMs', 1, PROFILE_LIMITS.keepAliveMs)}),
		...(p.mainTier !== undefined && {mainTier: p.mainTier}),
		...(p.loadInstructions === false && {loadInstructions: false as const}),
		...(passWord !== undefined && {passWord}),
	});
}

export function isPassReply(text: string, word: string): boolean {
	const t = text.trim();
	return t === word || t.startsWith(`${word}:`);
}

export const nounOf = (profile?: Pick<ChatProfile, 'noun'>): string => profile?.noun ?? 'chat';

export const capNoun = (noun: string): string => noun.charAt(0).toUpperCase() + noun.slice(1);
