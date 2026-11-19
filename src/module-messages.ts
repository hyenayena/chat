import {OWNER} from './module-sessions.js';

export type ModuleMessage = {owner: string; text: string};
export type ModuleMessageResult = 'sent' | 'no-chat';

export const MODULE_MESSAGE_MAX = 20_000;

type Poster = (msg: ModuleMessage) => Promise<ModuleMessageResult>;

let poster: Poster | undefined;

export function setModulePoster(next: Poster | undefined): void {
	poster = next;
}

export async function postToChat(msg: ModuleMessage): Promise<ModuleMessageResult> {
	if (typeof msg !== 'object' || msg === null || typeof msg.owner !== 'string' || !OWNER.test(msg.owner)) throw new Error('Invalid module name');
	if (typeof msg.text !== 'string' || msg.text.trim() === '') throw new Error('The message is empty');
	if (msg.text.length > MODULE_MESSAGE_MAX) throw new Error(`The message is longer than ${MODULE_MESSAGE_MAX} characters`);
	if (!poster) throw new Error('The chat module is not loaded');
	return poster({owner: msg.owner, text: msg.text.trim()});
}
