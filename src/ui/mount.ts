import {createElement} from 'react';
import type {ViewHost} from '../../../../src/api.js';
import type {ShellFeed} from '../public.js';
import {ChatView, type ChatViewProps} from './ChatView.js';
import {internalsOf} from '../module-sessions.js';
import {PermissionPanel, type PermissionPanelProps} from './PermissionPanel.js';
import {ShellActivity} from './ShellActivity.js';
import {WaitingView, type WaitingViewProps} from './WaitingView.js';
import {ListPicker, type ListPickerProps} from './kit.js';

export type {ChatViewProps, ListPickerProps, PermissionPanelProps as PermissionElementProps, WaitingViewProps};

export function createChatElement(props: ChatViewProps): object {
	return createElement(ChatView, props);
}

export function createPickerElement(props: ListPickerProps): object {
	return createElement(ListPicker, props);
}

export function createShellElement(watch: ShellFeed, host?: ViewHost): object {
	return createElement(ShellActivity, {watch, ...(host && {host})});
}

export function createWaitingElement(props: WaitingViewProps): object {
	return createElement(WaitingView, props);
}

export function createPermissionElement(props: PermissionPanelProps): object {
	if (!internalsOf(props.session)) throw new Error('Not a module session');
	return createElement(PermissionPanel, props);
}
