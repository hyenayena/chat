export type LimitType =
	| 'five_hour'
	| 'seven_day'
	| 'seven_day_opus'
	| 'seven_day_sonnet'
	| 'seven_day_overage_included'
	| 'overage';

export type RateLimitInfo = {
	status: 'allowed' | 'allowed_warning' | 'rejected';
	resetsAt?: number;
	type?: LimitType;
	utilization?: number;
	usingOverage?: boolean;
};

export type Clock = { now: () => number; timeZone?: string };

export const systemClock: Clock = { now: () => Date.now() };

const SHORT_LABELS: Record<LimitType, string> = {
	five_hour: '5h limit',
	seven_day: 'weekly limit',
	seven_day_overage_included: 'weekly limit',
	seven_day_opus: 'weekly Opus limit',
	seven_day_sonnet: 'weekly Sonnet limit',
	overage: 'extra usage',
};

const zoneOf = (clock: Clock): string => {
	const candidate = clock.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
	try {
		new Intl.DateTimeFormat('en-GB', { timeZone: candidate });
		return candidate;
	} catch {
		return 'UTC';
	}
};

const timeText = (ms: number, zone: string): string =>
	new Intl.DateTimeFormat('en-GB', { hourCycle: 'h23', hour: '2-digit', minute: '2-digit', timeZone: zone }).format(ms);

const dayKey = (ms: number, zone: string): string =>
	new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: zone }).format(ms);

const dateText = (ms: number, zone: string): string =>
	new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: zone }).format(ms);

const clockText = (resetsAt: number, clock: Clock, zone: string): string => {
	const ms = resetsAt * 1000;
	const time = timeText(ms, zone);
	return dayKey(ms, zone) === dayKey(clock.now(), zone) ? time : `${dateText(ms, zone)}, ${time}`;
};

const relative = (resetsAt: number, clock: Clock): string => {
	const diff = resetsAt - clock.now() / 1000;
	if (diff <= 0) return 'now';
	const minutes = Math.ceil(diff / 60);
	if (minutes < 60) return `in ${minutes}m`;
	if (minutes < 1440) return `in ${Math.floor(minutes / 60)}h ${minutes % 60}m`;
	return `in ${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h`;
};

export const formatReset = (resetsAt: number, clock: Clock): string => {
	const zone = zoneOf(clock);
	return `${clockText(resetsAt, clock, zone)} ${zone} (${relative(resetsAt, clock)})`;
};

export const limitIndicator = (info: RateLimitInfo | undefined, clock: Clock): string | undefined => {
	if (!info || info.status === 'allowed') return undefined;
	if (info.resetsAt !== undefined && clock.now() >= info.resetsAt * 1000) return undefined;
	const label = info.type ? SHORT_LABELS[info.type] : 'usage limit';
	const zone = zoneOf(clock);
	const resets = info.resetsAt === undefined ? '' : `, resets ${clockText(info.resetsAt, clock, zone)}`;
	if (info.status === 'allowed_warning') {
		const pct =
			info.utilization === undefined ? '' : ` ${Math.min(999, Math.max(0, Math.round(info.utilization * 100)))}%`;
		return `${label}${pct}${resets}`;
	}
	return info.usingOverage ? `${label} reached, extra usage` : `${label} reached${resets}`;
};
