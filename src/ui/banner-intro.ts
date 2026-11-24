import type {PrintOptions} from '../../../../src/api.js';
import {PAW_STEPS} from './banner.js';

export const INTRO_FRAME_MS = 200;
export const GLINT_FRAMES = 16;
export const GLINT_FRAME_MS = 40;

export type BannerIntro = {
	active(): boolean;
	frame(columns: number): string[];
	finish(): void;
	print(text: string, options?: PrintOptions): void;
	subscribe(cb: () => void): () => void;
	dispose(): void;
};

type IntroOptions = {
	render: (columns: number, pawStep?: number, glint?: number) => string;
	columns: () => number;
	print: (text: string, options?: PrintOptions) => void;
	frameMs?: number;
	glintMs?: number;
	schedule?: (fn: () => void, ms: number) => () => void;
};

const defaultSchedule = (fn: () => void, ms: number): (() => void) => {
	const t = setTimeout(fn, ms);
	t.unref();
	return () => clearTimeout(t);
};

export function createBannerIntro(o: IntroOptions): BannerIntro {
	const schedule = o.schedule ?? defaultSchedule;
	const frameMs = o.frameMs ?? INTRO_FRAME_MS;
	const glintMs = o.glintMs ?? GLINT_FRAME_MS;
	const last = PAW_STEPS + GLINT_FRAMES;
	const subscribers = new Set<() => void>();
	const queue: {text: string; options?: PrintOptions}[] = [];
	let step = 0;
	let done = false;
	let cancel: (() => void) | undefined;

	const notify = (): void => {
		for (const cb of [...subscribers]) cb();
	};

	const finish = (): void => {
		if (done) return;
		done = true;
		cancel?.();
		cancel = undefined;
		o.print(o.render(o.columns()), {render: w => o.render(w)});
		for (const q of queue.splice(0)) o.print(q.text, q.options);
		notify();
	};

	const tick = (): void => {
		cancel = undefined;
		if (done) return;
		if (step >= last) {
			finish();
			return;
		}
		step++;
		notify();
		cancel = schedule(tick, step <= PAW_STEPS ? frameMs : glintMs);
	};
	cancel = schedule(tick, frameMs);

	return {
		active: () => !done,
		frame: columns => {
			if (done) return [];
			const text = step <= PAW_STEPS ? o.render(columns, step) : o.render(columns, PAW_STEPS, (step - PAW_STEPS) / GLINT_FRAMES);
			return text === '' ? [] : text.split('\n');
		},
		finish,
		print: (text, options) => {
			if (done) o.print(text, options);
			else queue.push({text, ...(options && {options})});
		},
		subscribe: cb => {
			subscribers.add(cb);
			return () => {
				subscribers.delete(cb);
			};
		},
		dispose: () => {
			done = true;
			cancel?.();
			cancel = undefined;
			queue.length = 0;
		},
	};
}
