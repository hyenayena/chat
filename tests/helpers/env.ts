import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterEach} from 'node:test';
import type {Command} from '../../../../src/api.js';
import {createChatCommands} from '../../src/commands.js';
import {registerChatProvider} from '../../src/public.js';
import {makeCtx} from './fake-ctx.js';
import {makeFakeLog} from './fake-log.js';
import {makeProvider, type FakeOptions} from './fake-provider.js';
import {makeUi} from './fake-ui.js';

export const cleanup: Array<() => void> = [];
export const release = (): void => {
	for (const fn of cleanup.splice(0).reverse()) fn();
};
afterEach(release);

export const tick = () => new Promise<void>(r => setTimeout(r, 40));

export function setup(opts: FakeOptions = {}, install = true) {
	const dataDir = mkdtempSync(path.join(tmpdir(), 'chat-cmd-'));
	cleanup.push(() => rmSync(dataDir, {recursive: true, force: true}));
	const fake = makeProvider(opts);
	if (install) cleanup.push(registerChatProvider(fake.provider)!);
	const fu = makeUi();
	const log = makeFakeLog();
	const commands = createChatCommands({dataDir, log, flow: {loadUi: async () => fu.ui}, devFailure: async () => undefined});
	const chat = commands.find(c => c.name === 'chat')!;
	return {dataDir, fake, fu, log, commands, chat};
}

export const run = (chat: Command, args: string[], ctx: ReturnType<typeof makeCtx>) => Promise.resolve(chat.run(args, ctx));

export async function openChat(env: ReturnType<typeof setup>, args: string[] = []) {
	const ctx = makeCtx();
	const done = run(env.chat, args, ctx);
	for (let i = 0; i < 100 && ctx.mounts === 0; i++) await new Promise<void>(r => setTimeout(r, 5));
	return {ctx, done};
}
