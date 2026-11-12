import React, {useSyncExternalStore} from 'react';
import {Box} from 'ink';
import type {ViewHost} from '../../../../src/api.js';
import {AgentPanel} from './AgentPanel.js';
import type {AgentStore} from './agent-store.js';
import {headerLayout} from './chat-layout.js';
import {useViewHost, useTerminalSize} from './kit.js';
import {PlanWidget} from './PlanWidget.js';
import type {PlanView} from './plan-widget.js';
import type {Scrub} from './tool-args.js';
import type {Store} from './store.js';

export type ChatHeaderProps = {plan: Store<PlanView>; agents: AgentStore; host?: ViewHost; scrub: Scrub; rows?: number};

export function ChatHeader({plan, agents, host, scrub, rows}: ChatHeaderProps) {
	const view = useSyncExternalStore(plan.subscribe, plan.get);
	const state = useSyncExternalStore(agents.subscribe, agents.get);
	const {columns} = useViewHost(host);
	const terminal = useTerminalSize();
	const total = rows ?? terminal.rows;
	const layout = headerLayout(view, state, {rows: total, columns, scrub});
	if (layout.planMax === 0 && layout.panelMax === 0) return null;
	return (
		<Box flexDirection="column">
			<PlanWidget store={plan} {...(host !== undefined && {host})} scrub={scrub} rows={total} maxRows={layout.planMax} />
			<AgentPanel store={agents} {...(host !== undefined && {host})} scrub={scrub} rows={total} maxRows={layout.panelMax} />
		</Box>
	);
}
