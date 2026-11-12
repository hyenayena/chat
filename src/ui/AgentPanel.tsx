import React, {useSyncExternalStore} from 'react';
import {fixedRowBudget} from '../kit.js';
import type {ViewHost} from '../../../../src/api.js';
import {layoutPanel} from './agent-panel.js';
import type {AgentStore} from './agent-store.js';
import {anyRunning} from './agents.js';
import {SPINNERS, SpanRows, useSpinnerFrame, useViewHost, useTerminalSize} from './kit.js';
import type {Scrub} from './present.js';

export type AgentPanelProps = {store: AgentStore; host?: ViewHost; scrub: Scrub; rows?: number; maxRows?: number};

export function AgentPanel({store, host, scrub, rows, maxRows}: AgentPanelProps) {
	const state = useSyncExternalStore(store.subscribe, store.get);
	const {columns} = useViewHost(host);
	const terminal = useTerminalSize();
	const active = anyRunning(state);
	const spinner = useSpinnerFrame(SPINNERS.sparkle, 120, active);
	const corner = useSpinnerFrame(SPINNERS.squareCorners, 120, active);
	const total = rows ?? terminal.rows;
	const layout = layoutPanel(state, {columns, rows: total, maxRows: maxRows ?? fixedRowBudget(total), scrub, spinner, corner});
	if (layout.height === 0) return null;
	return <SpanRows rows={layout.rows} />;
}
