import type {
	AskRequest,
	ChatEvent,
	ChatProvider,
	ChatSession,
	OpenedChat,
	OpenRequest,
	Origin,
	ProviderCommand,
	RunningState,
	StopResult,
} from '../../src/public.js';

export type FakeSession = ChatSession & {
	sent: Array<{text: string; command: boolean}>;
	modes: string[];
	keeps: boolean[];
	stopped: string[];
	ended: number;
	closed: number;
	state: 'idle' | 'running' | 'closed';
	emit(e: ChatEvent): void;
};

export function makeSession(over: Partial<ChatSession> & {sessionId?: string; state?: 'idle' | 'running' | 'closed'} = {}): FakeSession {
	const subs = new Set<(e: ChatEvent) => void>();
	const s = {
		sent: [] as Array<{text: string; command: boolean}>,
		modes: [] as string[],
		keeps: [] as boolean[],
		stopped: [] as string[],
		ended: 0,
		closed: 0,
		state: 'idle',
		sessionId: 'aaaaaaaa-1111',
		model: 'm1',
		needsNewSession: false,
		mode: 'default',
		title: undefined,
		pendingPermissions: [],
		setMode(mode: string) {
			s.modes.push(mode);
		},
		setKeep(keep: boolean) {
			s.keeps.push(keep);
		},
		answerPermission: () => false,
		send(text: string, o?: {command?: boolean}) {
			s.sent.push({text, command: o?.command === true});
		},
		interrupt: async () => {},
		reset() {},
		close() {
			s.closed++;
		},
		end() {
			s.ended++;
		},
		subscribe(cb: (e: ChatEvent) => void) {
			subs.add(cb);
			return () => subs.delete(cb);
		},
		emit: (e: ChatEvent) => subs.forEach(cb => cb(e)),
		...over,
	};
	return s as unknown as FakeSession;
}

export type Fake = {
	provider: ChatProvider;
	events: string[];
	admits: Origin[];
	opens: OpenRequest[];
	asks: AskRequest[];
	sessions: FakeSession[];
	opened: OpenedChat[];
	admitSendCalls: Origin[];
};

export type FakeOptions = {
	id?: string;
	label?: string;
	modes?: ChatProvider['modes'];
	admit?: (origin: Origin) => Promise<void>;
	admitSend?: ((origin: Origin) => void) | null;
	session?: Partial<ChatSession> & {sessionId?: string};
	opened?: Partial<OpenedChat>;
	open?: ChatProvider['open'];
	hints?: ProviderCommand[];
	running?: RunningState;
	stop?: (id?: string) => Promise<StopResult | undefined>;
	history?: ChatProvider['history'];
	legacy?: Awaited<ReturnType<NonNullable<ChatProvider['legacyPrefs']>>>;
	legacyThrows?: boolean;
	clearLegacy?: () => Promise<void>;
	projectDir?: string;
	lastSession?: string;
	prompts?: Awaited<ReturnType<ChatProvider['prompts']>>;
	sessionList?: Awaited<ReturnType<ChatProvider['sessions']>>;
	askImpl?: ChatProvider['ask'];
};

export function makeProvider(o: FakeOptions = {}): Fake {
	const f: Fake = {provider: undefined as unknown as ChatProvider, events: [], admits: [], opens: [], asks: [], sessions: [], opened: [], admitSendCalls: []};
	const id = o.id ?? 'fake';
	f.provider = {
		id,
		label: o.label ?? 'Fake Chat',
		modes: o.modes ?? ['default', 'plan'],
		redact: t => t,
		admit: async origin => {
			f.admits.push(origin);
			f.events.push(`admit:${origin}`);
			await o.admit?.(origin);
		},
		open:
			o.open ??
			(async req => {
				f.opens.push(req);
				f.events.push('open');
				const session = makeSession(o.session);
				f.sessions.push(session);
				const opened = {
					session,
					scrub: (t: string) => t,
					reveal: (t: string) => t,
					projectDir: o.projectDir ?? '/tmp/fake-project',
					detachedWhileRunning: () => false,
					close: () => {
						f.events.push('close');
						session.close();
					},
					flush: async () => {
						f.events.push('flush');
					},
					...(o.admitSend !== null && {
						admitSend: (origin: Origin) => {
							f.admitSendCalls.push(origin);
							o.admitSend?.(origin);
						},
					}),
					...(req.resume && {resume: req.resume}),
					...o.opened,
				} as OpenedChat;
				f.opened.push(opened);
				return opened;
			}),
		lastSession: async () => o.lastSession,
		sessions: async () => o.sessionList ?? [],
		history: o.history ?? (async () => []),
		prompts: async () => o.prompts ?? [],
		detail: async () => [],
		title: async () => undefined,
		rename: async () => {},
		projectDir: () => o.projectDir ?? '/tmp/fake-project',
		running: async () => o.running ?? {sessions: [], starting: false},
		stop: o.stop ?? (async () => undefined),
		commandHints: () => o.hints ?? [],
		describe: async () => [{label: 'Session', value: 's1'}],
		ask: async (req, env) => {
			f.asks.push(req);
			await o.askImpl?.(req, env);
		},
		validModel: m => /^[a-z0-9-]+$/.test(m),
		...(o.legacy !== undefined || o.legacyThrows
			? {
					legacyPrefs: async () => {
						if (o.legacyThrows) throw new Error('store unreadable');
						return o.legacy!;
					},
					clearLegacyPrefs: o.clearLegacy ?? (async () => {}),
				}
			: {}),
	};
	return f;
}
