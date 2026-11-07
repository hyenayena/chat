import type {ChatSession, Origin} from './contract/provider.js';

export type CurrentChat = {providerId: string; origin: Origin; session: ChatSession};

let current: CurrentChat | undefined;

export const currentChat = (): CurrentChat | undefined => current;

export function setCurrentChat(chat: CurrentChat | undefined): void {
	current = chat;
}
