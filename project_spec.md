# Agent Monitor Spec

## Goal

Agent Monitor is a local-first task manager for AI agents. It should run as a standalone desktop app, browser web app, and embeddable widget while integrating agents from local processes, personal provider accounts, and remote/cloud systems. Operators should be able to inspect agent state, resource usage, parent/child relationships, and apply lifecycle controls: start, stop, interrupt with prompt, end with prompt, and force end.

## Spec Style

There is no project-specific OpenAI markdown spec format in use here. This file uses a living implementation-spec style:

- Goals and non-goals.
- Current behavior.
- Requirements.
- Data model changes.
- Acceptance criteria.
- Open questions.

## Current Scanning Behavior

Agent Monitor does not currently run a standalone background scanner.

- The browser app fetches a snapshot on initial load and when the Refresh button is clicked.
- The module widget uses the same client behavior as the browser app.
- The standalone embeddable widget polls every 15 seconds by default via `refresh-ms`.
- The local process provider runs `ps` and active local agent discovery whenever `/api/agents` or `/api/providers` asks providers for a fresh snapshot.

## New Requirements

### Agent Type

Add an explicit `type` field to normalized agents.

Initial values:

- `local`
- `openai`
- `anthropic`
- `remote`
- Third-party cloud provider slugs, for example `github-actions`, `modal`, `vercel`, or provider-defined IDs.

Relationship to existing fields:

- `source` currently groups broad origin classes such as `local`, `user-account`, and `cloud`.
- `provider` is display text.
- `providerId` identifies the adapter instance.
- `type` should be a stable, filterable classification for the kind of agent/provider.

Status: implemented for normalized provider snapshots and app filters.

Acceptance criteria:

- Every agent returned by `/api/agents` has `type`.
- The app can filter or group by `type`.
- Existing `source`, `provider`, and `providerId` behavior remains backward compatible.

### Token Rate

Add token throughput in addition to cumulative tokens.

New normalized fields:

- `tokens`: cumulative token count, when known.
- `tokensPerSecond`: recent or average token throughput, when known.
- `tokenRateWindowMs`: optional measurement window for `tokensPerSecond`.
- `tokenCountConfidence`: `observed`, `estimated`, `reported`, or `unknown`.

Notes:

- Some current token counts are mock values from seed data.
- OpenAI Responses can report usage once available, but live per-second throughput may require sampling successive snapshots.
- Anthropic Message Batches currently report request counts through the existing adapter, not true token counts.
- Remote providers should be allowed to report their own token totals and rates.

Status: implemented for normalized snapshots, the main app, widgets, and the remote provider contract.

Acceptance criteria:

- UI shows cumulative tokens and token rate when available.
- Unknown or estimated token counts are visually distinguishable from observed provider-reported counts.
- The provider contract documents token count confidence.

### Go To Agent

Add a `go to` action that brings the relevant local UI surface forward when possible.

Target surfaces:

- Terminal window for local CLI agents.
- Browser tab/window for browser-based agents.
- Provider dashboard URL for cloud agents.
- Remote URL for third-party cloud agents.

Potential normalized fields:

- `goToTarget`: stable identifier or URL for the surface.
- `goToKind`: `terminal`, `browser`, `url`, `process`, or `unknown`.
- `windowTitle`: optional display/help text.
- `pid`: already present for local processes.

Acceptance criteria:

- Agents with a known `remoteUrl` or dashboard URL expose a Go To button that opens it.
- Local process Go To is best-effort and platform-specific.
- If no target is known, the button is hidden or disabled with a clear unavailable state.

Open questions:

- For macOS terminal windows, should Agent Monitor use AppleScript, terminal app integrations, or only documented URLs/commands?
- For Chrome tabs, should this require a companion browser extension or Chrome debugging protocol?

### Active Scanning Cadence

Make scanning cadence explicit and configurable.

Requirements:

- Browser app should support optional polling instead of only manual refresh.
- Widget polling should remain configurable with `refresh-ms`.
- Local process scanning should have a visible last-scanned timestamp.
- Scan intervals should avoid expensive resource usage by default.

Initial proposal:

- Browser app default: manual refresh plus optional 10-15 second polling setting.
- Standalone widget default: 15 seconds.
- Local process scan: on each provider snapshot request, with possible short in-memory cache if polling becomes aggressive.

Acceptance criteria:

- Settings expose snapshot refresh cadence.
- API responses include enough timestamp metadata to show scan freshness.

### Provider Setup

Provider setup should be possible from the app for the adapters Agent Monitor already supports.

Current supported setup surfaces:

- Trusted embed origins.
- Local process discovery include/exclude patterns.
- Remote HTTP providers.
- OpenAI Responses provider instances and tracked response IDs.
- Anthropic Message Batches provider instances and tracked batch IDs.

Credential handling requirements:

- Public config responses must never include API tokens or provider API keys.
- Public config may expose boolean `hasToken` or `hasApiKey` flags.
- If a settings update omits an existing secret for a provider ID, the existing secret should be preserved.
- If a settings update includes a new secret, it should replace the previous one for that provider ID.

Acceptance criteria:

- `/api/config` returns sanitized setup data for all supported provider setup surfaces.
- `PUT /api/config` can update provider setup while preserving omitted secrets.
- Smoke tests prove token/API-key hiding and preservation for remote HTTP, OpenAI, and Anthropic setup.

## Data Model Draft

```json
{
  "id": "local-discovered-codex-12345",
  "name": "Codex CLI (12345)",
  "type": "local",
  "source": "local",
  "provider": "Local Process",
  "providerId": "local-process",
  "status": "running",
  "tokens": 18420,
  "tokensPerSecond": 12.4,
  "tokenRateWindowMs": 15000,
  "tokenCountConfidence": "observed",
  "goToKind": "terminal",
  "goToTarget": "pid:12345",
  "pid": 12345,
  "parentPid": 1000,
  "childPids": []
}
```

## Near-Term Implementation Plan

1. Add `type` to all provider normalizers and update filters.
2. Add token confidence fields and compute `tokensPerSecond` where successive snapshots make that possible.
3. Add `goTo` metadata and a disabled/available UI state.
4. Add configurable polling cadence to app settings.
5. Add provider setup validation and connection-test actions.
6. Document platform-specific Go To behavior before implementing OS automation.
