import type {EventBus} from '../../../src/api.js';
import type {ChatEvent, ChatState} from './contract/events.js';
import {reportActivity, type ActivityState} from './kit.js';

let events: EventBus | undefined;

export const setActivityEvents = (bus: EventBus | undefined): void => {
	events = bus;
};

type Watched = {state: ChatState; subscribe(listener: (event: ChatEvent) => void): () => void};

const idPart = (id: string): string => id.toLowerCase().replace(/[^a-z0-9._:-]/g, '-').replace(/^[^a-z]+/, 'x').slice(0, 56);

export function watchChatActivity(session: Watched, item: {id: string; label: string}): () => void {
	const id = idPart(item.id);
	let last: ActivityState | undefined;
	const report = (state: ActivityState): void => {
		last = state;
		reportActivity(events, {source: 'chat', id, label: item.label, state, ...(state === 'running' && {detail: 'answering'})});
	};
	if (session.state === 'running') report('running');
	const unsubscribe = session.subscribe(e => {
		if (e.type !== 'state' || last === 'gone') return;
		if (e.state === 'running') report('running');
		else if (e.state === 'idle' && last === 'running') report('ok');
		else if (e.state === 'closed') report('gone');
	});
	return () => {
		unsubscribe();
		if (last !== 'gone') report('gone');
	};
}
