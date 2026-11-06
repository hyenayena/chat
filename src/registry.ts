import type {ChatProvider} from './contract/provider.js';

const ID = /^[a-z][a-z0-9-]{0,31}$/;
const LABEL_MAX = 40;

const entries: {id: string; provider: ChatProvider}[] = [];

const valid = (p: ChatProvider): boolean =>
	typeof p === 'object' &&
	p !== null &&
	typeof p.id === 'string' &&
	ID.test(p.id) &&
	typeof p.label === 'string' &&
	p.label.length > 0 &&
	p.label.length <= LABEL_MAX &&
	typeof p.open === 'function' &&
	typeof p.admit === 'function' &&
	typeof p.ask === 'function';

export function registerChatProvider(p: ChatProvider): (() => void) | undefined {
	if (!valid(p) || entries.some(e => e.id === p.id)) return undefined;
	const entry = {id: p.id, provider: p};
	entries.push(entry);
	return () => {
		const at = entries.indexOf(entry);
		if (at >= 0) entries.splice(at, 1);
	};
}

export const chatProviders = (): readonly {id: string; label: string}[] => entries.map(e => ({id: e.id, label: e.provider.label}));

export const chatProvider = (id: string): ChatProvider | undefined => entries.find(e => e.id === id)?.provider;
