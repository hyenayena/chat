import React, {useEffect, useSyncExternalStore} from 'react';
import {Box, Text} from 'ink';
import type {BannerIntro as Intro} from './banner-intro.js';

export function BannerIntro(props: {intro: Intro; columns: number; maxRows: number}) {
	const {intro, columns, maxRows} = props;
	const version = useSyncExternalStore(
		cb => intro.subscribe(cb),
		() => intro.frame(Math.max(1, columns - 1)).join('\n') + (intro.active() ? '' : '\u0000'),
	);
	const rows = intro.active() ? intro.frame(Math.max(1, columns - 1)) : [];
	const skip = rows.length === 0 || rows.length > maxRows;
	useEffect(() => {
		if (skip) intro.finish();
	}, [skip, intro, version]);
	if (skip) return null;
	return (
		<Box flexDirection="column">
			{rows.map((row, i) => (
				<Text key={i} wrap="truncate">
					{row}
				</Text>
			))}
		</Box>
	);
}
