import assert from 'node:assert/strict';
import {test} from 'node:test';
import {stripStyles} from '../../src/kit.js';
import {toolHeader} from '../../src/ui/present.js';
import {runningToolRow} from '../../src/ui/tool-card.js';
import {initialTranscript, reduceTranscript} from '../../src/ui/transcript.js';

const id = (s: string) => s;
const running = (tool: Parameters<typeof runningToolRow>[0]): string => stripStyles(runningToolRow(tool, id, 200, '⠋', 0));

test('the running Agent line names the subagent and shows what it is doing', () => {
	let s = initialTranscript({model: undefined, sessionId: undefined, mode: 'default', pending: 0});
	s = reduceTranscript(s, {type: 'ui', event: {kind: 'tool-use', toolUseId: 'a1', name: 'Agent', input: {subagent_type: 'coder', description: 'Fix build'}}}).state;
	s = reduceTranscript(s, {type: 'ui', event: {kind: 'agent-activity', toolUseId: 'a1', name: 'Edit', input: {file_path: '/app/src/x.ts'}}}).state;
	s = reduceTranscript(s, {type: 'ui', event: {kind: 'agent-activity', toolUseId: 'nope', name: 'Read', input: {}}}).state;
	const tool = s.tools.get('a1')!;
	assert.equal(running(tool), '⠋ ✦ Agent coder: Fix build  → Edit /app/src/x.ts');
	s = reduceTranscript(s, {
		type: 'ui',
		event: {kind: 'agent-message', agentId: 'a1', items: [{type: 'tool-use', toolUseId: 'r', name: 'Read', input: {file_path: '/app/y.ts'}}, {type: 'text', text: 'x'}]},
	}).state;
	assert.equal(running(s.tools.get('a1')!), '⠋ ✦ Agent coder: Fix build  → Read /app/y.ts', 'agent-message moves the activity too');
	s = reduceTranscript(s, {type: 'ui', event: {kind: 'agent-message', agentId: 'a1', items: [{type: 'text', text: 'only text'}]}}).state;
	assert.equal(running(s.tools.get('a1')!), '⠋ ✦ Agent coder: Fix build  → Read /app/y.ts', 'text keeps the last tool');
	assert.equal(toolHeader('SendMessage', {to: 'a1', message: 'continue'}, id), 'SendMessage(a1)');
});
