import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {MAX_PLAN_ITEMS, MAX_PLAN_TEXT, parseTodos, planChanges, type PlanItem} from '../../src/public.js';

describe('parseTodos', () => {
	it('keeps well-formed items, defaults unknown statuses and drops empty ones', () => {
		assert.deepEqual(
			parseTodos({
				todos: [
					{content: 'Plan', status: 'completed', activeForm: 'Planning'},
					{content: 'x', status: 'weird'},
					{content: '  ', status: 'pending'},
					{status: 'pending'},
				],
			}),
			[{content: 'Plan', status: 'completed', activeForm: 'Planning'}, {content: 'x', status: 'pending'}],
		);
		assert.deepEqual(parseTodos(null), []);
	});
	it('clips: whitespace collapsed, controls dropped, length and count capped', () => {
		const ESC = String.fromCharCode(27);
		const [one] = parseTodos({todos: [{content: `a\n\n b${ESC}[31m ${'z'.repeat(500)}`, status: 'pending'}]});
		assert.ok(one!.content.startsWith('a b'));
		assert.ok(!one!.content.includes(ESC));
		assert.ok(Array.from(one!.content).length <= MAX_PLAN_TEXT);
		assert.equal(parseTodos({todos: Array.from({length: 80}, (_, i) => ({content: `t${i}`, status: 'pending'}))}).length, MAX_PLAN_ITEMS);
	});
});


describe('planChanges', () => {
	const item = (content: string, status: PlanItem['status'], id?: string): PlanItem => ({content, status, ...(id !== undefined && {id})});

	it('a new plan prints once; an all-done new plan prints nothing', () => {
		assert.deepEqual(planChanges([], [item('A', 'pending'), item('B', 'pending')]), [{kind: 'new', steps: 2}]);
		assert.deepEqual(planChanges([], [item('A', 'completed')]), []);
		assert.deepEqual(planChanges([], []), []);
	});
	it('a list after an all-done plan, or with no shared keys, is new', () => {
		assert.deepEqual(planChanges([item('A', 'completed')], [item('B', 'pending')]), [{kind: 'new', steps: 1}]);
		assert.deepEqual(planChanges([item('A', 'pending')], [item('C', 'pending'), item('D', 'pending')]), [{kind: 'new', steps: 2}]);
	});
	it('added steps and completions of an open plan', () => {
		const prev = [item('A', 'in_progress'), item('B', 'pending')];
		assert.deepEqual(planChanges(prev, [item('A', 'completed'), item('B', 'pending'), item('C', 'pending'), item('D', 'pending')]), [
			{kind: 'added', steps: 2},
			{kind: 'done', text: 'A'},
		]);
	});
	it('nothing for in-progress moves, edits or deletions', () => {
		const prev = [item('A', 'pending', '1'), item('B', 'pending', '2')];
		assert.deepEqual(planChanges(prev, [item('A', 'in_progress', '1'), item('B', 'pending', '2')]), []);
		assert.deepEqual(planChanges(prev, [item('A renamed', 'pending', '1'), item('B', 'pending', '2')]), []);
		assert.deepEqual(planChanges(prev, [item('A', 'pending', '1')]), []);
	});
	it('at most three done rows, then a count, and the final note', () => {
		const prev = Array.from({length: 6}, (_, i) => item(`s${i}`, 'pending', String(i)));
		const next = prev.map(i => ({...i, status: 'completed' as const}));
		assert.deepEqual(planChanges(prev, next), [
			{kind: 'done', text: 's0'},
			{kind: 'done', text: 's1'},
			{kind: 'done', text: 's2'},
			{kind: 'more-done', count: 3},
			{kind: 'finished', done: 6, total: 6},
		]);
	});
	it('the last item done ends with the finished note', () => {
		assert.deepEqual(planChanges([item('A', 'completed'), item('B', 'in_progress')], [item('A', 'completed'), item('B', 'completed')]), [
			{kind: 'done', text: 'B'},
			{kind: 'finished', done: 2, total: 2},
		]);
	});
});
