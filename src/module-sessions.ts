import type {Logger} from '../../../src/api.js';
import type {ChatEvent, TurnOutcome} from './contract/events.js';
import type {CancelCause} from './contract/permission.js';
import type {CollectedAnswer, CollectOptions, ModuleSession, ModuleSessionRequest} from './contract/module-session.js';
import type {ChatProvider, OpenedChat} from './contract/provider.js';
import {makeScrub} from './contract/scrub.js';
import {currentChat, userChatsBusy} from './current.js';
import {watchChatActivity} from './activity.js';
import {sanitizeText} from './kit.js';
import {errClass, noopLog} from './log.js';
import {chatProvider, chatProviders} from './registry.js';

const OWNER = /^[a-z][a-z0-9-]{0,31}$/;
const MODES: readonly string[] = ['default', 'plan'];
const SEC = 1000;
const HOUR = 3600 * SEC;
const PROMPT_TIMEOUT = {def: 15 * 60 * SEC, min: SEC, max: HOUR};
const ANSWER_TIMEOUT = {def: 10 * 60 * SEC, min: SEC, max: HOUR};
const IDLE_TIMEOUT = {def: 15 * 60 * SEC, min: 10 * SEC, max: HOUR};

export const USER_OPENED_CHAT = 'The user opened a chat';
const CHAT_OPEN = 'A chat is open; a module session starts only when no chat is open';
const BUSY = 'Another session is running; the module session was not opened';

type Limits = {def: number; min: number; max: number};
type Cause = CancelCause;

export type Internal = {
	opened: OpenedChat;
	owner: string;
	providerId: string;
	prompts: 'deny' | 'show';
	endCause: Cause | undefined;
	onEnd: Set<() => void>;
	end: (cause?: Cause) => Promise<void>;
};

const open = new Map<ModuleSession, Internal>();
const internals = new WeakMap<ModuleSession, Internal>();
let opening = false;
let log: Logger = noopLog;

export const setModuleSessionLog = (l: Logger): void => {
	log = l;
};

export const internalsOf = (handle: ModuleSession): Internal | undefined => internals.get(handle);

export const moduleSessionCount = (): number => open.size;

export async function resetModuleSessions(): Promise<void> {
	await Promise.all([...open.values()].map(i => i.end('closed')));
	open.clear();
	opening = false;
	log = noopLog;
}

const clamp = (v: unknown, l: Limits): number =>
	typeof v === 'number' && Number.isFinite(v) ? Math.min(l.max, Math.max(l.min, Math.floor(v))) : l.def;

const session8 = (id: string | undefined): string | undefined => id?.slice(0, 8);

export async function endModuleSessions(cause: 'replaced', notice: (text: string) => void): Promise<void> {
	const all = [...open.values()];
	for (const i of all) notice(`Ended the session of module "${i.owner}" to open this chat.`);
	await Promise.all(all.map(i => i.end(cause)));
}

function validate(req: ModuleSessionRequest): {mode: 'default' | 'plan'; prompts: 'deny' | 'show'} {
	if (typeof req !== 'object' || req === null || typeof req.owner !== 'string' || !OWNER.test(req.owner)) throw new Error('Invalid module name');
	const mode = req.mode ?? 'default';
	if (!MODES.includes(mode)) throw new Error(`A module session cannot use the mode "${sanitizeText(String(mode), 40)}"`);
	const prompts = req.prompts ?? 'deny';
	if (prompts !== 'deny' && prompts !== 'show') throw new Error('Invalid prompts setting');
	if (req.onNotice !== undefined && typeof req.onNotice !== 'function') throw new Error('Invalid notice callback');
	return {mode, prompts};
}

export async function openSession(req: ModuleSessionRequest): Promise<ModuleSession> {
	const {mode, prompts} = validate(req);
	const owner = req.owner;
	const refuse = (message: string, extra: Record<string, unknown> = {}): never => {
		log.info('module session refused', {owner, ...extra});
		throw new Error(message);
	};
	if (userChatsBusy() > 0 || currentChat() !== undefined) return refuse(CHAT_OPEN, {cause: 'chat'});
	if (opening || open.size > 0) return refuse('A module session is already open', {cause: 'module'});

	opening = true;
	const started = Date.now();
	try {
		const providerId = req.provider ?? chatProviders()[0]?.id;
		if (providerId === undefined) return refuse('No chat provider is registered');
		const provider = chatProvider(providerId);
		if (!provider) return refuse(`Unknown chat provider "${sanitizeText(String(providerId), 40)}"`);
		if (!provider.modes.includes(mode)) return refuse(`A module session cannot use the mode "${mode}"`);
		if (req.model !== undefined && (typeof req.model !== 'string' || !provider.validModel(req.model))) {
			return refuse(`Unknown model "${sanitizeText(String(req.model), 40)}"`);
		}

		const noticeScrub = makeScrub(t => provider.redact(t));
		const notify = (text: string): void => {
			if (!req.onNotice) {
				log.debug('module session notice dropped', {owner, chars: text.length});
				return;
			}
			try {
				req.onNotice(noticeScrub(text));
			} catch (err) {
				log.warn('module session notice handler failed', {owner, err});
			}
		};

		try {
			await provider.admit('module');
		} catch (err) {
			log.info('module session refused', {owner, provider: providerId, errClass: errClass(err)});
			throw err;
		}
		const opened = await provider.open(
			{origin: 'module', fresh: true, attach: false, keep: false, mode, ...(req.model !== undefined && {model: req.model})},
			{print: notify, notice: notify, wait: async () => false},
		);
		if (!opened) return refuse(BUSY, {provider: providerId, cause: 'busy'});
		// The user may have started a chat while the provider was opening.
		if (userChatsBusy() > 0 || !MODES.includes(opened.session.mode)) {
			const why = userChatsBusy() > 0 ? CHAT_OPEN : 'The provider did not honour the session mode';
			await shut(opened);
			return refuse(why, {provider: providerId, cause: 'late'});
		}
		return register(opened, provider, {owner, prompts, req, started});
	} finally {
		opening = false;
	}
}

async function shut(opened: OpenedChat): Promise<void> {
	try {
		opened.close();
		await opened.flush();
	} catch (err) {
		log.warn('module session close failed', {err});
	}
}

function register(
	opened: OpenedChat,
	provider: ChatProvider,
	ctx: {owner: string; prompts: 'deny' | 'show'; req: ModuleSessionRequest; started: number},
): ModuleSession {
	const {owner, prompts, req} = ctx;
	const session = opened.session;
	const promptMs = clamp(req.promptTimeoutMs, PROMPT_TIMEOUT);
	const idleMs = clamp(req.idleTimeoutMs, IDLE_TIMEOUT);
	const promptTimers = new Map<string, ReturnType<typeof setTimeout>>();
	let idleTimer: ReturnType<typeof setTimeout> | undefined;
	let ending: Promise<void> | undefined;
	let ended = false;
	const sid8 = session8(session.sessionId);

	const cancelPending = (cause: Cause): void => {
		for (const r of [...session.pendingPermissions]) session.answerPermission(r.id, {kind: 'cancel', cause});
	};
	const clearTimers = (): void => {
		if (idleTimer) clearTimeout(idleTimer);
		idleTimer = undefined;
		for (const t of promptTimers.values()) clearTimeout(t);
		promptTimers.clear();
	};

	const internal: Internal = {
		opened,
		owner,
		providerId: provider.id,
		prompts,
		endCause: undefined,
		onEnd: new Set(),
		end: cause => (ending ??= finish(cause ?? 'closed')),
	};

	const finish = async (cause: Cause): Promise<void> => {
		internal.endCause = cause;
		ended = true;
		clearTimers();
		unwatch();
		try {
			try {
				cancelPending(cause);
			} catch (err) {
				log.warn('module session cancel failed', {owner, err});
			}
			try {
				opened.close();
			} catch (err) {
				log.warn('module session close failed', {owner, err});
			}
			for (const cb of [...internal.onEnd]) cb();
			try {
				await opened.flush();
			} catch (err) {
				log.warn('module session flush failed', {owner, err});
			}
		} finally {
			open.delete(handle);
			log.info('module session ended', {owner, provider: provider.id, cause, ms: Date.now() - ctx.started, session8: sid8});
		}
	};

	const armIdle = (): void => {
		if (idleTimer) clearTimeout(idleTimer);
		idleTimer = undefined;
		if (ended || session.state !== 'idle' || session.pendingPermissions.length > 0) return;
		idleTimer = setTimeout(() => {
			idleTimer = undefined;
			if (ended || session.state !== 'idle' || session.pendingPermissions.length > 0) return;
			void internal.end('timeout');
		}, idleMs);
		idleTimer.unref?.();
	};

	const onEvent = (e: ChatEvent): void => {
		if (e.type === 'permission-requested') {
			const id = e.request.id;
			if (prompts === 'deny') {
				queueMicrotask(() => {
					if (!ended) session.answerPermission(id, {kind: 'deny'});
				});
			} else {
				const timer = setTimeout(() => {
					promptTimers.delete(id);
					if (ended) return;
					log.info('module prompt timed out', {owner, ms: promptMs});
					session.answerPermission(id, {kind: 'cancel', cause: 'timeout'});
				}, promptMs);
				timer.unref?.();
				promptTimers.set(id, timer);
			}
		} else if (e.type === 'permission-resolved') {
			const timer = promptTimers.get(e.id);
			if (timer) clearTimeout(timer);
			promptTimers.delete(e.id);
		}
		armIdle();
	};
	const unwatchEvents = session.subscribe(onEvent);
	const unwatchActivity = watchChatActivity(session, {id: `module-${owner}`, label: `chat · ${owner}`});
	const unwatch = (): void => {
		unwatchEvents();
		unwatchActivity();
	};

	const handle: ModuleSession = Object.freeze({
		owner,
		providerId: provider.id,
		get state() {
			return ended ? 'closed' : session.state;
		},
		get sessionId() {
			return session.sessionId;
		},
		get model() {
			return session.model;
		},
		get pendingPermissions() {
			return Object.freeze(ended ? [] : [...session.pendingPermissions]);
		},
		scrub: (text: string) => opened.scrub(text),
		send(text: string): void {
			if (ended) throw new Error('The module session has ended');
			if (typeof text !== 'string' || text.trim() === '') throw new Error('The message is empty');
			if (session.state === 'running') throw new Error('The module session is answering');
			if (typeof opened.admitSend !== 'function') throw new Error('The provider does not admit module messages');
			opened.admitSend('module');
			session.send(text);
			armIdle();
		},
		interrupt: async () => {
			if (!ended) await session.interrupt();
		},
		deny(id: string): boolean {
			if (ended || !session.pendingPermissions.some(r => r.id === id)) return false;
			return session.answerPermission(id, {kind: 'deny'});
		},
		subscribe: (cb: (e: ChatEvent) => void) => session.subscribe(cb),
		end: () => internal.end('closed'),
	});

	internals.set(handle, internal);
	open.set(handle, internal);
	armIdle();
	log.info('module session opened', {owner, provider: provider.id, session8: sid8, ms: Date.now() - ctx.started});
	return handle;
}

export async function collectAnswer(handle: ModuleSession, text: string, opts: CollectOptions = {}): Promise<CollectedAnswer> {
	const internal = internals.get(handle);
	if (!internal) throw new Error('Not a module session');
	if (internal.endCause !== undefined || handle.state === 'closed') throw new Error('The module session has ended');
	if (handle.state === 'running') throw new Error('The module session is answering');
	const {opened, owner} = internal;
	const timeoutMs = clamp(opts.timeoutMs, ANSWER_TIMEOUT);
	const started = Date.now();
	const scrub = opened.scrub;

	if (opts.signal?.aborted) return {outcome: 'interrupted', text: ''};

	return new Promise<CollectedAnswer>((resolve, reject) => {
		let last: string | undefined;
		let result: string | undefined;
		let settled = false;
		let timer: ReturnType<typeof setTimeout> | undefined;

		const cleanup = (): void => {
			if (timer) clearTimeout(timer);
			opts.signal?.removeEventListener('abort', onAbort);
			internal.onEnd.delete(onClosed);
			unsub();
		};
		const finalize = (outcome: TurnOutcome, error?: string): void => {
			const out = scrub(last ?? result ?? '');
			log.info('answer collected', {owner, outcome, ms: Date.now() - started, chars: out.length});
			resolve({outcome, text: out, ...(error !== undefined && {error: scrub(error)})});
		};
		const done = (outcome: TurnOutcome, error?: string): void => {
			if (settled) return;
			settled = true;
			cleanup();
			finalize(outcome, error);
		};
		const stop = async (cause: 'aborted' | 'timeout'): Promise<void> => {
			if (settled) return;
			settled = true;
			cleanup();
			try {
				for (const r of [...opened.session.pendingPermissions]) opened.session.answerPermission(r.id, {kind: 'cancel', cause});
				await opened.session.interrupt();
			} catch (err) {
				log.warn('module session interrupt failed', {owner, err});
			}
			finalize(cause === 'aborted' ? 'interrupted' : 'timeout');
		};
		const onAbort = (): void => void stop('aborted');
		const onClosed = (): void => {
			done('interrupted', internal.endCause === 'replaced' ? USER_OPENED_CHAT : 'The session ended');
		};

		const unsub = opened.session.subscribe(e => {
			if (settled) return;
			if (e.type === 'ui') {
				if (e.event.kind === 'text') last = e.event.text;
				else if (e.event.kind === 'result' && e.event.text !== undefined) result = e.event.text;
			} else if (e.type === 'turn-end') {
				done(e.outcome, e.error);
			} else if (e.type === 'state' && e.state === 'closed') {
				onClosed();
			}
		});
		internal.onEnd.add(onClosed);
		opts.signal?.addEventListener('abort', onAbort, {once: true});
		timer = setTimeout(() => void stop('timeout'), timeoutMs);
		timer.unref?.();

		try {
			handle.send(text);
		} catch (err) {
			settled = true;
			cleanup();
			reject(err);
		}
	});
}
