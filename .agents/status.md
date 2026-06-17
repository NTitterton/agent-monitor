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
- Lifecycle history records include provider, provider ID, source, and type metadata.
- Persisted lifecycle history is normalized for timestamps, IDs, labels, prompts, and agent/provider metadata.
- Per-agent logs from state, local process, remote HTTP, OpenAI, and Anthropic providers.
- Per-agent transcripts in normalized state, remote provider payloads, OpenAI response output, and selected-agent details.
- Local process provider with PID, CPU, memory, start, and signal controls.
- Settings UI for configured local agents and launch commands.
- Active local agent process discovery for known agent CLIs.
- Local process PPID/child PID metadata and monitored-agent lineage linking.
- Remote HTTP provider contract and health reporting.
- OpenAI Responses provider for configured response IDs.
- Anthropic Message Batches provider for configured batch IDs.
- Standalone embeddable widget.
- Desktop app bundle verification through `npm run desktop:build`.
- Desktop app startup diagnostics with captured local server output.
- Desktop app zip packaging through `npm run desktop:package`.
- Trusted-origin CORS and optional API token.
- Local settings API and app panel for trusted origins, local discovery, remote HTTP providers, OpenAI Responses, and Anthropic Message Batches.
- Smoke test harness.
- Lineage view and selected-agent detail panel.
- Named parent/child lineage summaries in embedded widgets.
- String parent/child lineage ID normalization across provider, registry, state, and client snapshots.
- Compact provider/source health summaries in embedded widgets.
- Embedded widget task-pressure ordering by status, priority, CPU, start time, and name.
- Search/status/source filters for the agent table.
- Agent table sorting by newest, CPU, memory, spend, tokens, runtime, priority, and status.
- Snapshot-derived status filter options for provider-specific states.
- Stable per-agent `type` field and type filter.
- Token throughput and token count confidence in normalized snapshots, main app, widgets, and remote provider docs.
- Sampled token throughput from successive provider snapshots when only cumulative tokens are reported.
- Per-agent spend display in embedded widget resource lines.
- Numeric `costUsd` normalization for persisted state, client snapshots, UI totals, and smoke coverage.
- Client and persisted-state token/timeline normalization for legacy or imperfect snapshots.
- Optional `currentStep` and `progressPercent` task-progress metadata in normalized snapshots, app, widgets, and remote provider docs.
- Selected-agent task card with task, current step, and progress details.
- Selected-agent detail refresh from each snapshot so action and polling updates stay current.
- Selected-agent stale detail recovery from `404` responses with refreshed snapshot context.
- Optional owner/workspace/repository/branch/queue/priority remote-agent context in normalized snapshots, selected-agent details, and embedded widgets.
- Local process aggregate resource accounting across matched processes and descendant child processes.
- Remote HTTP provider preserves reported own/child process-resource breakdown fields.
- Numeric CPU/memory resource normalization for persisted state, remote HTTP snapshots, client clones, and smoke coverage.
- Remote HTTP timestamp normalization for agent, log, and transcript date strings.
- Process ID normalization for remote HTTP and client snapshots.
- Local process lifecycle controls signal descendant process trees before root PIDs.
- Smoke coverage for starting and force-ending a configured local process agent.
- Server-side capability enforcement for unsupported direct action requests.
- Server-side validation for unknown action IDs.
- Server-side stale-agent action rejection with refreshed snapshot context.
- Server-side rejection for provider actions that do not return an updated agent.
- Server-side rejection for provider actions that confirm a different agent ID.
- Server-side malformed JSON rejection with `400 Invalid JSON`.
- Server-side provider action exception handling with refreshed snapshot context.
- Local configured-agent start failures reported as provider errors instead of successful history.
- Unified lifecycle action responses with refreshed agents, history, provider status, sanitized config, and scanner status.
- Browser app action feedback for accepted and rejected lifecycle requests.
- Browser app prompt cancellation for interrupt/end actions before dispatch.
- Browser app escaping for provider-supplied text, history prompts, and action/provider attributes.
- Module widget action feedback for accepted and rejected lifecycle requests.
- Module widget prompt cancellation for interrupt/end actions before dispatch.
- Module widget escaping for provider-supplied text and action messages.
- Standalone widget snapshot normalization for metrics, lineage, process IDs, capabilities, logs, and transcripts.
- Standalone widget action feedback for accepted and rejected lifecycle requests.
- Standalone widget prompt cancellation for interrupt/end actions before dispatch.
- Standalone widget local fallback lifecycle timestamps/resources and metadata-rich history.
- Standalone widget avoids local fallback mutation when a reachable API rejects an action.
- `Go To` action for macOS local process agents that activates likely Terminal/iTerm, browser, or editor surfaces.
- URL-backed `Go To` targets for remote/account agents through `goToTarget` and `goToKind`.
- Direct API `Go To` calls for URL-backed remote/account agents return current agent snapshots without mutation/cancel calls.
- Action history records classify lifecycle actions separately from surface actions such as `Go To`.
- Explanatory disabled-action titles for unavailable lifecycle, unadvertised provider capability, and `Go To` controls across app and widgets.
- Optional browser-app auto refresh cadence and `scannedAt` freshness metadata for provider snapshots.
- Unified API `snapshotAt` timestamps surfaced in the browser topbar and embedded widget source summaries.
- Per-agent provider health and scan freshness in the browser task table and selected-agent inspector.
- Last-known provider agents remain visible during transient provider scan failures while provider status shows the error.
- Optional server-side background scanner driven by the snapshot refresh cadence, with status exposed in the app and `/api/scanner`.
- Unified `/api/snapshot` refresh path for agents, history, provider status, and sanitized config in the app and standalone widget.
- Short provider snapshot cache so paired app refresh requests do not rescan adapters twice.
- Provider connection test endpoint and Sources-panel test buttons.
- Provider connection test responses with refreshed snapshot context applied by the browser client.
- Provider-specific action capabilities so OpenAI/Anthropic tracked objects do not expose unsupported `start` actions.
- Remote HTTP agents without advertised lifecycle capabilities are view-only except for URL-backed `Go To`.
- Capability normalization to known unique action IDs across provider, registry, state, and client snapshots.
- Non-blocking setup validation warnings from `/api/config` and Settings panel display.
- Client preserves config validation warnings across post-save refreshes.
- GitHub push helper that creates/attaches `origin` and pushes after auth is fixed.

## Blockers

- None currently.

## Push Policy

Push after meaningful commits and at the end of a work session.
