import assert from 'node:assert/strict';
import {afterEach, test} from 'node:test';
import type {EventBus} from '../../../src/api.js';
import {setActivityEvents, watchChatActivity} from '../src/activity.js';
import type {ActivityReport} from '../src/kit.js';
import {makeSession} from './helpers/fake-provider.js';

const reports: ActivityReport[] = [];
const bus: EventBus = {emit: (_topic, payload) => void reports.push(payload as ActivityReport), on: () => () => {}};

afterEach(() => {
	reports.length = 0;
	setActivityEvents(undefined);
});

test('running, then ok on idle, then gone when the watch is released', () => {
	setActivityEvents(bus);
	const s = makeSession();
	const stop = watchChatActivity(s, {id: 'user', label: 'chat'});
	s.emit({type: 'state', state: 'running'});
	s.emit({type: 'state', state: 'idle'});
	stop();
	s.emit({type: 'state', state: 'running'});
	assert.deepEqual(
		reports.map(r => r.state),
		['running', 'ok', 'gone'],
	);
	assert.deepEqual(reports[0], {source: 'chat', id: 'user', label: 'chat', state: 'running', detail: 'answering'});
});

test('a closed session is gone once, an id is made valid, no bus is a no-op', () => {
	const quiet = makeSession();
	watchChatActivity(quiet, {id: 'user', label: 'chat'})();
	setActivityEvents(bus);
	const s = makeSession({state: 'running'});
	const stop = watchChatActivity(s, {id: 'module-Clan_1', label: 'chat · clan'});
	s.emit({type: 'state', state: 'closed'});
	stop();
	assert.deepEqual(
		reports.map(r => r.state),
		['running', 'gone'],
	);
	assert.match(reports[0]!.id, /^[a-z][a-z0-9._:-]{0,63}$/);
});
