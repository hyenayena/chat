import {currentTimeZone, formatLocalTime, zonedParts} from '../kit.js';

export const TIME_CONTEXT_PREFIX = 'Current time: ';
export const TIME_CONTEXT_MAX = 160;

const SHAPE = /^Current time: \d{4}-\d{2}-\d{2} (?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{2}:\d{2} \([A-Za-z0-9_+\-/]{1,64}, UTC[+-]\d{2}:\d{2}\)$/;

export const formatTimeContext = (ms: number, zone?: string): string => `${TIME_CONTEXT_PREFIX}${formatLocalTime(ms, zone)}`;

export function timeContextKey(ms: number, zone: string = currentTimeZone()): string {
	const p = zonedParts(ms, zone);
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${String(p.year).padStart(4, '0')}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}|${zone}`;
}

export const isTimeContext = (text: string): boolean => text.length <= TIME_CONTEXT_MAX && SHAPE.test(text);
