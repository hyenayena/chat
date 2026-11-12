import React, {useCallback, useEffect, useReducer, useRef, useState} from 'react';
import {Box, useInput, usePaste, useWindowSize, type Key} from 'ink';
import type {ViewHost} from '../../../../src/api.js';
import type {ModuleSession, PermissionDecision, PermissionRequest} from '../public.js';
import {internalsOf} from '../module-sessions.js';
import {PermissionPrompt} from './PermissionPrompt.js';
import {QuestionPrompt} from './QuestionPrompt.js';
import {newPromptEntry, promptEntryKey, promptEntryPaste, rearmEntry, type PromptEntry} from './prompt-entry.js';
import {ARM_MS, layoutPrompt, type QuestionPromptState, type ToolPromptState} from './prompt-state.js';
import {promptBudget} from './chat-layout.js';
import {useViewHost} from './kit.js';

export interface PermissionPanelProps {
	session: ModuleSession;
	request: PermissionRequest;
	host?: ViewHost;
	onDone?: () => void;
	armMs?: number;
}

// A prompt seen out of context must not save a rule for every later chat.
const withoutAlways = (request: PermissionRequest): PermissionRequest => (request.kind === 'tool' ? {...request, always: false} : request);

export function PermissionPanel(props: PermissionPanelProps) {
	const {session, host} = props;
	const internal = internalsOf(session);
	if (!internal) throw new Error('Not a module session');
	const armMs = props.armMs ?? ARM_MS;
	const terminal = useWindowSize();
	const {focused, columns} = useViewHost(host);
	const [, tick] = useReducer((n: number) => n + 1, 0);
	const [notice, setNotice] = useState<string | undefined>(undefined);
	const entryRef = useRef<PromptEntry | null>(null);
	const doneRef = useRef(false);
	const onDone = props.onDone;

	const pending = session.pendingPermissions;
	const current = pending.find(r => r.id === props.request.id);

	useEffect(() => session.subscribe(e => {
		if (e.type === 'permission-requested' || e.type === 'permission-resolved' || (e.type === 'state' && e.state === 'closed')) tick();
	}), [session]);

	useEffect(() => {
		if (current || doneRef.current) return;
		doneRef.current = true;
		onDone?.();
	});

	if (current && entryRef.current?.id !== current.id) entryRef.current = newPromptEntry(withoutAlways(current), armMs);
	const entry = current ? entryRef.current : null;
	const layout = layoutPrompt(promptBudget(terminal.rows, 0), columns);

	useEffect(() => {
		if (entry) rearmEntry(entry, layout.tier, Date.now(), armMs);
	});

	const answer = useCallback(
		(p: PromptEntry, decision: PermissionDecision, stopTurn: boolean | undefined) => {
			const others = session.pendingPermissions.filter(r => r.id !== p.id);
			internal.opened.session.answerPermission(p.id, decision);
			if (!stopTurn) return;
			for (const r of others) internal.opened.session.answerPermission(r.id, {kind: 'deny', stop: true});
			void session.interrupt();
		},
		[session, internal],
	);

	useInput(
		(input: string, key: Key) => {
			if (!entry) return;
			const res = promptEntryKey(entry, input, key, {budget: promptBudget(terminal.rows, 0), columns, reveal: internal.opened.reveal, armMs, now: Date.now()});
			setNotice(res.notice);
			if (res.decision) answer(entry, res.decision, res.stopTurn);
			tick();
		},
		{isActive: focused && entry !== null},
	);

	usePaste(
		(text: string) => {
			if (entry && promptEntryPaste(entry, text, Date.now())) tick();
		},
		{isActive: focused && entry !== null},
	);

	if (!entry) return null;
	const total = pending.length;
	const common = {layout, reveal: internal.opened.reveal, position: 1, total, ...(notice !== undefined && {notice})};
	return (
		<Box flexDirection="column">
			{entry.request.kind === 'tool' ? (
				<PermissionPrompt request={entry.request} state={entry.state as ToolPromptState} approvals={0} {...common} />
			) : (
				<QuestionPrompt request={entry.request} state={entry.state as QuestionPromptState} {...common} />
			)}
		</Box>
	);
}
