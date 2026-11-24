import {bannerAnimates, formatBanner} from './ui/banner.js';
import {createBannerIntro} from './ui/banner-intro.js';
import {formatFileCard} from './ui/file-card.js';
import {assistantPrint, assistantRows, formatDirection, formatNotice, formatProfileLine, formatUserLine} from './ui/present.js';
import {listProjectFiles} from './files.js';

export {createChatElement, createPickerElement, createPermissionElement, createShellElement, createWaitingElement} from './ui/mount.js';
export type {ChatViewProps, ListPickerProps, PermissionElementProps, WaitingViewProps} from './ui/mount.js';
export type {Scrub} from './ui/present.js';
export type {ProfileLineView} from './ui/present.js';
export type {BannerIntro} from './ui/banner-intro.js';
export {bannerAnimates, createBannerIntro, formatBanner, formatFileCard, assistantPrint, assistantRows, formatDirection, formatNotice, formatProfileLine, formatUserLine, listProjectFiles};

export type ChatUiHelpers = {
	formatBanner: typeof formatBanner;
	bannerAnimates: typeof bannerAnimates;
	createBannerIntro: typeof createBannerIntro;
	formatFileCard: typeof formatFileCard;
	assistantPrint: typeof assistantPrint;
	assistantRows: typeof assistantRows;
	formatDirection: typeof formatDirection;
	formatNotice: typeof formatNotice;
	formatProfileLine: typeof formatProfileLine;
	formatUserLine: typeof formatUserLine;
	listProjectFiles: typeof listProjectFiles;
};
