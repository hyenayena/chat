import assert from 'node:assert/strict';
import {test} from 'node:test';
import {GLINT_FRAMES, createBannerIntro} from '../../src/ui/banner-intro.js';
import {stringCells, stripStyles} from '../../src/kit.js';
import {formatBanner} from '../../src/ui/banner.js';

function setup() {
	const printed: {text: string; render: boolean}[] = [];
	let pending: (() => void) | undefined;
	let cancelled = 0;
	const intro = createBannerIntro({
		render: (columns, step, glint) => (step === undefined ? `static${columns}` : glint === undefined ? `frame${step}` : `glint${glint}`),
		columns: () => 50,
		print: (text, options) => void printed.push({text, render: options?.render?.(7) === 'static7'}),
		schedule: fn => {
			pending = fn;
			return () => {
				cancelled++;
				pending = undefined;
			};
		},
	});
	const tick = (): void => {
		const fn = pending!;
		pending = undefined;
		fn();
	};
	return {intro, printed, tick, cancelled: () => cancelled, pending: () => pending !== undefined};
}

test('the intro steps through the frames and then prints the static banner', () => {
	const s = setup();
	let notified = 0;
	s.intro.subscribe(() => notified++);
	for (let step = 0; step <= 4; step++) {
		assert.deepEqual(s.intro.frame(30), [`frame${step}`]);
		assert.ok(s.intro.active());
		s.tick();
	}
	for (let k = 1; k <= GLINT_FRAMES; k++) {
		assert.deepEqual(s.intro.frame(30), [`glint${k / GLINT_FRAMES}`]);
		assert.ok(s.intro.active());
		s.tick();
	}
	assert.equal(s.intro.active(), false);
	assert.deepEqual(s.intro.frame(30), []);
	assert.deepEqual(s.printed, [{text: 'static50', render: true}]);
	assert.equal(notified, 5 + GLINT_FRAMES);
	assert.equal(s.pending(), false);
});

test('finish prints once, then the queued prints in order, and later prints pass through', () => {
	const s = setup();
	s.intro.print('a');
	s.intro.print('b');
	assert.equal(s.printed.length, 0);
	s.intro.finish();
	s.intro.finish();
	assert.deepEqual(s.printed.map(p => p.text), ['static50', 'a', 'b']);
	s.intro.print('c');
	assert.deepEqual(s.printed.map(p => p.text), ['static50', 'a', 'b', 'c']);
	assert.equal(s.cancelled(), 1);
});

test('dispose prints nothing and stops the timer', () => {
	const s = setup();
	s.intro.print('a');
	s.intro.dispose();
	assert.deepEqual(s.printed, []);
	assert.equal(s.intro.active(), false);
	assert.equal(s.pending(), false);
});

test('an empty render gives no frame rows', () => {
	const intro = createBannerIntro({render: () => '', columns: () => 5, print: () => {}, schedule: () => () => {}});
	assert.deepEqual(intro.frame(5), []);
});

test('every real frame stays within columns - 1 and the plain logo is not animated', () => {
	const build = {version: '1.0.0', commit: 'abcdef0', root: {mode: 'image' as const}};
	for (const columns of [20, 40, 60, 80, 120]) {
		const intro = createBannerIntro({
			render: (cols, step, glint) =>
				formatBanner({build, model: 'm', columns: cols} as never, s => s, step === undefined ? undefined : {pawStep: step, ...(glint !== undefined && {glint})}),
			columns: () => columns,
			print: () => {},
			schedule: () => () => {},
		});
		for (const row of intro.frame(columns - 1)) assert.ok(stringCells(stripStyles(row)) <= columns - 1, `${columns}: ${stringCells(stripStyles(row))}`);
		intro.dispose();
	}
});
