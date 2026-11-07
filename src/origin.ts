import type {CommandContext} from '../../../src/api.js';
import type {Origin} from './contract/provider.js';

// A call with a signal is not the user at the keyboard; anything but the assistant (a missing caller included) is unattended.
export const originOf = (ctx: Pick<CommandContext, 'signal' | 'caller'>): Origin => {
	if (ctx.signal === undefined) return 'user';
	return ctx.caller === 'yena' ? 'assistant' : 'unattended';
};
