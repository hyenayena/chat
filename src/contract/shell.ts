export type ShellCall = {
	toolUseId: string;
	command: string;
	startedAt: number;
	lines: readonly string[];
	bytes: number;
	bound: 'file' | 'task';
};

export type ShellSnapshot = {calls: readonly ShellCall[]};

export interface ShellFeed {
	get(): ShellSnapshot;
	subscribe(cb: () => void): () => void;
}
