import type {PrintAction, PrintOptions, RenderedPrint} from '../../../../src/api.js';
import {stripStyles} from '../kit.js';

const PROBE_WIDTH = 80;

const isBlank = (row: string): boolean => stripStyles(row).trim() === '';

export function trimBlankRows(text: string, actions?: readonly PrintAction[]): RenderedPrint {
	const lines = text.split('\n');
	let start = 0;
	let end = lines.length;
	while (start < end && isBlank(lines[start]!)) start++;
	while (end > start && isBlank(lines[end - 1]!)) end--;
	const kept = start === 0 && end === lines.length ? text : lines.slice(start, end).join('\n');
	if (actions === undefined) return {text: kept};
	return {text: kept, actions: actions.filter(a => a.line >= start && a.line < end).map(a => ({...a, line: a.line - start}))};
}

const tidyRendered = (out: string | RenderedPrint): RenderedPrint => (typeof out === 'string' ? trimBlankRows(out) : trimBlankRows(out.text, out.actions));

// A block never starts or ends with a blank row: the gap between blocks is the transcript's, not the block's.
export function tidyBlock(text: string, options?: PrintOptions): {text: string; options?: PrintOptions} | undefined {
	const block = trimBlankRows(text, options?.actions);
	if (block.text === '') return undefined;
	if (options === undefined) return {text: block.text};
	const {actions: _actions, render, ...rest} = options;
	const next: PrintOptions = {...rest};
	if (block.actions !== undefined) next.actions = block.actions;
	if (render !== undefined) {
		if (tidyRendered(render(PROBE_WIDTH)).text === '') return undefined;
		next.render = width => {
			const tidy = tidyRendered(render(width));
			return tidy.actions === undefined ? tidy.text : tidy;
		};
	}
	return {text: block.text, options: next};
}
