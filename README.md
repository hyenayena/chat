# chat

Provider-neutral chat for yena. For now it holds only the chat contract: the events a chat engine emits, the session controller a UI drives, and the permission requests a provider raises. The chat UI and the commands follow in later versions. It has no data directory and no credentials, and is a library (no `runtime`, no `entry`) until it becomes a plugin.

## The contract (`src/contract/`)

Pure files: no `node:fs`, no React or Ink, no theme tables. `src/public.ts` re-exports all of them.

- `events.ts`: `UiEvent`, `ChatEvent`, `ChatState`, `TurnOutcome`, `ToolPatch`, `AgentItem`, `TaskStatus`, `ContextInfo`, `AccountReason`, `RouteInfo`, `ChatController`.
- `permission.ts`: `ChatMode`, `PermissionRequest` (tool and question), `PermissionDecision`, `AuditEntry`, the preview shapes, the review limits and the deny/cancel messages.
- `plan.ts`: `PlanItem`, `parseTodos`, `planChanges`.
- `limits.ts`: `RateLimitInfo`, `Clock`, `formatReset`, `limitIndicator`.
- `tiers.ts`: the neutral scale `TIERS`, `Tier`, `isTier`, `tierRank`, `maxTier`.
- `turn-stats.ts`, `diff.ts`, `truncate.ts`, `usage.ts`: turn summaries, diff previews, text clamps and the usage meter.
- `tools.ts`: the canonical tool vocabulary (agent tools, the console MCP tool names).
- `shell.ts`: `ShellCall`, `ShellSnapshot`, `ShellFeed`.

## For other modules

Import `src/public.ts` through your own `src/deps/chat.ts` and declare `chat` in your `yena.json` dependencies. Fields in the contract are optional: a provider that lacks a feature does not emit it. Never rename a field: the claude module's runner protocol (version 1) carries these shapes on the wire.
