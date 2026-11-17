import type {CommandContext, Logger} from '../../../src/api.js';
import {nounOf, type ChatProfile} from './contract/profile.js';
import type {ChatProvider, OpenedChat, Origin} from './contract/provider.js';
import {markUserChat, setCurrentChat} from './current.js';
import {endModuleSessions} from './module-sessions.js';
import {NEEDS_MOUNT_MESSAGE, runChatView, type FlowDeps, type FlowRequest} from './open-flow.js';
import {noopLog} from './log.js';

export const sendRefused = (noun = 'chat'): string => `The open ${noun} does not take messages from unattended runs`;
export const answering = (noun = 'chat'): string => `A ${noun} is answering; start the new one when it is done (or press Esc in it).`;
export const SEND_REFUSED = sendRefused();
export const ANSWERING = answering();

export type HeldChat = {
	provider: ChatProvider;
	origin: Origin;
	opened: OpenedChat | undefined;
	profile?: ChatProfile;
	deliver: ((text: string) => void) | undefined;
	close: () => void;
	done: Promise<void>;
};

export type ChatHubDeps = {
	log?: Logger;
	flow?: () => FlowDeps;
};

export type ReplaceOptions = {onMounted?: () => void; refuseWhileRunning?: boolean};

export type ChatHub = {
	current: HeldChat | undefined;
	mainCtx: CommandContext | undefined;
	askRunning: boolean;
	replaceChat(provider: ChatProvider, req: FlowRequest, ctx: CommandContext, options?: ReplaceOptions): Promise<void>;
};

export function createChatHub(deps: ChatHubDeps = {}): ChatHub {
	const log = deps.log ?? noopLog;

	const hub: ChatHub = {
		current: undefined,
		mainCtx: undefined,
		askRunning: false,

		replaceChat: async (provider, req, ctx, options = {}) => {
			if (!ctx.mount) throw new Error(NEEDS_MOUNT_MESSAGE);
			if (hub.askRunning) throw new Error('An ask is already running');
			const unmark = markUserChat();
			try {
				await provider.admit(req.origin);
				await endModuleSessions('replaced', t => ctx.print(t));
				const previous = hub.current;
				if (options.refuseWhileRunning && previous?.opened?.session.state === 'running') throw new Error(answering(nounOf(previous.profile)));
				if (req.attach !== true && previous?.opened?.session.state === 'idle') previous.opened.session.end?.();
				if (previous) {
					previous.close();
					await previous.done.catch(() => {});
				}

				let close: (() => void) | undefined;
				let closeRequested = false;
				const held: HeldChat = {
					provider,
					origin: req.origin,
					opened: undefined,
					...(req.profile && {profile: req.profile}),
					deliver: undefined,
					close: () => {
						closeRequested = true;
						close?.();
					},
					done: Promise.resolve(),
				};
				const base = deps.flow?.() ?? {};
				held.done = runChatView(provider, req, ctx, {
					...base,
					onOpened: opened => {
						held.opened = opened;
						setCurrentChat({providerId: provider.id, origin: req.origin, session: opened.session});
						base.onOpened?.(opened);
					},
					onMount: c => {
						close = c;
						options.onMounted?.();
						if (closeRequested) queueMicrotask(c);
					},
					onInbox: deliver => {
						held.deliver = deliver;
					},
				});
				hub.current = held;
				try {
					await held.done;
				} finally {
					if (hub.current === held) {
						hub.current = undefined;
						setCurrentChat(undefined);
					}
					log.debug('chat view ended', {provider: provider.id});
				}
			} finally {
				unmark();
			}
		},
	};
	return hub;
}
