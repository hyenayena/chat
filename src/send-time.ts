import type {ChatController} from './contract/events.js';
import {formatTimeContext, timeContextKey} from './contract/time-context.js';

const sentKeys = new WeakMap<object, string>();

// The hour-long key keeps the line out of most turns; it is recorded only after send returns, so a refused send is retried with it.
export function sendWithTime(
	controller: Pick<ChatController, 'send'>,
	text: string,
	opts: {command?: boolean; context?: string} = {},
	now: number = Date.now(),
): void {
	const send = (o: object) => (Object.keys(o).length > 0 ? controller.send(text, o) : controller.send(text));
	if (opts.command || text.startsWith('/')) {
		send(opts);
		return;
	}
	const key = timeContextKey(now);
	const time = sentKeys.get(controller) === key ? undefined : formatTimeContext(now);
	send({...opts, ...(time && {time})});
	sentKeys.set(controller, key);
}
