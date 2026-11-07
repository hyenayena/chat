import type {CommandContext, MountControl, UiElement} from '../../../../src/api.js';

export type FakeCtx = CommandContext & {
	lines: string[];
	mounts: number;
	controls: MountControl[];
	closeAll(): void;
	clipboard: string[];
};

type Options = {signal?: boolean; caller?: string; mount?: boolean; clipboard?: boolean; pick?: (props: Record<string, unknown>) => void};

export function makeCtx(opts: Options = {}): FakeCtx {
	const lines: string[] = [];
	const controls: MountControl[] = [];
	const clipboard: string[] = [];
	const resolvers: Array<() => void> = [];
	const ctx = {
		lines,
		controls,
		clipboard,
		mounts: 0,
		print: (text: string) => void lines.push(text),
		closeAll: () => {
			for (const r of resolvers.splice(0)) r();
		},
		...(opts.signal && {signal: new AbortController().signal}),
		...(opts.caller !== undefined && {caller: opts.caller}),
		...(opts.clipboard && {copyToClipboard: (t: string) => (clipboard.push(t), true)}),
		...(opts.mount !== false && {
			mount: (build: (control: MountControl) => UiElement) =>
				new Promise<void>(resolve => {
					ctx.mounts++;
					resolvers.push(resolve);
					const control = {close: () => resolve(), print: (t: string) => void lines.push(t)} as MountControl;
					controls.push(control);
					build(control);
				}),
		}),
	};
	return ctx as unknown as FakeCtx;
}
