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

- The browser app fetches a snapshot on initial load and when the Refresh button is clicked.
- The module widget uses the same client behavior as the browser app.
- The standalone embeddable widget polls every 3 seconds by default via `refresh-ms`.
- The local process provider runs `ps` and active local agent discovery whenever `/api/agents` or `/api/providers` asks providers for a fresh snapshot.
- The browser app and standalone embeddable widget use `GET /api/snapshot` to fetch agents, history, provider status, and sanitized config in one response.
- Snapshot-style API responses include `snapshotAt`, the server assembly time for that view. The browser app and embedded widgets display it separately from provider `scannedAt` freshness.
- Provider snapshots are cached for 1000 ms by default, configurable with `AGENT_MONITOR_SCAN_CACHE_MS`, so unified snapshots and paired legacy `/api/agents` plus `/api/providers` requests reuse the same scan.
- When `snapshotRefresh.enabled` is true, the local server also runs a background scanner at `snapshotRefresh.intervalMs`; the scanner warms provider snapshots with the same interval as the cache window and exposes status through `/api/scanner` and `/api/snapshot`.
- `GET /api/health` identifies the local Agent Monitor server for desktop startup, port reuse, and simple local health checks.
- The local Settings panel can rotate the write-only embed API token while public config responses expose only `hasApiToken`.

## New Requirements

### Run Surfaces

Agent Monitor should run as a browser app, standalone desktop app, and embeddable widget.

Status: browser app, module widget, standalone widget, and macOS desktop wrapper are implemented. The browser app and widgets escape provider-supplied text and attributes before rendering. `npm run desktop:build` compiles and verifies the generated `.app` bundle, including a headless self-test that runs the compiled desktop binary, starts a temporary local server, and checks `/api/health`. Desktop startup diagnostics show project root and captured server output when the local server cannot start. The desktop wrapper identifies already-running Agent Monitor servers through `/api/health`, reuses ports `5173`-`5183` when available, and otherwise starts on the first open port in that range. `npm run desktop:package` creates a shareable zip from the verified app bundle and verifies required archive entries.

Hosted embed status: implemented documentation in `docs/hosted-embed.md` for static personal sites such as `zo.computer` that host `agent-monitor-widget.js` while calling the local Agent Monitor API through trusted-origin CORS and an optional widget token. The guide documents copy-paste snippets, token header choices, fallback behavior, refresh cadence, browser localhost restrictions, and local health checks.

### Browser Layout

The browser app should behave like a one-screen operations console.

- The default desktop view should fit the header, source health, filters, agent list, and selected-agent detail within one viewport without requiring the whole page to scroll.
- Summary metrics should not create dead header space; prefer a compact header and dense metrics over large marketing-style title/metric blocks.
- The left Sources rail should remain operational and scannable. Long configuration forms should live behind a Settings disclosure/menu rather than permanently occupying the rail.
- The agent list should be the primary scroll area when many agents exist, so Sources, filters, and selected-agent detail remain reachable.
- On desktop, the agent list should dominate the main panel, roughly like Activity Monitor: target around 75-80% of main-panel vertical space for the process/task list, with detail and controls kept compact. Rich selected-agent detail should be available through a compact expandable inspector rather than taking persistent table space.
- Search and filter controls should stay compact and avoid large empty horizontal gaps.
- The Agent Tasks heading, refresh affordance, filter row, and sort control should not create mostly empty horizontal bands. They should be dense operational controls above the list.
- The selected-agent inspector must not collapse the process/task list into a small strip. In the default desktop layout, the agent list should keep at least 60% of the main panel even when the inspector is expanded; inspector actions should wrap cleanly without stray whitespace or isolated buttons.

Status: implemented as a compact viewport-height app shell with a denser one-row desktop summary, collapsible Settings disclosure in the Sources rail, scrollable Sources rail, compact desktop filters, scrollable dominant agent table with a hard desktop minimum of 60% of the main panel, sticky task-table header, denser table rows/actions, and a collapsed-by-default selected-agent inspector that expands into a bounded detail area. Further visual refinement can continue, but the default desktop layout no longer requires the long settings form, full detail inspector, or agent list to push the entire page vertically.

### Office View

Agent Monitor should include a second agent-list view called Office. It should visualize the currently visible agents as a top-down office floor where each agent gets a cubicle. The aesthetic should be low-poly and indie-game-like rather than a plain administrative chart. More visible agents should create more cubicles, using the active table filters and sort order.

Requirements:

- The table view remains the default operational view.
- Operators can switch between Table and Office without changing filters, selected agent, polling, or lifecycle semantics.
- Each visible agent maps to one cubicle.
- Clicking a cubicle selects that agent, switches the office floor into a close-up cubicle focus view, and surfaces the same lifecycle controls as the table/detail surfaces, including stop, interrupt, end with prompt, force end, and go to when available.
- The office inspector should show task, context, resources, provider health, lineage, and usage at a glance.
- The focused cubicle view should visually reserve space for richer context and communication/status signals even when the provider has not reported full contents yet.
- Future office cubicles should be able to show richer agent context, current thinking/state, and agent-to-agent communication paths.

Status: initial implementation uses a dependency-free Canvas 2D renderer with deterministic cubicle layout, click hit-testing, a close-up cubicle focus mode, an inspector action panel, and visual boards for current context plus agent signal placeholders. The renderer is structured as a replaceable visual layer so a future Three.js/OpenGL renderer can take over without changing provider/action semantics.

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
- The app can filter or group by `type` and by provider instance.
- Browser search covers task-manager context fields including task/current step, owner, workspace, repository, branch, queue, priority, provider, source, type, local/window target hints, provider object IDs, provider models, and provider request counts.
- The top summary shows aggregate task-manager totals including visible agents, active provider-status work, CPU, memory, tokens, token throughput, spend, and provider issues.
- The app can sort visible tasks by task-manager fields including CPU, memory, spend, tokens, runtime, priority, operational status pressure, and start time.
- Existing `source`, `provider`, and `providerId` behavior remains backward compatible.
- Status filtering is derived from current snapshots rather than a fixed local-only status list. Status-pressure sorting and summary active counts rank active/queued work ahead of paused, failed/cancelled, and completed work.

### Token Rate

Add token throughput in addition to cumulative tokens.

New normalized fields:

- `tokens`: cumulative token count, when known.
- `tokensPerSecond`: recent or average token throughput, when known.
- `tokenRateWindowMs`: optional measurement window for `tokensPerSecond`.
- `tokenCountConfidence`: `observed`, `estimated`, `reported`, or `unknown`.

Notes:

- Runtime token counts should come from discovered/configured providers or persisted real agent state, not built-in seed agents.
- OpenAI Responses can report usage once available, but live per-second throughput may require sampling successive snapshots.
- Anthropic Message Batches currently report request counts through the existing adapter, not true token counts.
- Remote providers should be allowed to report their own token totals and rates.
- Remote providers may also report `processCpu`, `processMemoryMb`, `childCpu`, `childMemoryMb`, `pid`, `parentPid`, and `childPids` when they can observe process-level execution.

Status: implemented for normalized snapshots, the main app, widgets, and the remote provider contract. Provider snapshots normalize agent `provider`, `providerId`, `source`, and `type` at the registry boundary so local, OpenAI, Anthropic, and third-party cloud agents keep stable task-manager classifications across app and widget surfaces. When a provider reports cumulative tokens but no positive token rate, fresh provider snapshots derive `tokensPerSecond` from successive token deltas and expose the measured `tokenRateWindowMs`. OpenAI Responses can estimate `costUsd` from reported input/output usage when operator-configured USD-per-1K token rates are available; rates are configurable rather than hardcoded. Built-in seed agents have been removed from runtime state, and old seed rows are filtered during state normalization.

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

Status: partial implementation for macOS local process agents and URL-backed remote/account agents. `Go To` activates likely Terminal/iTerm, browser, or editor surfaces from local process metadata and process ancestry, exposes local `goToKind`, `goToTarget`, and `windowTitle` hints, opens visible browser URLs when a local browser-hosted process command includes one, and opens `goToTarget` URLs for remote dashboards/provider pages. Unsupported or unavailable Go To controls are disabled with explanatory titles. Exact terminal tab selection still needs deeper host integration.

Open questions:

- For macOS terminal windows, should Agent Monitor use AppleScript, terminal app integrations, or only documented URLs/commands?
- For Chrome tabs, should this require a companion browser extension or Chrome debugging protocol?

### Active Scanning Cadence

Make scanning cadence explicit and configurable.

Requirements:

- Browser app should poll by default instead of requiring manual refresh for newly discovered local agents.
- Widget polling should remain configurable with `refresh-ms`; standalone embeds should clamp the interval to a safe range and reschedule when host pages change embed attributes.
- Local process scanning should have a visible last-scanned timestamp.
- Scan intervals should avoid expensive resource usage by default.

Initial proposal:

- Browser app default: 3 second polling, configurable from Settings and explicitly disableable. Intervals are clamped to 1-300 seconds so the UI can feel live without accepting pathological values.
- Standalone widget default: 15 seconds.
- Local process scan: on each provider snapshot request, with possible short in-memory cache if polling becomes aggressive.

Status: implemented for default browser-app polling, configurable refresh interval, provider/agent `scannedAt` metadata, source-list scan freshness display, a unified snapshot endpoint used by the app and standalone widget, a server-side background scanner that follows `snapshotRefresh`, an Active Discovery Sources-panel row with scanner timing/count/error details, and provider snapshot caching to avoid duplicate scans during refresh. Missing `snapshotRefresh` config defaults to enabled at 3 seconds, while explicit `enabled: false` preserves manual-only mode.

Task-level health note: the browser top summary shows provider issue count, while the task table and selected-agent inspector show provider health and scan freshness for each agent, so provider failures are visible directly beside affected work rather than only in the Sources panel.

Provider failure freshness note: if a provider scan fails after a successful cached scan, Agent Monitor keeps the provider's last-known agents visible with their previous `scannedAt` values while the provider status records the new failed scan time and error. Operators retain task visibility without confusing stale agent freshness for current provider health.

Acceptance criteria:

- Settings expose snapshot refresh cadence.
- API responses include enough timestamp metadata to show scan freshness.
- `/api/scanner` reports whether server-side background scanning is enabled, running, and when it last completed; the Sources panel surfaces the same scanner state with interval, last-start/finish freshness, provider count, agent count, and scanner errors.

### Provider Setup

Provider setup should be possible from the app for the adapters Agent Monitor already supports.

Current supported setup surfaces:

- Trusted embed origins.
- Standalone widget token delivery through `X-Agent-Monitor-Token` or optional bearer `Authorization`.
- Configured local agents and their launch commands.
- Local process discovery include/exclude patterns.
- Remote HTTP providers.
- OpenAI Responses provider instances and tracked response IDs.
- Anthropic Message Batches provider instances and tracked batch IDs.

Credential handling requirements:

- Public config responses must never include API tokens or provider API keys.
- Public config responses must never include local agent environment variables.
- Public config may expose boolean `hasToken` or `hasApiKey` flags.
- If a settings update omits an existing secret for a provider ID, the existing secret should be preserved.
- If a settings update includes a new secret, it should replace the previous one for that provider ID.

Acceptance criteria:

- `/api/config` returns sanitized setup data for all supported provider setup surfaces.
- `PUT /api/config` can update provider setup while preserving omitted secrets.
- `PUT /api/config` returns non-blocking validation warnings for malformed setup rows.
- Smoke tests prove token/API-key hiding and preservation for remote HTTP, OpenAI, and Anthropic setup.
- Smoke tests prove cross-origin widget auth through custom token and bearer token headers.
- Smoke tests prove local agent env hiding and preservation.

Status: provider connection testing implemented through `POST /api/providers/:id/test` and Sources-panel test buttons. Provider test responses include refreshed agents, history, provider status, sanitized config, and scanner status, and the client applies the returned source status immediately. Config saves also return validation warnings for malformed provider/local-agent setup, the client preserves those warnings across the post-save refresh, and the Settings panel displays them.

Remote HTTP auth note: remote provider tokens remain secret, while non-secret `tokenHeader` and `tokenPrefix` settings allow cloud runners to use `Authorization: Bearer <token>` by default or custom raw-token/API-key headers when required.

### Provider Action Semantics

Agent-level capabilities should describe actions the active provider can truly perform.

- Configured local agents expose `start` only while not running because Agent Monitor can spawn their configured command.
- Remote HTTP agents can expose `start` or future resume-like controls when the remote API advertises those capabilities.
- Remote HTTP agents that omit `capabilities` are treated as view-only except for inferred URL-backed `go-to`; Agent Monitor does not invent lifecycle controls for remote/cloud agents.
- OpenAI Responses and Anthropic Message Batches expose cancel-style lifecycle actions for tracked objects, plus optional `go-to` links, but do not expose `start` for already-created work.
- OpenAI Response rows with `model` and `input` but no `responseId` expose `start`; starting one creates a background Response and persists the returned response ID for subsequent tracking.
- Anthropic Message Batch rows with `model` and `input` but no `batchId` expose `start`; starting one creates a single-request Message Batch and persists the returned batch ID for subsequent tracking.
- Capability arrays should only contain known Agent Monitor action IDs and should not contain duplicates.
- The API should reject unknown action IDs before dispatching to providers.
- The API should reject direct action requests that are not listed in an agent's advertised `capabilities`.
- The API should reject non-start lifecycle actions for terminal statuses such as `ended`, `completed`, `succeeded`, `failed`, `cancelled`, or `expired`, while preserving `go-to` surface actions.
- The API should reject provider action responses that do not confirm the updated target agent.
- The browser app should surface accepted and rejected action results to the operator.
- Widgets should surface action results and should not apply local fallback mutations when a reachable API rejects an action.
- Prompt-based lifecycle actions should not dispatch if the operator cancels the prompt dialog.
- Destructive lifecycle actions should not dispatch if the operator cancels the confirmation dialog.
- Action history records should include agent provider, source, type, and action kind so multi-source lifecycle and surface actions are auditable.

Status: implemented for local process, remote HTTP, OpenAI Responses, and Anthropic Message Batches adapters. Smoke tests assert that account-backed tracked objects do not advertise unsupported `start` actions, that launchable OpenAI Response rows do advertise `start`, call the Responses create endpoint, and persist the created response ID, that launchable Anthropic Message Batch rows do advertise `start`, call the Message Batch create endpoint, and persist the created batch ID, that optional Anthropic recent-batch discovery lists account batches and routes cancel-style actions for discovered batches, that the API returns `400` for unknown actions, `404` for stale requests against missing agents, and `409` for unsupported direct action requests, including non-start lifecycle actions against terminal agents, and that the standalone widget does not locally apply rejected API actions. Action responses include refreshed agents, history, provider status, sanitized config, and scanner status so app/widget provider-health context stays current, including rejected requests. Accepted action feedback includes refreshed target status and provider context when available. The browser app exposes controls in both the task table and selected-agent inspector, while the module widget and standalone widget render compact controls. All surfaces render action feedback messages and explanatory disabled-action titles, including when providers did not advertise lifecycle capabilities; prompt cancellation prevents prompt-based actions from dispatching, destructive actions require confirmation, and provider-specific terminal statuses are treated as terminal. Snapshot boundaries filter capabilities to known unique action IDs.

Reliability note: provider-backed actions that do not return an updated agent, or return an updated agent with a different ID than the action target, are treated as provider errors and are not recorded as successful lifecycle history. Remote HTTP adapters accept `{ "agents": [...] }` or a bare array for list responses, and `{ "agent": {...} }`, a bare updated agent object, or `{ "agents": [...] }` for action responses.

Surface-action note: URL-backed `go-to` is treated as a navigation surface action. Direct API `go-to` calls for remote HTTP, OpenAI Responses, and Anthropic Message Batches return the current tracked agent without calling provider mutation or cancel endpoints.

API reliability note: malformed JSON request bodies return `400` with `Invalid JSON`, so clients and widgets can distinguish bad operator/client input from server failures.

Provider failure note: provider action exceptions return `502` with refreshed agents, history, provider status, sanitized config, and scanner status. Local configured-agent `start` waits for the child-process spawn result; missing executables or other immediate spawn failures return a provider error and are not recorded as successful lifecycle history. Running configured local agents do not advertise duplicate `start`, so direct duplicate starts are rejected by the API capability gate. Local starts use the private configured agent row so saved environment variables are passed to spawned commands without exposing them in public config or agent snapshots.

History status: action history records include provider, provider ID, source, type, and `actionKind` metadata. Existing persisted history without those fields is normalized with empty metadata fields on read, and legacy IDs, timestamps, labels, prompts, action kinds, and agent/provider metadata are coerced into stable API-safe values. The browser app and both widget variants label lifecycle versus surface history so `go-to` navigation does not appear as a mutating lifecycle control.

### Local Process Resource Accounting

Local process resources should represent the work owned by the agent, not only the wrapper process.

- `cpu` and `memoryMb` are aggregate values for the matched process plus descendants.
- `processCpu` and `processMemoryMb` represent the matched process only.
- `childCpu` and `childMemoryMb` represent descendant child processes.
- `childPids` includes descendant process IDs, not only direct children.

Status: implemented for the local process provider and rendered in the app, module widget, and standalone widget. Smoke tests cover aggregate own/child resource accounting.

Remote provider note: the HTTP adapter preserves provider-reported process-resource breakdown fields so remote/cloud agents can use the same UI model when those metrics are available.

Progress note: remote providers may report `currentStep` and `progressPercent`; normalized snapshots preserve them, app/widget resource lines display them, and the selected-agent inspector has a task card for task/progress details.

Context note: remote providers may report `owner`, `workspace`, `repository`, `branch`, `queue`, and `priority`; the HTTP adapter preserves them, the selected-agent inspector shows them in a context card, and embedded widgets show a compact context line on each agent card.

Provider-object note: provider adapters may report provider-native object metadata such as `remoteId`, `model`, `requestCounts`, `goToKind`, and `windowTitle`; the selected-agent inspector and embedded widgets summarize those fields so account-backed and remote/cloud agents remain inspectable as provider objects, not only normalized tasks. Remote HTTP, browser-client, standalone-widget, and persisted-state normalization preserve string IDs/models and finite numeric request-count fields.

Detail freshness note: the browser app rebuilds the selected-agent detail from each refreshed snapshot so action results and polling updates do not leave the inspector showing stale status, history, lineage, or metrics.

Stale-detail note: `GET /api/agents/:id` returns `404` with refreshed agents, history, provider status, sanitized config, and scanner status when the requested agent no longer exists. The browser client applies that payload so manual detail refreshes reconcile against current provider state instead of retaining a stale selection.

Lineage note: the browser app and widgets resolve known parent/child agent IDs into display names where the current snapshot includes those agents, falling back to IDs when the related agent is absent. The selected-agent inspector preserves unresolved parent and child IDs instead of dropping those relationships.

Lineage normalization note: `parentId` and `children` are normalized as string IDs at provider, registry, persisted-state, and client snapshot boundaries so cross-provider lineage joins are stable even when a provider reports numeric IDs.

Embedded-widget note: module and standalone widgets render compact provider/source health, active-discovery scanner status, active provider-status counts, and unified snapshot freshness from the unified snapshot so embeds show adapter issues, discovery state, pressure, and last update time without opening the full app. Widget cards are ordered by task pressure: status, priority, CPU, start time, then name.

Standalone-widget normalization note: the standalone embed normalizes incoming API/fallback snapshots for numeric metrics, token confidence, process IDs, lineage IDs, capabilities, logs, and transcripts before sorting or rendering, preserving stable behavior when embedded on static personal sites. It observes `api-base`, `api-token`, `auth-header`, and `refresh-ms` changes after mount so host pages can reconfigure it without remounting.

Standalone-widget fallback note: local fallback lifecycle actions update runtime/resource fields consistently with the core lifecycle model and record history with agent, provider, source, type, and action metadata.

Spend note: module and standalone widgets include nonzero `costUsd` in the compact resource line so embedded views retain token/cost task-manager context.

Cost note: normalized snapshots coerce `costUsd` to a number on persisted-state reads, API/client cloning, and UI summary totals so spend sorting and totals are stable even when providers report numeric strings.

Resource note: normalized snapshots coerce CPU and memory resource fields to finite numbers on persisted-state reads, remote HTTP adapter responses, and client clones so meters, summaries, and sorting do not receive `NaN` or string values.

Timestamp note: the remote HTTP adapter accepts numeric millisecond timestamps and parseable date strings for agent `startedAt`/`endedAt`, log `at`, and transcript `at` fields, normalizing them to milliseconds before rendering runtime, sorting, or timelines.

Client/persistence note: client snapshots and persisted state also normalize token metrics, token confidence, and log/transcript timestamps so legacy API responses or older state files cannot leak `NaN` values into task sorting or timelines. App and widget timestamp/runtime formatters render unknown values explicitly instead of surfacing `NaN` or `Invalid Date`.

Process ID note: remote HTTP adapter responses and client snapshots normalize `pid`, `parentPid`, and `childPids` to finite numbers, dropping invalid child PID entries so process lineage displays have a stable shape.

### Local Process Tree Controls

Local lifecycle controls should target the process tree that represents the agent.

- `stop`, `interrupt`, and `end` send `SIGTERM` to descendant processes before the root process.
- `force-end` sends `SIGKILL` to descendant processes before the root process.
- Signaling descendants first gives child workers a chance to exit before their parent is terminated.

Status: implemented for the local process provider. Smoke tests cover child-before-root PID ordering for nested process trees, configured local start/force-end, private env propagation into spawned commands, and duplicate-start rejection while a configured local agent is already running.

End-to-end coverage:

- Smoke tests configure a long-running local agent command.
- Smoke tests start that configured local agent through `/api/agents/:id/actions`.
- Smoke tests verify the started agent reports `running` with a PID and records history.
- Smoke tests force-end the configured local agent and verify history.

### Transcripts

Agents should expose recent conversation turns separately from operational logs.

Status: implemented for state-backed agents, remote HTTP provider payloads, and best-effort OpenAI Responses output text. The selected-agent detail panel shows recent transcript turns, and smoke tests verify transcript persistence.

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
  "currentStep": "Running tests",
  "progressPercent": 42,
  "tokens": 18420,
  "tokensPerSecond": 12.4,
  "tokenRateWindowMs": 15000,
  "tokenCountConfidence": "observed",
  "processCpu": 4.2,
  "processMemoryMb": 188,
  "childCpu": 8.2,
  "childMemoryMb": 624,
  "goToKind": "terminal",
  "goToTarget": "pid:12345",
  "pid": 12345,
  "parentPid": 1000,
  "childPids": []
}
```

## Near-Term Implementation Plan

1. Improve platform-specific Go To targeting for terminal tabs, browser tabs, and editor workspaces where documented automation APIs are available.
2. Add broader provider-specific start/resume/listing flows where APIs expose them; OpenAI Responses remain configured-row based unless an account listing endpoint becomes available.
3. Add richer live/incremental usage sampling when account providers expose streaming or partial telemetry.
4. Add optional richer desktop packaging, such as signed/notarized builds or a first-run setup flow.
5. Add optional hosted relay/companion extension designs if browser localhost restrictions become a real deployment blocker.
