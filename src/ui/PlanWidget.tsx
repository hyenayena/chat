import React, {useSyncExternalStore} from 'react';
import {Box, Text} from 'ink';
import type {ViewHost} from '../../../../src/api.js';
import {useFrameDeadline, useSpinner, useViewHost, useTerminalSize} from './kit.js';
import {PLAN, planVisible, planWidgetRows, type PlanView} from './plan-widget.js';
import type {Scrub} from './tool-args.js';
import type {Store} from './store.js';

export type PlanWidgetProps = {store: Store<PlanView>; host?: ViewHost; scrub: Scrub; rows?: number; maxRows?: number};

export function PlanWidget({store, host, scrub, rows, maxRows}: PlanWidgetProps) {
	const view = useSyncExternalStore(store.subscribe, store.get);
	const {columns} = useViewHost(host);
	const terminal = useTerminalSize();
	const animated = planVisible(view) && view.running && view.items.some(i => i.status === 'in_progress');
	const spinner = useSpinner(animated);
	useFrameDeadline(view.flash?.until);
	const lines = planWidgetRows(view, {columns, rows: rows ?? terminal.rows, maxRows: maxRows ?? PLAN.expandedMax, scrub, spinner, now: Date.now()});
	if (lines.length === 0) return null;
	return (
		<Box flexDirection="column">
			{lines.map((line, i) => (
				<Text key={i} wrap="truncate">
					{line}
				</Text>
			))}
		</Box>
	);
}
