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

## Completed

- Static browser app and module widget.
- Node local API with provider registry.
- macOS WebKit desktop wrapper.
- Persistent state and lifecycle history.
- Local process provider with PID, CPU, memory, start, and signal controls.
- Remote HTTP provider contract and health reporting.
- OpenAI Responses provider for configured response IDs.
- Standalone embeddable widget.
- Trusted-origin CORS and optional API token.
- Smoke test harness.
- Lineage view and selected-agent detail panel.
- Search/status/source filters for the agent table.
- GitHub push helper that creates/attaches `origin` and pushes after auth is fixed.

## Blockers

- GitHub push is blocked because `gh auth status` reports the saved `NTitterton` token is invalid.
- Required action: run `gh auth login -h github.com`, then `npm run github:push`.

## Push Policy

Push after meaningful commits and at the end of a work session when GitHub auth is valid. Until then, keep committing locally and re-check `gh auth status` each session.
