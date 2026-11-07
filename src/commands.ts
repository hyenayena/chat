import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import type {ArgumentDoc, Command, CommandContext, DevFailure, Logger, SettingsTab, SpanTone, StyledSpan, Subcommand} from '../../../src/api.js';
import {line, printStyled, span} from './kit.js';
import {isInteractive, type ChatProvider, type OpenedChat, type Origin, type ProviderCommand, type RunningInfo} from './contract/provider.js';
import {makeScrub} from './contract/scrub.js';
import {usageLines} from './contract/usage.js';
import {clockTime} from './clock-time.js';
import {createFixCommand} from './fix.js';
import {createChatHub, SEND_REFUSED, type ChatHub, type HeldChat} from './hub.js';
import {errClass, noopLog} from './log.js';
import {originOf} from './origin.js';
import {createPrefs, type Prefs} from './prefs.js';
import {chatProvider, chatProviders} from './registry.js';
import {chatTab} from './settings.js';
import {loadChatUi, type ChatUi, type FlowDeps} from './open-flow.js';
import {ago} from './ui/picker-model.js';
import type {PickerItem} from './ui/picker-model.js';

export type ChatCommandDeps = {
	dataDir: string;
	log?: Logger;
	devFailure?: () => Promise<DevFailure | undefined>;
	flow?: Omit<FlowDeps, 'onOpened' | 'onMount' | 'onInbox' | 'inputMode'>;
};

const START_MAX = 20_000;
const NEW_USAGE = 'Usage: chat new [--provider <id>] [model]';
const START_USAGE = 'Usage: chat start [--provider <id>] <message…>';
const SEND_USAGE = 'Usage: chat send <message…>';
const ASK_USAGE = 'Usage: chat ask [--new] <text…>';
const RESUME_USAGE = 'Usage: chat resume [session]';
const STOP_USAGE = 'Usage: chat stop [session]';
const MCP_USAGE = 'Usage: chat mcp [reconnect <server>]';
const NO_CHAT = 'No chat is open; start one with "chat".';
const COMMAND_NAME = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,63}$/;

const SLOT_WORD = /^(?:<([A-Za-z0-9_][\w-]*)(?:…|\.\.\.)?>|\[([A-Za-z0-9_][\w-]*)(?:…|\.\.\.)?\])(?:…|\.\.\.)?$/u;

const passthroughUsage = (name: string, hint: string | undefined, label: string): Pick<Subcommand, 'usage' | 'args'> => {
	const words = (hint ?? '').trim().split(/\s+/u).filter(w => w !== '');
	const slots = words.map(w => {
		const m = SLOT_WORD.exec(w);
		return m?.[1] ?? m?.[2];
	});
	if (slots.every((s): s is string => s !== undefined)) {
		return {
			usage: ['chat', name, ...words].join(' '),
			args: [...new Set(slots)].map(s => ({name: s, description: `Argument of the ${label} command`})),
		};
	}
	return {
		usage: `chat ${name} [args…]`,
		args: [{name: 'args', description: `Arguments, as ${label} describes them: ${Array.from(words.join(' ')).slice(0, 80).join('')}`}],
	};
};

const passthroughDescription = (text: string | undefined, label: string): string => {
	const clean = (text ?? '').replace(/\s+/gu, ' ').trim().replace(/\.+$/u, '');
	if (clean === '') return `${label} command (runs in the open chat)`;
	const chars = Array.from(`${label}: ${clean}`);
	return chars.length <= 90 ? chars.join('') : `${chars.slice(0, 89).join('')}…`;
};

const plain = makeScrub(s => s);

const SESSION_ARG = (what: string): ArgumentDoc => ({name: 'session', description: `Session id or a prefix of it; ${what}`});
const MESSAGE_ARG: ArgumentDoc = {name: 'message', description: 'Text of the message'};
const PROVIDER_OPTION = {name: '--provider', value: '<id>', description: 'Chat provider to use (default: the one in the Chat settings)'};

const OWN_SUBCOMMANDS: Subcommand[] = [
	{
		name: 'new',
		usage: 'chat new [--provider <id>] [model]',
		description: 'Start a new chat',
		agent: 'deny',
		args: [{name: 'model', description: 'Model of the chat (default: the one in the provider settings)'}],
		options: [PROVIDER_OPTION],
	},
	{name: 'continue', usage: 'chat continue', description: 'Open a chat in the last session', agent: 'deny'},
	{
		name: 'start',
		usage: 'chat start [--provider <id>] <message…>',
		description: 'Start a new chat and send it the message',
		agent: 'confirm',
		args: [MESSAGE_ARG],
		options: [PROVIDER_OPTION],
		notes: ['The open chat is saved and can be resumed.'],
	},
	{
		name: 'send',
		usage: 'chat send <message…>',
		description: 'Send the message to the open chat, or start one',
		agent: 'confirm',
		args: [MESSAGE_ARG],
		notes: ['While the chat answers, the message goes into the running answer.'],
	},
	{
		name: 'ask',
		usage: 'chat ask [--new] <text…>',
		description: 'Ask yena a question in the last session',
		agent: 'deny',
		args: [{name: 'text', description: 'The question; put "--" before text that starts with "--"'}],
		options: [{name: '--new', description: 'Ask in a new session'}],
	},
	{
		name: 'resume',
		usage: 'chat resume [session]',
		description: 'Continue an earlier chat',
		agent: 'deny',
		args: [SESSION_ARG('without it, pick from a list')],
	},
	{name: 'rewind', usage: 'chat rewind', description: 'Go back to before one of your messages (files and conversation)', agent: 'deny'},
	{name: 'fork', usage: 'chat fork', description: 'Continue the current chat on a new branch', agent: 'deny'},
	{
		name: 'rename',
		usage: 'chat rename <name…>',
		description: 'Name the current chat',
		agent: 'confirm',
		args: [{name: 'name', description: 'New name of the chat'}],
	},
	{
		name: 'export',
		usage: 'chat export [file]',
		description: 'Save the current chat as Markdown',
		agent: 'confirm',
		args: [{name: 'file', description: 'Target file in the project (default: a new file in the exports folder)'}],
	},
	{
		name: 'copy',
		usage: 'chat copy [n]',
		description: "Copy yena's last answer to the clipboard",
		agent: 'deny',
		args: [{name: 'n', description: 'Which answer, counted from the end (default: 1, the last)'}],
	},
	{name: 'tasks', usage: 'chat tasks', description: 'Background tasks and subagents of the chat; pick one to stop it', agent: 'safe'},
	{
		name: 'mcp',
		usage: 'chat mcp [subcommand]',
		description: 'MCP servers of the chat and their status',
		agent: 'safe',
		args: [{name: 'subcommand', description: 'reconnect <server>, or nothing to list the servers'}],
		subcommands: [
			{
				name: 'reconnect',
				usage: 'chat mcp reconnect <server>',
				description: 'Reconnect an MCP server of the chat',
				args: [{name: 'server', description: 'Server name, as "chat mcp" lists it'}],
			},
		],
	},
	{name: 'session', usage: 'chat session', description: 'Show the current session, model and runtime', agent: 'safe'},
	{name: 'sessions', usage: 'chat sessions', description: 'Show the running chat or ask, in any yena or in the background', agent: 'safe'},
	{
		name: 'stop',
		usage: 'chat stop [session]',
		description: 'Stop the running chat or ask',
		agent: 'confirm',
		args: [SESSION_ARG('stops only when the running one matches')],
	},
];
const OWN_NAMES = new Set([...OWN_SUBCOMMANDS.map(s => s.name), 'help']);

export function createChatCommands(deps: ChatCommandDeps): Command[] {
	const log = deps.log ?? noopLog;
	const prefs: Prefs = createPrefs({dataDir: deps.dataDir, log});
	const hub: ChatHub = createChatHub({
		log,
		flow: () => ({...deps.flow, log, inputMode: () => (prefs.cached().inputMode === 'vim' ? 'vim' : 'normal')}),
	});

	const openSession = (): OpenedChat | undefined => {
		const opened = hub.current?.opened;
		return opened && opened.session.state !== 'closed' ? opened : undefined;
	};

	const providerById = (id: string): ChatProvider => {
		const found = chatProvider(id);
		if (found) return found;
		const installed = chatProviders().map(p => p.id).join(', ') || 'none';
		throw new Error(`Unknown chat provider "${plain(id).slice(0, 32)}". Installed: ${installed}`);
	};

	const defaultProvider = async (): Promise<ChatProvider> => {
		await prefs.load();
		return prefs.defaultProvider();
	};

	const activeProvider = async (): Promise<ChatProvider> => (openSession() ? hub.current!.provider : defaultProvider());

	const requested = async (id: string | undefined): Promise<ChatProvider> => (id !== undefined ? providerById(id) : defaultProvider());

	const takeProvider = (args: string[]): {id: string | undefined; rest: string[]} => {
		if (args[0] !== '--provider') return {id: undefined, rest: args};
		const id = args[1];
		if (id === undefined || id.startsWith('--')) throw new Error('"--provider" needs a provider id');
		return {id, rest: args.slice(2)};
	};

	const prefsFor = async (provider: ChatProvider): Promise<{mode?: (typeof provider.modes)[number]; keep: boolean}> => {
		const saved = await prefs.load();
		const mode = saved.permissionMode;
		return {...(mode && provider.modes.includes(mode) && {mode}), keep: saved.keepRunning === true};
	};

	const remember = (ctx: CommandContext): void => {
		if (!ctx.signal) hub.mainCtx = ctx;
	};

	const gateSend = (held: HeldChat, origin: Origin): void => {
		if (isInteractive(origin)) return;
		const admit = held.opened?.admitSend;
		if (typeof admit !== 'function') throw new Error(SEND_REFUSED);
		admit.call(held.opened, origin);
	};

	const newChat = async (args: string[], ctx: CommandContext, attach: boolean): Promise<void> => {
		remember(ctx);
		const {id, rest} = takeProvider(args);
		if (rest.length > 1) throw new Error(NEW_USAGE);
		const provider = await requested(id);
		const model = rest[0];
		if (model !== undefined && !provider.validModel(model)) throw new Error(`Invalid model "${plain(model).slice(0, 100)}". ${NEW_USAGE}`);
		await hub.replaceChat(provider, {origin: originOf(ctx), fresh: true, attach, ...(model !== undefined && {model}), ...(await prefsFor(provider))}, ctx);
	};

	const continueChat = async (args: string[], ctx: CommandContext): Promise<void> => {
		if (args.length > 0) throw new Error('Usage: chat continue');
		remember(ctx);
		const provider = await activeProvider();
		await hub.replaceChat(provider, {origin: originOf(ctx), fresh: false, attach: true, ...(await prefsFor(provider))}, ctx);
	};

	const startWith = async (text: string, ctx: CommandContext, providerId: string | undefined): Promise<void> => {
		if (text.length > START_MAX) throw new Error(`The message is longer than ${START_MAX} characters`);
		const origin = originOf(ctx);
		const provider = await requested(providerId);
		const view = ctx.signal ? hub.mainCtx : ctx;
		if (!view?.mount) throw new Error('No chat view is available; open the chat once with "chat".');
		let opened!: () => void;
		const up = new Promise<void>(resolve => {
			opened = resolve;
		});
		const running = hub.replaceChat(provider, {origin, fresh: true, send: text, ...(await prefsFor(provider))}, view, {onMounted: opened, refuseWhileRunning: true});
		running.catch(err => log.warn('started chat failed', {errClass: errClass(err)}));
		await Promise.race([up, running]);
		log.info('chat started with a message', {chars: text.length, byCaller: ctx.signal !== undefined, apiKeyOnly: !isInteractive(origin)});
		ctx.print('Started a new chat with the message.');
	};

	const startChat = async (args: string[], ctx: CommandContext): Promise<void> => {
		const {id, rest} = takeProvider(args);
		const text = rest.join(' ').trim();
		if (text === '') throw new Error(START_USAGE);
		return startWith(text, ctx, id);
	};

	const sendToChat = async (args: string[], ctx: CommandContext): Promise<void> => {
		const text = args.join(' ').trim();
		if (text === '') throw new Error(SEND_USAGE);
		if (text.length > START_MAX) throw new Error(`The message is longer than ${START_MAX} characters`);
		const held = hub.current;
		const deliver = held?.deliver;
		if (!held || !deliver) return startWith(text, ctx, undefined);
		gateSend(held, originOf(ctx));
		deliver(text);
		log.info('message sent to the open chat', {chars: text.length, byCaller: ctx.signal !== undefined});
		ctx.print('Sent the message to the open chat.');
	};

	const pick = async (ctx: CommandContext, what: {title: string; empty: string; action: string; items: PickerItem[]}): Promise<string | undefined> => {
		if (!ctx.mount) throw new Error('This command needs an interface that can show views');
		const ui: ChatUi = await (deps.flow?.loadUi ?? loadChatUi)();
		let picked: string | undefined;
		await ctx.mount(
			control =>
				ui.createPickerElement({
					...what,
					scrub: plain,
					onPick: id => {
						picked = id;
					},
					close: control.close,
					...(control.host && {host: control.host}),
				}),
			{target: 'panel'},
		);
		return picked;
	};

	const currentSessionId = async (provider: ChatProvider): Promise<string | undefined> => openSession()?.session.sessionId ?? (await provider.lastSession());

	const resumeChat = async (args: string[], ctx: CommandContext): Promise<void> => {
		if (args.length > 1) throw new Error(RESUME_USAGE);
		remember(ctx);
		const provider = await activeProvider();
		const sessions = await provider.sessions();
		const start = async (sessionId: string): Promise<void> => {
			log.info('chat resume requested', {session8: sessionId.slice(0, 8)});
			await hub.replaceChat(provider, {origin: originOf(ctx), fresh: false, resume: sessionId, ...(await prefsFor(provider))}, ctx);
		};
		const wanted = args[0];
		if (wanted !== undefined) {
			const matches = sessions.filter(s => s.sessionId.startsWith(wanted.toLowerCase()));
			if (matches.length === 0) throw new Error(`No earlier chat matches "${plain(wanted).slice(0, 40)}". ${RESUME_USAGE}`);
			if (matches.length > 1) throw new Error(`"${wanted}" matches ${matches.length} chats; type more of the id.`);
			return start(matches[0]!.sessionId);
		}
		const now = Date.now();
		const picked = await pick(ctx, {
			title: 'Resume a chat',
			empty: 'No earlier chats in this project',
			action: 'resume',
			items: sessions.map(x => ({id: x.sessionId, label: x.title, meta: `${ago(x.modified, now)} · ${x.prompts} msg`})),
		});
		if (picked) await start(picked);
	};

	const forkChat = async (args: string[], ctx: CommandContext): Promise<void> => {
		if (args.length > 0) throw new Error('Usage: chat fork');
		remember(ctx);
		const provider = await activeProvider();
		const id = await currentSessionId(provider);
		if (!id) throw new Error('There is no chat to fork yet; send a message first.');
		log.info('chat fork requested', {session8: id.slice(0, 8)});
		await hub.replaceChat(provider, {origin: originOf(ctx), fresh: false, resume: id, fork: true, ...(await prefsFor(provider))}, ctx);
	};

	const rewindChat = async (args: string[], ctx: CommandContext): Promise<void> => {
		if (args.length > 0) throw new Error('Usage: chat rewind');
		remember(ctx);
		const opened = openSession();
		const id = opened?.session.sessionId;
		if (!opened || !id) throw new Error('There is no open chat to rewind yet.');
		const provider = hub.current!.provider;
		if (opened.session.state === 'running') throw new Error('yena is still answering; wait or press Esc in the chat.');
		const prompts = (await provider.prompts(id)).reverse();
		const picked = await pick(ctx, {
			title: 'Rewind to before…',
			empty: 'Nothing to rewind to yet',
			action: 'rewind',
			items: prompts.map((p, i) => ({id: p.uuid, label: p.text, meta: i === 0 ? 'latest' : `${i + 1} back`})),
		});
		const target = prompts.find(p => p.uuid === picked);
		if (!target) return;
		const rewindFiles = opened.session.rewindFiles?.bind(opened.session);
		const files = rewindFiles
			? await rewindFiles(target.uuid).catch((err: unknown) => ({canRewind: false, error: err instanceof Error ? err.message : String(err)}))
			: {canRewind: false, error: 'this chat cannot restore files'};
		ctx.print(
			files.canRewind
				? `Rewound: files restored${'filesChanged' in files && files.filesChanged ? ` (${files.filesChanged.length} changed)` : ''}`
				: `Rewound the conversation; files were not restored: ${plain(files.error ?? 'unknown reason').slice(0, 200)}`,
		);
		log.info('chat rewind', {session8: id.slice(0, 8), files: files.canRewind});
		const origin = originOf(ctx);
		const prefsNow = await prefsFor(provider);
		if (target.parentUuid === null) await hub.replaceChat(provider, {origin, fresh: true, draft: target.text, ...prefsNow}, ctx);
		else {
			await hub.replaceChat(
				provider,
				{origin, fresh: false, resume: id, fork: true, resumeAt: target.parentUuid, historyUntil: target.uuid, draft: target.text, ...prefsNow},
				ctx,
			);
		}
	};

	const renameChat = async (args: string[], ctx: CommandContext): Promise<void> => {
		const name = args.join(' ').trim();
		if (!name || name.length > 120 || /[\u0000-\u001f\u007f]/.test(name)) throw new Error('Usage: chat rename <name…> (up to 120 characters)');
		const provider = await activeProvider();
		const id = await currentSessionId(provider);
		if (!id) throw new Error('There is no chat to rename yet; send a message first.');
		await provider.rename(id, name);
		ctx.print(`Renamed the chat to "${name}"`);
	};

	const exportChat = async (args: string[], ctx: CommandContext): Promise<void> => {
		if (args.length > 1) throw new Error('Usage: chat export [file]');
		const provider = await activeProvider();
		const id = await currentSessionId(provider);
		if (!id) throw new Error('There is no chat to export yet.');
		const projectDir = provider.projectDir();
		const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
		const target = args[0] ? path.resolve(projectDir, args[0]) : path.join(deps.dataDir, 'exports', `${stamp}-${id.slice(0, 8)}.md`);
		const inside = [projectDir, deps.dataDir].some(root => target.startsWith(path.resolve(root) + path.sep));
		if (!inside) throw new Error('Export files go inside the project or the chat data directory');
		const messages = await provider.history(id, {limit: Number.MAX_SAFE_INTEGER});
		if (messages.length === 0) throw new Error('The chat has no messages to export yet.');
		const title = (await provider.title(id)) ?? 'Chat';
		const body = [`# ${title}`, '', `Session \`${id}\`, exported ${new Date().toISOString()}.`, ''];
		for (const m of messages) body.push(m.role === 'user' ? '## You' : '## yena', '', m.text, '');
		await mkdir(path.dirname(target), {recursive: true});
		await writeFile(target, body.join('\n'), {flag: 'wx'}).catch((err: unknown) => {
			if ((err as {code?: unknown}).code === 'EEXIST') throw new Error(`"${target}" already exists`);
			throw err;
		});
		ctx.print(`Exported ${messages.length} messages to ${target}`);
	};

	const copyAnswer = async (args: string[], ctx: CommandContext): Promise<void> => {
		const n = args[0] === undefined ? 1 : Number(args[0]);
		if (args.length > 1 || !Number.isInteger(n) || n < 1) throw new Error('Usage: chat copy [n]');
		if (!ctx.copyToClipboard) throw new Error('This interface cannot reach the clipboard');
		const provider = await activeProvider();
		const id = await currentSessionId(provider);
		if (!id) throw new Error('There is no answer to copy yet.');
		const answers = (await provider.history(id, {limit: Number.MAX_SAFE_INTEGER})).filter(m => m.role === 'assistant');
		const answer = answers.at(-n);
		if (!answer) throw new Error(n === 1 ? 'There is no answer to copy yet.' : `There are only ${answers.length} answers.`);
		if (!ctx.copyToClipboard(answer.text)) throw new Error('The answer is too long for the terminal clipboard');
		ctx.print(`Copied ${n === 1 ? 'the last answer' : `answer ${n} back`} (${answer.text.length} characters)`);
	};

	const tasksCmd = async (args: string[], ctx: CommandContext): Promise<void> => {
		if (args.length > 0) throw new Error('Usage: chat tasks');
		const session = openSession()?.session;
		if (!session) throw new Error(NO_CHAT);
		if (session.tasks === undefined || typeof session.stopTask !== 'function') {
			ctx.print('The open chat has no tasks');
			return;
		}
		const now = Date.now();
		const tasks = [...session.tasks].sort((a, b) => Number(b.status === 'running') - Number(a.status === 'running'));
		const picked = await pick(ctx, {
			title: 'Tasks (Enter stops a running one)',
			empty: 'No tasks in this chat yet',
			action: 'stop',
			items: tasks.map(t => ({
				id: t.id,
				label: t.description,
				meta: `${t.status}${t.background ? ' · background' : ''} · ${ago(t.startedAt, now)}`,
			})),
		});
		const task = tasks.find(t => t.id === picked);
		if (!task) return;
		if (task.status !== 'running') {
			ctx.print(`That task already ${task.status}${task.summary ? `: ${plain(task.summary).slice(0, 200)}` : ''}`);
			return;
		}
		await session.stopTask(task.id);
		ctx.print(`Stopping "${plain(task.description).slice(0, 80)}"`);
	};

	const mcpCmd = async (args: string[], ctx: CommandContext): Promise<void> => {
		const session = openSession()?.session;
		if (args[0] === 'reconnect') {
			if (args.length !== 2) throw new Error(MCP_USAGE);
			if (!session) throw new Error(NO_CHAT);
			if (typeof session.reconnectMcp !== 'function') {
				ctx.print('The open chat has no MCP servers');
				return;
			}
			await session.reconnectMcp(args[1]!);
			ctx.print(`Reconnected ${plain(args[1]!)}`);
			return;
		}
		if (args.length > 0) throw new Error(MCP_USAGE);
		if (session && typeof session.mcpStatus !== 'function') {
			ctx.print('The open chat has no MCP servers');
			return;
		}
		const status = session ? await session.mcpStatus!().catch(() => undefined) : undefined;
		if (!status) {
			ctx.print('MCP servers connect when a chat sends its first message; send one and run "chat mcp" again.');
			return;
		}
		if (status.length === 0) {
			ctx.print('No MCP servers are configured for this chat.');
			return;
		}
		for (const s of status) ctx.print(`${plain(s.name)}: ${plain(s.status)}${s.error ? ` (${plain(s.error).slice(0, 120)})` : ''}`);
	};

	const sessionCmd = async (args: string[], ctx: CommandContext): Promise<void> => {
		if (args.length > 0) throw new Error('Usage: chat session');
		const provider = await activeProvider();
		const session = openSession()?.session;
		ctx.print(`Provider: ${plain(provider.label)}`);
		for (const row of await provider.describe(session)) ctx.print(`${row.label}: ${row.value}`);
		if (session?.usage) {
			ctx.print('Tokens in this chat (since it opened):');
			for (const l of usageLines(session.usage)) ctx.print(`  ${l}`);
		}
	};

	const sessionsCmd = async (args: string[], ctx: CommandContext): Promise<void> => {
		if (args.length > 0) throw new Error('Usage: chat sessions');
		let starting = false;
		let shown = 0;
		for (const entry of chatProviders()) {
			const state = await chatProvider(entry.id)!.running();
			starting ||= state.starting;
			for (const info of state.sessions) {
				printStyled(ctx, [runningLine(info)]);
				shown++;
			}
		}
		if (shown === 0) ctx.print(starting ? 'A session is starting.' : 'No session is running.');
	};

	const stopCmd = async (args: string[], ctx: CommandContext): Promise<void> => {
		if (args.length > 1) throw new Error(STOP_USAGE);
		let failure: unknown;
		for (const entry of chatProviders()) {
			try {
				const result = await chatProvider(entry.id)!.stop(args[0]);
				if (result) {
					ctx.print(`Stopped the ${result.kind} (${result.via === 'socket' ? 'asked to stop' : 'process ended'}).`);
					return;
				}
			} catch (err) {
				failure ??= err;
			}
		}
		if (failure) throw failure;
		ctx.print('No session is running.');
	};

	const passthroughHints = (): {label: string; hints: readonly ProviderCommand[]} => {
		const open = openSession();
		let provider: ChatProvider | undefined = open ? hub.current!.provider : undefined;
		if (!provider) {
			try {
				provider = prefs.defaultProvider();
			} catch {
				return {label: 'Chat', hints: []};
			}
		}
		const known = open?.session.commands;
		return {label: provider.label, hints: known && known.length > 0 ? known : provider.commandHints()};
	};

	const passthroughSubcommands = (): Subcommand[] => {
		const {label, hints} = passthroughHints();
		return hints
			.filter(c => COMMAND_NAME.test(c.name) && !OWN_NAMES.has(c.name))
			.map(c => ({name: c.name, description: passthroughDescription(c.description, label), ...passthroughUsage(c.name, c.argumentHint, label)}));
	};

	const runPassthrough = async (name: string, args: string[], ctx: CommandContext): Promise<void> => {
		if (!COMMAND_NAME.test(name)) throw new Error(`Unknown subcommand "${plain(name).slice(0, 64)}". See "chat help"`);
		const held = hub.current;
		const session = openSession()?.session;
		if (!held || !session) throw new Error(NO_CHAT);
		const known = session.commands ?? [];
		if (known.length > 0 && !known.some(c => c.name === name)) {
			throw new Error(`Unknown command "${name}" of the open chat. Type "chat " in the console to see the list.`);
		}
		if (session.state === 'running') throw new Error('yena is still answering; wait or press Esc in the chat.');
		gateSend(held, originOf(ctx));
		session.send(`/${name}${args.length > 0 ? ` ${args.join(' ')}` : ''}`, {command: true});
		log.info('chat command sent', {command: name, args: args.length});
		ctx.print(`Sent /${name} to the chat`);
	};

	const askCmd = async (args: string[], ctx: CommandContext): Promise<void> => {
		let fresh = false;
		let i = 0;
		for (; i < args.length; i++) {
			const a = args[i]!;
			if (a === '--') {
				i++;
				break;
			}
			if (a === '--new') fresh = true;
			else if (a.startsWith('--')) throw new Error(`Unknown option "${a}". Use "--" before text that starts with "--". ${ASK_USAGE}`);
			else break;
		}
		const text = args.slice(i).join(' ').trim();
		if (!text) throw new Error(ASK_USAGE);
		if (text.startsWith('/')) throw new Error('Slash commands are not supported in "chat ask"');
		const provider = await defaultProvider();
		if (hub.askRunning) throw new Error('An ask is already running');
		hub.askRunning = true;
		try {
			await provider.ask({origin: originOf(ctx), text, fresh}, {print: t => ctx.print(t), ...(ctx.signal && {signal: ctx.signal})});
		} finally {
			hub.askRunning = false;
		}
	};

	const chat: Command = {
		name: 'chat',
		description: 'Chat with the assistant',
		usage: 'chat [subcommand] [args…]',
		agent: 'deny',
		autostart: true,
		args: [
			{name: 'subcommand', description: 'One of the subcommands below, or a command of the open chat; without it, a new chat opens'},
			{name: 'args', description: 'Its arguments'},
		],
		get subcommands() {
			return [...OWN_SUBCOMMANDS, ...passthroughSubcommands()];
		},
		get settings(): SettingsTab {
			return chatTab({prefs, applyMode: mode => openSession()?.session.setMode(mode), applyKeep: keep => openSession()?.session.setKeep?.(keep), log});
		},
		run: async ([sub, ...args], ctx) => {
			switch (sub) {
				case undefined:
					return newChat([], ctx, true);
				case 'new':
					return newChat(args, ctx, false);
				case 'continue':
					return continueChat(args, ctx);
				case 'start':
					return startChat(args, ctx);
				case 'send':
					return sendToChat(args, ctx);
				case 'ask':
					return askCmd(args, ctx);
				case 'resume':
					return resumeChat(args, ctx);
				case 'rewind':
					return rewindChat(args, ctx);
				case 'fork':
					return forkChat(args, ctx);
				case 'rename':
					return renameChat(args, ctx);
				case 'export':
					return exportChat(args, ctx);
				case 'copy':
					return copyAnswer(args, ctx);
				case 'tasks':
					return tasksCmd(args, ctx);
				case 'mcp':
					return mcpCmd(args, ctx);
				case 'session':
					return sessionCmd(args, ctx);
				case 'sessions':
					return sessionsCmd(args, ctx);
				case 'stop':
					return stopCmd(args, ctx);
				default:
					return runPassthrough(sub, args, ctx);
			}
		},
	};

	const fix = createFixCommand({...(deps.devFailure && {devFailure: deps.devFailure}), start: (message, ctx) => startWith(message, ctx, undefined)});
	return [chat, fix];
}

const STATE_TONE: Record<NonNullable<RunningInfo['state']>, SpanTone> = {running: 'ok', idle: 'muted', 'waiting-permission': 'warn'};

function runningLine(info: RunningInfo) {
	const parts: (StyledSpan | StyledSpan[])[] = [
		span(`${info.kind} (${info.where === 'background' ? 'background' : 'in yena'})`, {bold: true}),
		info.state ? span(info.state, {tone: STATE_TONE[info.state]}) : span('unresponsive', {tone: 'error'}),
		...(info.title ? [span(`"${info.title}"`)] : []),
		...(info.session8 ? [[span('session '), span(info.session8, {tone: 'accent'})]] : []),
		span(`since ${clockTime(info.startedAt)}`, {tone: 'muted'}),
		span(`pid ${info.pid}`, {tone: 'muted'}),
	];
	if (info.pending > 0) parts.push(span(`${info.pending} permission${info.pending === 1 ? '' : 's'} waiting`, {tone: 'warn'}));
	if (info.queued > 0) parts.push(span(`${info.queued} queued`));
	if (info.attached !== undefined) parts.push(info.attached ? span('attached', {tone: 'ok'}) : span('detached', {tone: 'muted'}));
	return line(...parts.flatMap((p, i) => [...(i > 0 ? [span(' · ', {tone: 'muted'})] : []), ...(Array.isArray(p) ? p : [p])]));
}
