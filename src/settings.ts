import type {Logger, Setting, SettingOption, SettingsTab} from '../../../src/api.js';
import type {ChatMode} from './contract/permission.js';
import {chatProviders} from './registry.js';
import type {Prefs} from './prefs.js';

const MODE_OPTIONS: SettingOption[] = [
	{value: '', label: 'Default', description: 'edits and commands ask first'},
	{value: 'acceptEdits', label: 'Accept edits', description: 'project edits go through without asking'},
	{value: 'plan', label: 'Plan', description: 'yena researches and proposes a plan first, no edits'},
	{value: 'auto', label: 'Auto', description: 'a classifier approves or denies, asks when unsure'},
];
const INPUT_OPTIONS: SettingOption[] = [
	{value: '', label: 'Normal'},
	{value: 'vim', label: 'Vim', description: 'Esc for NORMAL mode, i/a/o to type'},
];
const KEEP_OPTIONS: SettingOption[] = [
	{value: '', label: 'Off'},
	{value: 'on', label: 'On', description: 'the chat finishes its work after you leave yena'},
];

const APPLIES = (newOnly: boolean): string => (newOnly ? 'applies to new chats' : 'applies now and to new chats');

export type ChatTabHooks = {
	prefs: Prefs;
	applyMode?: (mode: ChatMode) => void;
	applyKeep?: (keep: boolean) => void;
	log?: Logger;
};

export function chatTab(hooks: ChatTabHooks): SettingsTab {
	const {prefs, log} = hooks;
	const known = (options: SettingOption[], value: string): void => {
		if (!options.some(o => o.value === value)) throw new Error('Unknown option');
	};
	const logged = (key: string, value: string): void => log?.info('chat setting set', {key, value: value === '' ? 'default' : value});

	const modeOptions = (): SettingOption[] => {
		let modes: readonly ChatMode[];
		try {
			modes = prefs.defaultProvider().modes;
		} catch {
			return MODE_OPTIONS;
		}
		return MODE_OPTIONS.filter(o => modes.includes(o.value === '' ? 'default' : (o.value as ChatMode)));
	};

	const settings: Setting[] = [
		{
			key: 'permissionMode',
			label: 'Permission mode',
			description: `How tool calls are approved; ${APPLIES(false)}`,
			get options() {
				return modeOptions();
			},
			get: async () => (await prefs.load()).permissionMode ?? '',
			set: async value => {
				known(modeOptions(), value);
				await prefs.update({permissionMode: value === '' ? undefined : (value as 'acceptEdits' | 'plan' | 'auto')});
				logged('permissionMode', value);
				hooks.applyMode?.(value === '' ? 'default' : (value as ChatMode));
			},
		},
		{
			key: 'inputMode',
			label: 'Input mode',
			description: `How the chat input edits text; ${APPLIES(false)}`,
			options: INPUT_OPTIONS,
			get: async () => (await prefs.load()).inputMode ?? '',
			set: async value => {
				known(INPUT_OPTIONS, value);
				await prefs.update({inputMode: value === 'vim' ? 'vim' : undefined});
				logged('inputMode', value);
			},
		},
		{
			key: 'keepRunning',
			label: 'Keep working after exit',
			description: `Let the chat finish its work in the background when you leave yena; ${APPLIES(false)}`,
			options: KEEP_OPTIONS,
			get: async () => ((await prefs.load()).keepRunning ? 'on' : ''),
			set: async value => {
				known(KEEP_OPTIONS, value);
				await prefs.update({keepRunning: value === 'on' ? true : undefined});
				logged('keepRunning', value);
				hooks.applyKeep?.(value === 'on');
			},
		},
		{
			key: 'provider',
			label: 'Default provider',
			description: `The chat provider that "chat" opens; ${APPLIES(true)}`,
			get options() {
				return [{value: '', label: 'First installed'}, ...chatProviders().map(p => ({value: p.id, label: p.label}))];
			},
			get: async () => (await prefs.load()).provider ?? '',
			set: async value => {
				if (value !== '' && !chatProviders().some(p => p.id === value)) throw new Error('Unknown option');
				await prefs.update({provider: value === '' ? undefined : value});
				logged('provider', value);
			},
		},
	];
	return {title: 'Chat', settings};
}
