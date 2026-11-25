import assert from 'node:assert/strict';
import {test} from 'node:test';
import {sendWithTime} from '../src/send-time.js';
import {withTimeZone} from '../src/kit.js';

type Call = {text: string; opts?: {command?: boolean; context?: string; time?: string}};
const fake = (fail = false) => {
	const calls: Call[] = [];
	return {
		calls,
		fail,
		send(text: string, opts?: Call['opts']) {
			if (this.fail) throw new Error('refused');
			calls.push({text, ...(opts && {opts})});
		},
	};
};

const T0 = Date.UTC(2026, 10, 25, 7, 14);
const zoned = <T>(fn: () => T): T => withTimeZone('UTC', fn);

test('the first message carries the time line, one in the same hour does not', () =>
	zoned(() => {
		const c = fake();
		sendWithTime(c, 'a', {}, T0);
		sendWithTime(c, 'b', {}, T0 + 20 * 60000);
		assert.equal(c.calls[0]?.opts?.time, 'Current time: 2026-11-25 Wed 07:14 (UTC, UTC+00:00)');
		assert.equal(c.calls[1]?.opts, undefined);
	}));

test('a new hour, a new date or a new zone brings the line again', () => {
	const c = fake();
	zoned(() => {
		sendWithTime(c, 'a', {}, T0);
		sendWithTime(c, 'b', {}, T0 + 3600000);
		sendWithTime(c, 'c', {}, T0 + 3600000 + 24 * 3600000);
	});
	withTimeZone('Europe/Kyiv', () => sendWithTime(c, 'd', {}, T0 + 3600000 + 24 * 3600000));
	assert.deepEqual(
		c.calls.map(x => x.opts?.time !== undefined),
		[true, true, true, true],
	);
});

test('a command and a slash line never carry the line and do not record it', () =>
	zoned(() => {
		const c = fake();
		sendWithTime(c, 'x', {command: true}, T0);
		sendWithTime(c, '/clear', {}, T0);
		assert.deepEqual([...c.calls], [{text: 'x', opts: {command: true}}, {text: '/clear'}]);
		sendWithTime(c, 'a', {}, T0);
		assert.ok(c.calls[2]?.opts?.time);
	}));

test('the context travels along with the time line', () =>
	zoned(() => {
		const c = fake();
		sendWithTime(c, 'a', {context: 'ctx'}, T0);
		assert.equal(c.calls[0]?.opts?.context, 'ctx');
		assert.ok(c.calls[0]?.opts?.time);
	}));

test('a refused send leaves the line unrecorded', () =>
	zoned(() => {
		const c = fake(true);
		assert.throws(() => sendWithTime(c, 'a', {}, T0), /refused/);
		c.fail = false;
		sendWithTime(c, 'a', {}, T0);
		assert.ok(c.calls[0]?.opts?.time);
	}));

test('each controller is tracked on its own', () =>
	zoned(() => {
		const a = fake();
		const b = fake();
		sendWithTime(a, 'x', {}, T0);
		sendWithTime(b, 'x', {}, T0);
		assert.ok(a.calls[0]?.opts?.time && b.calls[0]?.opts?.time);
	}));
