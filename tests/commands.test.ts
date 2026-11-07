import assert from 'node:assert/strict';
import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {checkCommandDocs} from '../src/kit.js';
import {createChatCommands} from '../src/commands.js';
import {currentChat, registerChatProvider} from '../src/public.js';
import {makeCtx} from './helpers/fake-ctx.js';
import {makeProvider} from './helpers/fake-provider.js';
import {cleanup, openChat, release, run, setup, tick} from './helpers/env.js';

test('the chat command carries the policies of the plan, nested', () => {
	const {chat, commands} = setup();
	assert.equal(chat.agent, 'deny');
	assert.equal(chat.autostart, true);
	const by = Object.fromEntries(chat.subcommands!.map(s => [s.name, s.agent]));
	assert.deepEqual(by, {
		new: 'deny',
		continue: 'deny',
		start: 'confirm',
		send: 'confirm',
		ask: 'deny',
		resume: 'deny',
		rewind: 'deny',
		fork: 'deny',
		rename: 'confirm',
		export: 'confirm',
		copy: 'deny',
		tasks: 'safe',
		mcp: 'safe',
		session: 'safe',
		sessions: 'safe',
		stop: 'confirm',
	});
	const reconnect = chat.subcommands!.find(s => s.name === 'mcp')!.subcommands!.find(s => s.name === 'reconnect')!;
	assert.equal(reconnect.agent, undefined);
	assert.equal(commands.find(c => c.name === 'fix')!.agent, 'deny');
});

test('the usages are exactly the planned ones', () => {
	const {chat} = setup();
	assert.deepEqual(
		chat.subcommands!.map(s => s.usage),
		[
			'chat new [--provider <id>] [model]',
			'chat continue',
			'chat start [--provider <id>] <message…>',
			'chat send <message…>',
			'chat ask [--new] <text…>',
			'chat resume [session]',
			'chat rewind',
			'chat fork',
			'chat rename <name…>',
			'chat export [file]',
			'chat copy [n]',
			'chat tasks',
			'chat mcp [subcommand]',
			'chat session',
			'chat sessions',
			'chat stop [session]',
		],
	);
});

test('chat and fix pass the documentation check, with passthrough commands too', () => {
	const {commands} = setup({
		hints: [{name: 'compact', description: 'Clear history. Keeps a summary', argumentHint: '<focus>'}, {name: 'cost'}, {name: 'free', argumentHint: 'any text here [and more]'}],
	});
	for (const c of commands) assert.deepEqual(checkCommandDocs(c), [], c.name);
});

test('passthrough commands come from the provider hints, own names win and the label prefixes the description', () => {
	const {chat} = setup({label: 'Fake Chat', hints: [{name: 'compact', description: 'Clear history', argumentHint: '<focus>'}, {name: 'new', description: 'shadow'}, {name: 'bad name!'}]});
	const names = chat.subcommands!.map(s => s.name);
	assert.ok(names.includes('compact'));
	assert.equal(names.filter(n => n === 'new').length, 1);
	assert.ok(!names.includes('bad name!'));
	const compact = chat.subcommands!.find(s => s.name === 'compact')!;
	assert.equal(compact.description, 'Fake Chat: Clear history');
	assert.equal(compact.usage, 'chat compact <focus>');
	assert.equal(compact.agent, undefined);
});

test('a bare chat opens a new chat that attaches, with origin user and the saved prefs', async () => {
	const env = setup();
	const {ctx, done} = await openChat(env);
	assert.deepEqual(env.fake.opens, [{origin: 'user', fresh: true, attach: true, keep: false}]);
	assert.equal(env.fake.admits[0], 'user');
	assert.equal(currentChat()?.providerId, 'fake');
	ctx.closeAll();
	await done;
	assert.equal(currentChat(), undefined);
});

test('chat new takes a model, validates it and passes the provider choice', async () => {
	const env = setup();
	const other = makeProvider({id: 'other', label: 'Other'});
	cleanup.push(registerChatProvider(other.provider)!);
	const a = makeCtx();
	const done = run(env.chat, ['new', '--provider', 'other', 'model-1'], a);
	await tick();
	assert.equal(other.opens[0]?.model, 'model-1');
	assert.equal(other.opens[0]?.attach, false);
	assert.equal(env.fake.opens.length, 0);
	a.closeAll();
	await done;
	await assert.rejects(run(env.chat, ['new', 'Bad Model!'], makeCtx()), /Invalid model "Bad Model!"\. Usage: chat new \[--provider <id>\] \[model\]/);
	await assert.rejects(run(env.chat, ['new', 'a', 'b'], makeCtx()), /Usage: chat new/);
	await assert.rejects(run(env.chat, ['new', '--provider'], makeCtx()), /needs a provider id/);
	await assert.rejects(run(env.chat, ['new', '--provider', 'nope'], makeCtx()), /Unknown chat provider "nope"\. Installed: fake, other/);
});

test('without a provider the chat commands fail with a clear error and open nothing', async () => {
	const env = setup({}, false);
	await assert.rejects(run(env.chat, [], makeCtx()), /No chat provider is installed/);
	await assert.rejects(run(env.chat, ['ask', 'hi'], makeCtx()), /No chat provider is installed/);
});

test('a chat without mount throws before anything is admitted', async () => {
	const env = setup();
	await assert.rejects(run(env.chat, [], makeCtx({mount: false})), /needs an interface that can show views/);
	assert.deepEqual(env.fake.admits, []);
});

test('chat continue opens the last session through the same flow', async () => {
	const env = setup();
	const {ctx, done} = await openChat(env, ['continue']);
	assert.deepEqual(env.fake.opens[0], {origin: 'user', fresh: false, attach: true, keep: false});
	ctx.closeAll();
	await done;
	await assert.rejects(run(env.chat, ['continue', 'x'], makeCtx()), /Usage: chat continue/);
});

test('saved prefs reach the open request when the provider supports the mode', async () => {
	const env = setup({modes: ['default', 'plan']});
	writeFileSync(path.join(env.dataDir, 'prefs.json'), JSON.stringify({v: 1, permissionMode: 'plan', keepRunning: true}));
	const a = await openChat(env);
	assert.equal(env.fake.opens[0]?.mode, 'plan');
	assert.equal(env.fake.opens[0]?.keep, true);
	a.ctx.closeAll();
	await a.done;
	const env2 = setup({id: 'second', modes: ['default']});
	writeFileSync(path.join(env2.dataDir, 'prefs.json'), JSON.stringify({v: 1, permissionMode: 'auto', provider: 'second'}));
	const b = await openChat(env2);
	assert.equal(env2.fake.opens[0]?.mode, undefined);
	b.ctx.closeAll();
	await b.done;
});

test('opening another chat admits first, then closes the previous one, then opens', async () => {
	const env = setup();
	const a = await openChat(env);
	const b = await openChat(env, ['new']);
	assert.deepEqual(env.fake.events, ['admit:user', 'open', 'admit:user', 'close', 'flush', 'open']);
	b.ctx.closeAll();
	await Promise.all([a.done, b.done]);
});

test('a refused admit leaves the open chat untouched', async () => {
	let refuse = false;
	const env = setup({
		admit: async () => {
			if (refuse) throw new Error('refused');
		},
	});
	const a = await openChat(env);
	refuse = true;
	await assert.rejects(run(env.chat, ['new'], makeCtx()), /refused/);
	assert.equal(env.fake.sessions[0]!.closed, 0);
	assert.equal(currentChat()?.session, env.fake.sessions[0]);
	a.ctx.closeAll();
	await a.done;
});

test('an idle remote is ended when a new chat replaces it, but not when the new one attaches', async () => {
	const env = setup();
	const a = await openChat(env);
	const b = await openChat(env);
	assert.equal(env.fake.sessions[0]!.ended, 0);
	const c = await openChat(env, ['new']);
	assert.equal(env.fake.sessions[1]!.ended, 1);
	c.ctx.closeAll();
	await Promise.all([a.done, b.done, c.done]);
});

test('start opens a fresh chat with the message and returns while the chat stays open', async () => {
	const env = setup();
	const ctx = makeCtx();
	await run(env.chat, ['start', 'hello', 'there'], ctx);
	assert.equal(ctx.lines.at(-1), 'Started a new chat with the message.');
	assert.equal(env.fu.chats[0]?.initialSend, 'hello there');
	assert.deepEqual(env.fake.opens[0], {origin: 'user', fresh: true, keep: false});
	ctx.closeAll();
	await tick();
});

test('start checks its arguments and the length cap', async () => {
	const env = setup();
	await assert.rejects(run(env.chat, ['start'], makeCtx()), /Usage: chat start \[--provider <id>\] <message…>/);
	await assert.rejects(run(env.chat, ['start', 'x'.repeat(20_001)], makeCtx()), /longer than 20000 characters/);
	const ctx = makeCtx();
	await run(env.chat, ['start', 'x'.repeat(20_000)], ctx);
	ctx.closeAll();
	await tick();
});

test('start while the chat is answering is refused and the chat stays', async () => {
	const env = setup({session: {state: 'running'} as never});
	const a = await openChat(env);
	await assert.rejects(run(env.chat, ['start', 'again'], makeCtx()), /A chat is answering/);
	assert.equal(env.fake.sessions[0]!.closed, 0);
	a.ctx.closeAll();
	await a.done;
});

test('start from a caller mounts in the last user ctx, and needs one', async () => {
	const env = setup();
	await assert.rejects(run(env.chat, ['start', 'hi'], makeCtx({signal: true, caller: 'yena'})), /No chat view is available/);
	const user = await openChat(env);
	const caller = makeCtx({signal: true, caller: 'yena', mount: false});
	await run(env.chat, ['start', 'from the assistant'], caller);
	assert.equal(user.ctx.mounts, 2);
	assert.equal(env.fake.opens.at(-1)?.origin, 'assistant');
	user.ctx.closeAll();
	await tick();
});

test('fix starts like start with the failure prompt, and says so when nothing failed', async () => {
	const env = setup();
	const fix = env.commands.find(c => c.name === 'fix')!;
	const ctx = makeCtx();
	await run(fix, [], ctx);
	assert.match(ctx.lines.join('\n'), /Nothing to fix/);
	const commands = createChatCommands({
		dataDir: env.dataDir,
		flow: {loadUi: async () => env.fu.ui},
		devFailure: async () => ({at: 'now', devRoot: '/w/yena', name: 'Error', message: 'boom'}),
	});
	const real = commands.find(c => c.name === 'fix')!;
	const c2 = makeCtx();
	await run(real, [], c2);
	assert.equal(env.fake.opens.at(-1)?.origin, 'user');
	assert.match(env.fu.chats.at(-1)!.initialSend!, /could not start the working copy at \/w\/yena/);
	c2.closeAll();
	await tick();
});

test('ask parses its options and passes the origin of the caller', async () => {
	const env = setup();
	await run(env.chat, ['ask', 'plain', 'text'], makeCtx());
	await run(env.chat, ['ask', '--new', 'x'], makeCtx({signal: true, caller: 'yena'}));
	await run(env.chat, ['ask', '--', '--dashes'], makeCtx({signal: true}));
	assert.deepEqual(env.fake.asks, [
		{origin: 'user', text: 'plain text', fresh: false},
		{origin: 'assistant', text: 'x', fresh: true},
		{origin: 'unattended', text: '--dashes', fresh: false},
	]);
	await assert.rejects(run(env.chat, ['ask'], makeCtx()), /Usage: chat ask \[--new\] <text…>/);
	await assert.rejects(run(env.chat, ['ask', '--bad', 'x'], makeCtx()), /Unknown option "--bad"/);
	await assert.rejects(run(env.chat, ['ask', '/compact'], makeCtx()), /Slash commands are not supported in "chat ask"/);
});

test('a second concurrent ask is refused and the flag is released afterwards', async () => {
	let release!: () => void;
	const gate = new Promise<void>(r => (release = r));
	const env = setup({askImpl: () => gate});
	const first = run(env.chat, ['ask', 'one'], makeCtx());
	await tick();
	await assert.rejects(run(env.chat, ['ask', 'two'], makeCtx()), /An ask is already running/);
	release();
	await first;
	await run(env.chat, ['ask', 'three'], makeCtx());
	assert.equal(env.fake.asks.length, 2);
});

test('resume with an id continues that session, an ambiguous or unknown one fails', async () => {
	const env = setup({
		sessionList: [
			{sessionId: 'abc111', title: 'one', modified: Date.now(), prompts: 1},
			{sessionId: 'abc222', title: 'two', modified: Date.now(), prompts: 2},
			{sessionId: 'dd0000', title: 'three', modified: Date.now(), prompts: 3},
		],
	});
	await assert.rejects(run(env.chat, ['resume', 'abc'], makeCtx()), /matches 2 chats/);
	await assert.rejects(run(env.chat, ['resume', 'zzz'], makeCtx()), /No earlier chat matches "zzz"/);
	await assert.rejects(run(env.chat, ['resume', 'a', 'b'], makeCtx()), /Usage: chat resume \[session\]/);
	const a = await openChat(env, ['resume', 'dd']);
	assert.deepEqual(env.fake.opens[0], {origin: 'user', fresh: false, resume: 'dd0000', keep: false});
	a.ctx.closeAll();
	await a.done;
});

test('resume without an id opens the picker with the sessions and resumes the pick', async () => {
	const env = setup({sessionList: [{sessionId: 'abc111', title: 'one', modified: Date.now(), prompts: 4}]});
	env.fu.pick = p => p.onPick('abc111');
	const ctx = makeCtx();
	const done = run(env.chat, ['resume'], ctx);
	await tick();
	assert.equal(env.fu.pickers[0]?.title, 'Resume a chat');
	assert.match(env.fu.pickers[0]!.items[0]!.meta!, /just now · 4 msg/);
	ctx.controls[0]!.close();
	await tick();
	assert.equal(env.fake.opens[0]?.resume, 'abc111');
	ctx.closeAll();
	await done;
});

test('fork reopens the current session as a branch and does not show it as resumed', async () => {
	const env = setup();
	await assert.rejects(run(env.chat, ['fork'], makeCtx()), /There is no chat to fork yet/);
	const a = await openChat(env);
	const b = await openChat(env, ['fork']);
	assert.deepEqual(env.fake.opens[1], {origin: 'user', fresh: false, resume: 'aaaaaaaa-1111', fork: true, keep: false});
	assert.equal(env.fu.chats[1]?.initialSessionId, undefined);
	b.ctx.closeAll();
	await Promise.all([a.done, b.done]);
});

test('rewind restores files and reopens before the picked message with it as the draft', async () => {
	const prompts = [
		{uuid: 'u1', parentUuid: null, text: 'first'},
		{uuid: 'u2', parentUuid: 'a1', text: 'second'},
	];
	const rewound: string[] = [];
	const env = setup({prompts, session: {rewindFiles: async (id: string) => (rewound.push(id), {canRewind: true, filesChanged: ['a.txt']})} as never});
	await assert.rejects(run(env.chat, ['rewind'], makeCtx()), /There is no open chat to rewind yet/);
	const a = await openChat(env);
	env.fu.pick = p => p.onPick('u2');
	const ctx = makeCtx();
	const done = run(env.chat, ['rewind'], ctx);
	await tick();
	ctx.controls[0]!.close();
	await tick();
	assert.deepEqual(rewound, ['u2']);
	assert.match(ctx.lines[0]!, /Rewound: files restored \(1 changed\)/);
	assert.deepEqual(env.fake.opens[1], {origin: 'user', fresh: false, resume: 'aaaaaaaa-1111', fork: true, resumeAt: 'a1', historyUntil: 'u2', draft: 'second', keep: false});
	assert.equal(env.fu.chats[1]?.initialDraft, 'second');
	ctx.closeAll();
	await Promise.all([done, a.done]);
});

test('rewind to the first message starts fresh with the draft; a chat that cannot restore files says so', async () => {
	const env = setup({prompts: [{uuid: 'u1', parentUuid: null, text: 'first'}]});
	const a = await openChat(env);
	env.fu.pick = p => p.onPick('u1');
	const ctx = makeCtx();
	const done = run(env.chat, ['rewind'], ctx);
	await tick();
	ctx.controls[0]!.close();
	await tick();
	assert.match(ctx.lines[0]!, /Rewound the conversation; files were not restored: this chat cannot restore files/);
	assert.deepEqual(env.fake.opens[1], {origin: 'user', fresh: true, draft: 'first', keep: false});
	ctx.closeAll();
	await Promise.all([done, a.done]);
});

test('rename, export and copy work on the open chat', async () => {
	const renamed: string[] = [];
	const dir = mkdtempSync(path.join(tmpdir(), 'chat-proj-'));
	cleanup.push(() => rmSync(dir, {recursive: true, force: true}));
	const env = setup({
		projectDir: dir,
		history: async () => [
			{role: 'user', text: 'q'},
			{role: 'assistant', text: 'a1'},
			{role: 'assistant', text: 'a2'},
		],
	});
	env.fake.provider.rename = async (_id, name) => void renamed.push(name);
	const a = await openChat(env);
	const ctx = makeCtx({clipboard: true});
	await run(env.chat, ['rename', 'My', 'chat'], ctx);
	assert.deepEqual(renamed, ['My chat']);
	await assert.rejects(run(env.chat, ['rename', 'x'.repeat(121)], ctx), /Usage: chat rename <name…> \(up to 120 characters\)/);
	await assert.rejects(run(env.chat, ['rename', 'a\u0007b'], ctx), /Usage: chat rename/);
	await run(env.chat, ['export'], ctx);
	assert.ok(existsSync(path.join(env.dataDir, 'exports')));
	await run(env.chat, ['export', 'out/chat.md'], ctx);
	assert.match(readFileSync(path.join(dir, 'out/chat.md'), 'utf8'), /## You\n\nq\n\n## yena\n\na1/);
	await assert.rejects(run(env.chat, ['export', 'out/chat.md'], ctx), /already exists/);
	await assert.rejects(run(env.chat, ['export', '../escape.md'], ctx), /Export files go inside the project or the chat data directory/);
	await assert.rejects(run(env.chat, ['export', '/etc/x.md'], ctx), /Export files go inside/);
	await run(env.chat, ['copy', '2'], ctx);
	assert.deepEqual(ctx.clipboard, ['a1']);
	await assert.rejects(run(env.chat, ['copy', '9'], ctx), /There are only 2 answers/);
	await assert.rejects(run(env.chat, ['copy', '0'], ctx), /Usage: chat copy \[n\]/);
	await assert.rejects(run(env.chat, ['copy'], makeCtx()), /cannot reach the clipboard/);
	a.ctx.closeAll();
	await a.done;
});

test('tasks and mcp say so when the chat lacks the member, and need a chat otherwise', async () => {
	const env = setup();
	await assert.rejects(run(env.chat, ['tasks'], makeCtx()), /No chat is open; start one with "chat"\./);
	await assert.rejects(run(env.chat, ['mcp', 'reconnect', 's'], makeCtx()), /No chat is open/);
	const none = makeCtx();
	await run(env.chat, ['mcp'], none);
	assert.match(none.lines[0]!, /MCP servers connect when a chat sends its first message; send one and run "chat mcp" again\./);
	const a = await openChat(env);
	const ctx = makeCtx();
	await run(env.chat, ['tasks'], ctx);
	await run(env.chat, ['mcp'], ctx);
	await run(env.chat, ['mcp', 'reconnect', 's'], ctx);
	assert.deepEqual(ctx.lines, ['The open chat has no tasks', 'The open chat has no MCP servers', 'The open chat has no MCP servers']);
	a.ctx.closeAll();
	await a.done;
});

test('tasks stops the picked running task; mcp lists servers and reconnects one', async () => {
	const stopped: string[] = [];
	const reconnected: string[] = [];
	const env = setup({
		session: {
			tasks: [
				{id: 't1', status: 'completed', description: 'old', background: false, startedAt: 1},
				{id: 't2', status: 'running', description: 'build', background: true, startedAt: Date.now()},
			],
			stopTask: async (id: string) => void stopped.push(id),
			mcpStatus: async () => [
				{name: 'srv', status: 'connected'},
				{name: 'bad', status: 'failed', error: 'nope'},
			],
			reconnectMcp: async (n: string) => void reconnected.push(n),
		} as never,
	});
	const a = await openChat(env);
	env.fu.pick = p => p.onPick('t2');
	const ctx = makeCtx();
	const done = run(env.chat, ['tasks'], ctx);
	await tick();
	assert.deepEqual(
		env.fu.pickers[0]!.items.map(i => i.id),
		['t2', 't1'],
	);
	ctx.controls[0]!.close();
	await done;
	assert.deepEqual(stopped, ['t2']);
	assert.equal(ctx.lines.at(-1), 'Stopping "build"');
	const m = makeCtx();
	await run(env.chat, ['mcp'], m);
	assert.deepEqual(m.lines, ['srv: connected', 'bad: failed (nope)']);
	await run(env.chat, ['mcp', 'reconnect', 'srv'], m);
	assert.deepEqual(reconnected, ['srv']);
	await assert.rejects(run(env.chat, ['mcp', 'x'], m), /Usage: chat mcp/);
	a.ctx.closeAll();
	await a.done;
});

test('session prints the provider, its rows and the token usage of the open chat', async () => {
	const zero = {input: 0, output: 0, cacheWrite: 0, cacheRead: 0, cost: 0};
	const env = setup({session: {usage: {main: {...zero, input: 10}, agents: zero}} as never});
	const none = makeCtx();
	await run(env.chat, ['session'], none);
	assert.deepEqual(none.lines, ['Provider: Fake Chat', 'Session: s1']);
	const a = await openChat(env);
	const ctx = makeCtx();
	await run(env.chat, ['session'], ctx);
	assert.equal(ctx.lines[0], 'Provider: Fake Chat');
	assert.equal(ctx.lines[2], 'Tokens in this chat (since it opened):');
	assert.equal(ctx.lines.length, 5);
	a.ctx.closeAll();
	await a.done;
});

test('sessions prints one styled line per running session, or says none is running', async () => {
	const none = setup();
	const c0 = makeCtx();
	await run(none.chat, ['sessions'], c0);
	assert.deepEqual(c0.lines, ['No session is running.']);
	release();
	const env = setup({
		running: {starting: false, sessions: [{kind: 'chat', where: 'background', state: 'running', title: 'T', session8: 'abcd1234', startedAt: Date.now(), pid: 42, pending: 2, queued: 1, attached: false}]},
	});
	const blocks: unknown[][] = [];
	const ctx = Object.assign(makeCtx(), {printStyled: (b: unknown[]) => void blocks.push(b)});
	await run(env.chat, ['sessions'], ctx);
	const text = JSON.stringify(blocks);
	for (const part of ['chat (background)', 'running', '\\"T\\"', 'abcd1234', 'pid 42', '2 permissions waiting', '1 queued', 'detached']) assert.ok(text.includes(part), part);
	assert.ok(text.includes('"tone":"ok"'));
	release();
	const starting = setup({running: {starting: true, sessions: []}});
	const c1 = makeCtx();
	await run(starting.chat, ['sessions'], c1);
	assert.deepEqual(c1.lines, ['A session is starting.']);
});

test('stop goes to the provider that holds the session and reports the way', async () => {
	const env = setup({stop: async () => ({kind: 'chat', via: 'socket'})});
	const ctx = makeCtx();
	await run(env.chat, ['stop', 'abc'], ctx);
	assert.deepEqual(ctx.lines, ['Stopped the chat (asked to stop).']);
	release();
	const idle = setup();
	const c2 = makeCtx();
	await run(idle.chat, ['stop'], c2);
	assert.deepEqual(c2.lines, ['No session is running.']);
	await assert.rejects(run(idle.chat, ['stop', 'a', 'b'], c2), /Usage: chat stop \[session\]/);
});

test('stop tries every provider and reports a refusal only when none stopped', async () => {
	const env = setup({
		stop: async () => {
			throw new Error('no match');
		},
	});
	const second = makeProvider({id: 'second', label: 'Second', stop: async () => ({kind: 'ask', via: 'signal'})});
	cleanup.push(registerChatProvider(second.provider)!);
	const ctx = makeCtx();
	await run(env.chat, ['stop'], ctx);
	assert.deepEqual(ctx.lines, ['Stopped the ask (process ended).']);
});

test('a command of the open chat is sent to it; unknown ones, a busy chat and no chat are errors', async () => {
	const env = setup({hints: [{name: 'compact'}], session: {commands: [{name: 'compact'}, {name: 'cost'}]} as never});
	await assert.rejects(run(env.chat, ['compact'], makeCtx()), /No chat is open; start one with "chat"\./);
	const a = await openChat(env);
	const ctx = makeCtx();
	await run(env.chat, ['compact', 'now', 'please'], ctx);
	assert.deepEqual(env.fake.sessions[0]!.sent, [{text: '/compact now please', command: true}]);
	assert.equal(ctx.lines[0], 'Sent /compact to the chat');
	await assert.rejects(run(env.chat, ['nope'], ctx), /Unknown command "nope" of the open chat\. Type "chat " in the console to see the list\./);
	await assert.rejects(run(env.chat, ['bad name'], ctx), /Unknown subcommand "bad name"/);
	env.fake.sessions[0]!.state = 'running';
	await assert.rejects(run(env.chat, ['compact'], ctx), /still answering/);
	a.ctx.closeAll();
	await a.done;
});
