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
- Trusted-origin CORS and optional API token.
- Local settings API and app panel for trusted origins, local discovery, remote HTTP providers, OpenAI Responses, and Anthropic Message Batches.
- Smoke test harness.
- Lineage view and selected-agent detail panel.
- Search/status/source filters for the agent table.
- Stable per-agent `type` field and type filter.
- Token throughput and token count confidence in normalized snapshots, main app, widgets, and remote provider docs.
- `Go To` action for macOS local process agents that activates likely Terminal/iTerm, browser, or editor surfaces.
- URL-backed `Go To` targets for remote/account agents through `goToTarget` and `goToKind`.
- Optional browser-app auto refresh cadence and `scannedAt` freshness metadata for provider snapshots.
- Provider connection test endpoint and Sources-panel test buttons.
- Non-blocking setup validation warnings from `/api/config` and Settings panel display.
- GitHub push helper that creates/attaches `origin` and pushes after auth is fixed.

## Blockers

- None currently.

## Push Policy

Push after meaningful commits and at the end of a work session.
