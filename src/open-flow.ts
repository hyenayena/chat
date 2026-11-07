import type {BuildInfo, CommandContext, Logger, MountControl, PrintOptions, UiElement, ViewHost} from '../../../src/api.js';
import type {ChatProvider, OpenedChat, OpenEnv, OpenRequest} from './contract/provider.js';
import type {ShellFeed} from './contract/shell.js';
import {clockTime} from './clock-time.js';
import {readGitBranch} from './git-head.js';
import {noopLog} from './log.js';
import {createShellPanel} from './shell-panel.js';
import {editInEditor} from './terminal.js';
import type {ChatUiHelpers, ChatViewProps, ListPickerProps, WaitingViewProps} from './public-ui.js';

export const NEEDS_MOUNT_MESSAGE = '"chat" needs an interface that can show views';
export const UI_MISSING_MESSAGE = 'The chat interface dependencies (ink, react) are not installed in the yena host. Run "./yena install".';
const HISTORY_MESSAGES = 40;

export type ChatUi = ChatUiHelpers & {
	createChatElement: (props: ChatViewProps) => UiElement;
	createPickerElement: (props: ListPickerProps) => UiElement;
	createShellElement: (feed: ShellFeed, host?: ViewHost) => UiElement;
	createWaitingElement: (props: WaitingViewProps) => UiElement;
};

export type FlowRequest = OpenRequest & {send?: string};

export type FlowDeps = {
	log?: Logger;
	build?: BuildInfo;
	inputMode?: () => 'normal' | 'vim';
	onOpened?: (opened: OpenedChat) => void;
	onMount?: (close: () => void) => void;
	onInbox?: (deliver: ((text: string) => void) | undefined) => void;
	registerAbort?: (c: AbortController) => () => void;
	loadUi?: () => Promise<ChatUi>;
	waitPollMs?: number;
};

export const isMissingModule = (err: unknown): boolean => {
	const code = (err as {code?: unknown} | null)?.code;
	return code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND' || code === 'ERR_PACKAGE_PATH_NOT_EXPORTED';
};

export const loadChatUi = async (): Promise<ChatUi> => import('./public-ui.js');

const active = new Set<AbortController>();
let exitHookInstalled = false;

const registerExitAbort = (controller: AbortController): (() => void) => {
	active.add(controller);
	if (!exitHookInstalled) {
		exitHookInstalled = true;
		process.once('exit', () => {
			for (const c of active) c.abort();
		});
	}
	return () => {
		active.delete(controller);
	};
};

export async function loadUiChecked(load: () => Promise<ChatUi>, log: Logger): Promise<ChatUi> {
	try {
		return await load();
	} catch (err) {
		const missing = isMissingModule(err);
		log.error('chat dependencies failed to load', {missingModule: missing});
		if (missing) throw new Error(UI_MISSING_MESSAGE);
		throw err;
	}
}

export async function runChatView(provider: ChatProvider, req: FlowRequest, ctx: CommandContext, deps: FlowDeps = {}): Promise<void> {
	if (!ctx.mount) throw new Error(NEEDS_MOUNT_MESSAGE);
	const mount = ctx.mount;
	const log = deps.log ?? noopLog;
	const ui = await loadUiChecked(deps.loadUi ?? loadChatUi, log);
	const {send, ...openReq} = req;

	const env: OpenEnv = {
		print: text => ctx.print(text),
		notice: text => ctx.print(ui.formatNotice(text, s => s)),
		wait: async check => {
			let freed = false;
			await mount(control => {
				deps.onMount?.(control.close);
				return ui.createWaitingElement({
					check,
					pollMs: deps.waitPollMs ?? 1000,
					onFree: () => {
						freed = true;
						control.close();
					},
					onCancel: control.close,
					...(control.host && {host: control.host}),
				});
			});
			return freed;
		},
		...(ctx.commandBridge && {commandBridge: ctx.commandBridge}),
	};
	const opened = await provider.open(openReq, env);
	if (!opened) return;

	const {session, scrub, reveal, projectDir, resume} = opened;
	const {formatBanner, formatFileCard, assistantPrint, assistantRows, formatNotice, formatUserLine, listProjectFiles} = ui;
	const startedAt = Date.now();

	let projectFiles: readonly string[] = [];
	let filesRequested = false;
	const files = (): readonly string[] => {
		if (!filesRequested) {
			filesRequested = true;
			void listProjectFiles(projectDir).then(
				list => {
					projectFiles = list;
				},
				() => {},
			);
		}
		return projectFiles;
	};

	let chatHost: ViewHost | undefined;
	let shellPanel: ReturnType<typeof createShellPanel> | undefined;
	let unregister: (() => void) | undefined;
	let unwatchClosed: (() => void) | undefined;
	try {
		const shell = opened.shell;
		shellPanel = shell
			? createShellPanel({
					feed: shell.feed,
					mount,
					isFocused: () => chatHost?.isFocused() ?? false,
					build: (feed, control: MountControl) => ui.createShellElement(feed, control.host),
					hasTmp: shell.hasTmp,
					log,
				})
			: undefined;

		const lifetime = new AbortController();
		unregister = (deps.registerAbort ?? registerExitAbort)(lifetime);
		lifetime.signal.addEventListener('abort', () => session.close());

		deps.onOpened?.(opened);
		let printHistory: ((text: string, options?: PrintOptions) => void) | undefined;
		const mounted = mount(control => {
			printHistory = control.print ?? ctx.print;
			chatHost = control.host;
			deps.onMount?.(control.close);
			// A provider that closes its session (a stop from another yena) ends the view too.
			unwatchClosed = session.subscribe(e => {
				if (e.type === 'state' && e.state === 'closed') control.close();
			});
			return ui.createChatElement({
				controller: session,
				print: control.print ?? ctx.print,
				close: control.close,
				...(control.host && {host: control.host}),
				scrub,
				reveal,
				readBranch: () => readGitBranch(projectDir),
				projectDir,
				...(opened.pin && {pin: opened.pin}),
				...(opened.model !== undefined && {initialModel: opened.model}),
				...(opened.account !== undefined && {initialAccount: opened.account}),
				...(resume && !req.fork && {initialSessionId: resume}),
				...(req.draft && {initialDraft: req.draft}),
				...(send && {initialSend: send}),
				...(deps.onInbox && {onInbox: deps.onInbox}),
				files,
				loadTranscript: async () => {
					const id = session.sessionId;
					if (!id) return [];
					const detail = await provider.detail(id);
					return detail.map(item => {
						if (typeof item === 'string') return item;
						if (item.kind === 'text') return {render: (width: number) => assistantRows(item.text, scrub, width, {full: true})};
						return {render: (width: number) => formatFileCard(item, scrub, width, {full: true}).split('\n')};
					});
				},
				...(deps.inputMode && {inputMode: deps.inputMode}),
				...(ctx.suspend && {
					openEditor: (text: string) => ctx.suspend!(() => editInEditor(text, process.env)),
				}),
			});
		});
		if (resume && printHistory) {
			const print = printHistory;
			const earlier = await provider.history(resume, {limit: HISTORY_MESSAGES, ...(req.historyUntil && {until: req.historyUntil})}).catch(() => []);
			for (const m of earlier) {
				print(' ');
				if (m.role === 'user') {
					print(formatUserLine(m.text, scrub));
					continue;
				}
				const columns = chatHost?.columns() ?? 0;
				const block = assistantPrint(m.text, scrub, {width: columns > 1 ? columns - 1 : undefined, copyLabel: true});
				print(block.text, block.options);
			}
			if (earlier.length > 0) print(formatNotice('Resumed — earlier messages above.', scrub));
		}
		if (!resume && !opened.reattached && printHistory) {
			const banner = (columns: number): string => formatBanner({build: deps.build, model: opened.model, columns}, scrub);
			printHistory(banner(chatHost?.columns() || 80), {render: banner});
		}
		if (opened.reattached && printHistory) {
			printHistory(formatNotice(`Reattached to a session working since ${clockTime(opened.reattached.startedAt)}`, scrub));
		}
		await mounted;
	} finally {
		const sessionId = session.sessionId;
		const model = session.model;
		shellPanel?.dispose();
		unwatchClosed?.();
		try {
			opened.close();
		} finally {
			unregister?.();
			await opened.flush();
		}
		log.info('chat closed', {ms: Date.now() - startedAt, session8: sessionId?.slice(0, 8), model});
		const left = opened.detachedWhileRunning();
		ctx.print(
			scrub(
				sessionId
					? `[chat ${left ? 'left running in the background' : 'closed'} · session ${sessionId.slice(0, 8)} · model ${model ?? 'unknown'}]`
					: '[chat closed]',
			),
		);
	}
}
