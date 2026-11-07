import {spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

export const editorCommand = (env: NodeJS.ProcessEnv): string => env['VISUAL'] || env['EDITOR'] || 'vi';

export function editInEditor(text: string, env: NodeJS.ProcessEnv): string | undefined {
	const dir = mkdtempSync(path.join(tmpdir(), 'yena-prompt-'));
	const file = path.join(dir, 'prompt.md');
	try {
		writeFileSync(file, text, {mode: 0o600});
		const r = spawnSync(editorCommand(env), [file], {stdio: 'inherit', env, shell: false});
		if (r.error || r.status !== 0) return undefined;
		return readFileSync(file, 'utf8').replace(/\n$/, '');
	} finally {
		rmSync(dir, {recursive: true, force: true});
	}
}
