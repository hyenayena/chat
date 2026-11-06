import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {formatReset, limitIndicator, type Clock, type RateLimitInfo} from '../../src/public.js';

const NOW = Date.UTC(2026, 9, 21, 12, 46, 0);
const at = (iso: string): number => Date.parse(iso) / 1000;
const clock = (timeZone?: string, now = NOW): Clock => ({ now: () => now, timeZone });

describe('formatReset', () => {
	it('same day in UTC', () => {
		assert.equal(formatReset(at('2026-10-21T15:00:00Z'), clock('UTC')), '15:00 UTC (in 2h 14m)');
	});
	it('next day adds the date', () => {
		assert.equal(formatReset(at('2026-10-23T15:00:00Z'), clock('UTC')), 'Oct 23, 15:00 UTC (in 2d 2h)');
	});
	it('uses the zone for the calendar day', () => {
		assert.equal(formatReset(at('2026-10-21T22:00:00Z'), clock('Etc/GMT-3')), 'Oct 22, 01:00 Etc/GMT-3 (in 9h 14m)');
		assert.equal(formatReset(at('2026-10-21T13:00:00Z'), clock('Etc/GMT-3')), '16:00 Etc/GMT-3 (in 14m)');
	});
	it('relative boundaries', () => {
		const rel = (s: number): string => formatReset(NOW / 1000 + s, clock('UTC')).replace(/^.*\(|\)$/g, '');
		assert.equal(rel(59 * 60), 'in 59m');
		assert.equal(rel(60 * 60), 'in 1h 0m');
		assert.equal(rel(24 * 3600 - 60), 'in 23h 59m');
		assert.equal(rel(24 * 3600), 'in 1d 0h');
		assert.equal(rel(30), 'in 1m');
	});
	it('past is now', () => {
		assert.equal(formatReset(at('2026-10-21T10:00:00Z'), clock('UTC')), '10:00 UTC (now)');
	});
	it('invalid zone falls back to UTC', () => {
		assert.equal(formatReset(at('2026-10-21T15:00:00Z'), clock('Not/AZone')), '15:00 UTC (in 2h 14m)');
	});
	it('defaults to the resolved zone', () => {
		assert.match(formatReset(at('2026-10-21T15:00:00Z'), clock()), /^\S.* \S+ \(in 2h 14m\)$/);
	});
});

describe('limitIndicator', () => {
	const c = clock('UTC');
	const reset = at('2026-10-21T15:00:00Z');
	it('hidden for allowed or missing', () => {
		assert.equal(limitIndicator(undefined, c), undefined);
		assert.equal(limitIndicator({ status: 'allowed', resetsAt: reset }, c), undefined);
	});
	it('warning', () => {
		assert.equal(
			limitIndicator({ status: 'allowed_warning', type: 'five_hour', utilization: 0.854, resetsAt: reset }, c),
			'5h limit 85%, resets 15:00',
		);
		assert.equal(limitIndicator({ status: 'allowed_warning', type: 'five_hour' }, c), '5h limit');
		assert.equal(limitIndicator({ status: 'allowed_warning', utilization: 50 }, c), 'usage limit 999%');
	});
	it('rejected', () => {
		assert.equal(limitIndicator({ status: 'rejected', type: 'five_hour', resetsAt: reset }, c), '5h limit reached, resets 15:00');
		assert.equal(
			limitIndicator({ status: 'rejected', type: 'five_hour', resetsAt: reset, usingOverage: true }, c),
			'5h limit reached, extra usage',
		);
		assert.equal(limitIndicator({ status: 'rejected', resetsAt: reset }, c), 'usage limit reached, resets 15:00');
		assert.equal(
			limitIndicator({ status: 'rejected', type: 'seven_day_opus', resetsAt: at('2026-10-23T09:00:00Z') }, c),
			'weekly Opus limit reached, resets Oct 23, 09:00',
		);
	});
	it('expires at the reset time', () => {
		const info: RateLimitInfo = { status: 'rejected', type: 'five_hour', resetsAt: reset };
		assert.ok(limitIndicator(info, clock('UTC', reset * 1000 - 1)));
		assert.equal(limitIndicator(info, clock('UTC', reset * 1000)), undefined);
	});
});

