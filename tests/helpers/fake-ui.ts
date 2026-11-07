import type {UiElement} from '../../../../src/api.js';
import {assistantPrint, assistantRows, formatBanner, formatFileCard, formatNotice, formatUserLine, listProjectFiles} from '../../src/public-ui.js';
import type {ChatViewProps, ListPickerProps, WaitingViewProps} from '../../src/public-ui.js';
import type {ChatUi} from '../../src/open-flow.js';

export type FakeUi = {
	ui: ChatUi;
	chats: ChatViewProps[];
	pickers: ListPickerProps[];
	waits: WaitingViewProps[];
	delivered: string[];
	pick?: (props: ListPickerProps) => void;
};

export function makeUi(): FakeUi {
	const f: FakeUi = {
		chats: [],
		pickers: [],
		waits: [],
		delivered: [],
		ui: {
			assistantPrint,
			assistantRows,
			formatBanner,
			formatFileCard,
			formatNotice,
			formatUserLine,
			listProjectFiles,
			createChatElement: (props): UiElement => {
				f.chats.push(props);
				props.onInbox?.(text => void f.delivered.push(text));
				return {} as UiElement;
			},
			createPickerElement: (props): UiElement => {
				f.pickers.push(props);
				f.pick?.(props);
				return {} as UiElement;
			},
			createShellElement: () => ({}) as UiElement,
			createWaitingElement: (props): UiElement => {
				f.waits.push(props);
				return {} as UiElement;
			},
		},
	};
	return f;
}
