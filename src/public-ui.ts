import {formatBanner} from './ui/banner.js';
import {formatFileCard} from './ui/file-card.js';
import {assistantPrint, assistantRows, formatNotice, formatUserLine} from './ui/present.js';
import {listProjectFiles} from './files.js';

export {createChatElement, createPickerElement, createShellElement, createWaitingElement} from './ui/mount.js';
export type {ChatViewProps, ListPickerProps, WaitingViewProps} from './ui/mount.js';
export type {Scrub} from './ui/present.js';
export {formatBanner, formatFileCard, assistantPrint, assistantRows, formatNotice, formatUserLine, listProjectFiles};

export type ChatUiHelpers = {
	formatBanner: typeof formatBanner;
	formatFileCard: typeof formatFileCard;
	assistantPrint: typeof assistantPrint;
	assistantRows: typeof assistantRows;
	formatNotice: typeof formatNotice;
	formatUserLine: typeof formatUserLine;
	listProjectFiles: typeof listProjectFiles;
};
