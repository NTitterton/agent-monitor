# Agent Monitor Status

## Goal

Build Agent Monitor: a local-first task manager for AI agents that can run as a desktop app, browser app, or embeddable widget; integrate local, provider-account, and remote/cloud agents; expose lifecycle controls; show resource usage and parent/child relationships; live in `~/agent-monitor/`; and be tracked in git with a GitHub remote.

## Current State

- Project path: `~/agent-monitor/`
- Git branch: `main`
- Local server: `npm run start`
- Browser app: `http://127.0.0.1:5173/`
- Module widget demo: `http://127.0.0.1:5173/embed.html`
- Standalone widget demo: `http://127.0.0.1:5173/embed-standalone.html`
- Desktop build: `npm run desktop:build`
- Smoke test: `npm run smoke`
- GitHub push helper: `npm run github:push`
- GitHub repo: `https://github.com/NTitterton/agent-monitor` (public)

## Completed

- Static browser app and module widget.
- Node local API with provider registry.
- macOS WebKit desktop wrapper.
- Persistent state and lifecycle history.
- Action history records include provider, provider ID, source, type, and action-kind metadata.
- Persisted action history is normalized for timestamps, IDs, labels, prompts, action kinds, and agent/provider metadata.
- Per-agent logs from state, local process, remote HTTP, OpenAI, and Anthropic providers.
- Per-agent transcripts in normalized state, remote provider payloads, OpenAI response output, and selected-agent details.
- Local process provider with PID, CPU, memory, start, and signal controls.
- Settings UI for configured local agents and launch commands.
- Active local agent process discovery for known agent CLIs.
- Local process PPID/child PID metadata and monitored-agent lineage linking.
- Remote HTTP provider contract and health reporting.
- Remote HTTP providers support configurable token header and prefix while keeping tokens secret.
- OpenAI Responses provider for configured response IDs and launchable model/input rows.
- Configurable OpenAI Response spend estimates from reported input/output token usage.
- Anthropic Message Batches provider for configured batch IDs and launchable model/input rows.
- Optional Anthropic recent Message Batch discovery with stable discovered-agent IDs and cancel-style actions.
- Standalone embeddable widget.
- Hosted personal-site embed guide for static sites serving the widget while calling the local Agent Monitor API.
- Desktop app bundle verification through `npm run desktop:build`.
- Desktop build verification now runs the compiled desktop binary in headless self-test mode and checks local `/api/health`.
- Desktop app startup diagnostics with captured local server output.
- Desktop app health probing and port fallback across local ports 5173-5183.
- Desktop app zip packaging through `npm run desktop:package`, with archive entry verification.
- Trusted-origin CORS and optional API token.
- Standalone widget supports custom token or bearer authorization headers.
- Local settings API and app panel for trusted origins, the write-only embed API token, local discovery, remote HTTP providers, OpenAI Responses, and Anthropic Message Batches.
- Compact one-screen browser layout with collapsible Settings, scrollable Sources, one-row desktop controls, denser rows/actions, dominant scrollable agent task list, and expandable selected-agent inspector.
- Desktop browser layout now enforces a table-first main panel: the agent list keeps at least 60% of the task panel even when the selected-agent inspector is expanded, with denser filter/header controls and bounded detail content.
- Smoke test harness.
- Lineage view and selected-agent detail panel.
- Named parent/child lineage summaries in embedded widgets.
- Selected-agent inspector preserves unresolved parent/child lineage IDs when related agents are absent from the snapshot.
- String parent/child lineage ID normalization across provider, registry, state, and client snapshots.
- Compact provider/source health and active-discovery scanner summaries in embedded widgets.
- Embedded widget task-pressure ordering and active-status summaries by status, priority, CPU, start time, and name.
- Search/status/source/type/provider filters for the agent table.
- Browser search includes remote context fields such as current step, owner, workspace, repository, branch, queue, priority, provider object IDs, provider models, and request counts.
- Agent table sorting by newest, CPU, memory, spend, tokens, runtime, priority, and operational status pressure.
- Top-summary aggregate CPU, memory, tokens, token throughput, spend, active work count, visible count, and provider issue count.
- Snapshot-derived status filter options for provider-specific states.
- Stable per-agent `type` field and type filter.
- Token throughput and token count confidence in normalized snapshots, main app, widgets, and remote provider docs.
- Sampled token throughput from successive provider snapshots when only cumulative tokens are reported.
- Per-agent spend display in embedded widget resource lines.
- Numeric `costUsd` normalization for persisted state, client snapshots, UI totals, and smoke coverage.
- Client and persisted-state token/timeline normalization for legacy or imperfect snapshots.
- App and widget timestamp/runtime formatting guards for malformed provider timestamps.
- Optional `currentStep` and `progressPercent` task-progress metadata in normalized snapshots, app, widgets, and remote provider docs.
- Selected-agent task card with task, current step, and progress details.
- Selected-agent provider object card for remote IDs, models, request counts, Go To kind, and window title.
- Selected-agent inspector lifecycle controls that reuse task-table action validation and prompts.
- Selected-agent detail refresh from each snapshot so action and polling updates stay current.
- Selected-agent stale detail recovery from `404` responses with refreshed snapshot context.
- Optional owner/workspace/repository/branch/queue/priority remote-agent context in normalized snapshots, selected-agent details, and embedded widgets.
- Compact provider-object metadata in module and standalone widgets.
- Registry-level provider/source/type normalization for local, account-backed, and third-party cloud agents.
- Local process aggregate resource accounting across matched processes and descendant child processes.
- Remote HTTP provider preserves reported own/child process-resource breakdown fields.
- Remote HTTP, browser client, standalone widget, and persisted state normalize provider-object fields including remote IDs, models, and request counts.
- Numeric CPU/memory resource normalization for persisted state, remote HTTP snapshots, client clones, and smoke coverage.
- Remote HTTP timestamp normalization for agent, log, and transcript date strings.
- Process ID normalization for remote HTTP and client snapshots.
- Local process lifecycle controls signal descendant process trees before root PIDs.
- Configured local process agents expose `Start` only while stopped, preventing duplicate local command spawns.
- Configured local process starts use private saved environment variables without exposing them in public config or snapshots.
- Smoke coverage for starting and force-ending a configured local process agent.
- Server-side capability enforcement for unsupported direct action requests.
- Server-side validation for unknown action IDs.
- Server-side stale-agent action rejection with refreshed snapshot context.
- Server-side rejection for provider actions that do not return an updated agent.
- Server-side rejection for provider actions that confirm a different agent ID.
- Server-side rejection for non-start lifecycle actions against terminal provider statuses.
- Server-side malformed JSON rejection with `400 Invalid JSON`.
- Server-side provider action exception handling with refreshed snapshot context.
- Local configured-agent start failures reported as provider errors instead of successful history.
- Unified lifecycle action responses with refreshed agents, history, provider status, sanitized config, and scanner status.
- Browser app action feedback for accepted and rejected lifecycle requests, including refreshed status/provider context.
- Browser app prompt cancellation for interrupt/end actions before dispatch.
- Browser app destructive-action confirmation before dispatch.
- Browser app escaping for provider-supplied text, history prompts, and action/provider attributes.
- Module widget action feedback for accepted and rejected lifecycle requests.
- Module widget prompt cancellation for interrupt/end actions before dispatch.
- Module widget destructive-action confirmation before dispatch.
- Module widget escaping for provider-supplied text and action messages.
- Standalone widget snapshot normalization for metrics, lineage, process IDs, capabilities, logs, and transcripts.
- Standalone widget action feedback for accepted and rejected lifecycle requests, including refreshed status/provider context.
- Standalone widget prompt cancellation for interrupt/end actions before dispatch.
- Standalone widget destructive-action confirmation before dispatch.
- Standalone widget local fallback lifecycle timestamps/resources and metadata-rich history.
- Standalone widget avoids local fallback mutation when a reachable API rejects an action.
- Standalone widget observes embed attribute changes and clamps polling intervals.
- `Go To` action for macOS local process agents that activates likely Terminal/iTerm, browser, or editor surfaces.
- Local process `Go To` metadata now infers browser, terminal, editor, or generic process surfaces from process ancestry.
- Browser-hosted local process `Go To` metadata now uses visible HTTP(S) URLs from browser command lines when available.
- URL-backed `Go To` targets for remote/account agents through `goToTarget` and `goToKind`.
- Direct API `Go To` calls for URL-backed remote/account agents return current agent snapshots without mutation/cancel calls.
- Action history records classify lifecycle actions separately from surface actions such as `Go To`.
- Browser app and widgets label lifecycle versus surface action history.
- Explanatory disabled-action titles for unavailable lifecycle, unadvertised provider capability, and `Go To` controls across app and widgets.
- Terminal provider statuses disable non-start lifecycle controls while preserving `Go To`.
- Optional browser-app auto refresh cadence and `scannedAt` freshness metadata for provider snapshots.
- Unified API `snapshotAt` timestamps surfaced in the browser topbar and embedded widget source summaries.
- Per-agent provider health and scan freshness in the browser task table and selected-agent inspector.
- Top-summary provider issue count for unhealthy adapters.
- Last-known provider agents remain visible during transient provider scan failures while provider status shows the error.
- Optional server-side background scanner driven by the snapshot refresh cadence, with detailed Active Discovery status exposed in the Sources panel and `/api/scanner`.
- Unified `/api/snapshot` refresh path for agents, history, provider status, and sanitized config in the app and standalone widget.
- Short provider snapshot cache so paired app refresh requests do not rescan adapters twice.
- Provider connection test endpoint and Sources-panel test buttons.
- Provider connection test responses with refreshed snapshot context applied by the browser client.
- Provider-specific action capabilities so OpenAI/Anthropic tracked objects do not expose unsupported `start` actions.
- Launchable OpenAI Response rows expose `Start`, create a background Response, and persist the returned response ID for subsequent tracking.
- Smoke coverage proves launchable OpenAI Response `Start` writes the created response ID into isolated config state.
- Launchable Anthropic Message Batch rows expose `Start`, create a single-request batch, and persist the returned batch ID for subsequent tracking.
- Smoke coverage proves launchable Anthropic Message Batch `Start` writes the created batch ID into isolated config state.
- Remote HTTP agents without advertised lifecycle capabilities are view-only except for URL-backed `Go To`.
- Remote HTTP adapter accepts wrapped or bare list/action response shapes.
- Capability normalization to known unique action IDs across provider, registry, state, and client snapshots.
- Non-blocking setup validation warnings from `/api/config` and Settings panel display.
- Client preserves config validation warnings across post-save refreshes.
- GitHub push helper that creates/attaches `origin` and pushes after auth is fixed.
- GitHub repo verified public, and the push helper defaults new repo creation to public visibility unless `GITHUB_VISIBILITY` overrides it.
- Built-in seed agents removed from runtime state and standalone widget fallback; Agent Monitor now shows discovered/configured/persisted real agents only, while old seed IDs are filtered from persisted state on read.

## Blockers

- None currently.

## Push Policy

Push after meaningful commits and at the end of a work session.
