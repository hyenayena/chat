import type {Logger} from '../../../src/api.js';

export const noopLog: Logger = {
	error: () => {},
	warn: () => {},
	info: () => {},
	debug: () => {},
	child: () => noopLog,
	addRedactor: () => {},
};

export const errClass = (err: unknown): string => {
	const name = (err as {constructor?: {name?: unknown}} | null | undefined)?.constructor?.name;
	return typeof name === 'string' ? name : typeof err;
};
