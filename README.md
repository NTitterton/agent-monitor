# Agent Monitor

Agent Monitor is a local-first task manager for AI agents. It runs as a browser app, exposes a small local HTTP API, and also ships an embeddable web component widget.

## Run locally

```sh
npm run start
```

Then open:

- App: http://localhost:5173/
- Widget demo: http://localhost:5173/embed.html

The default server binds to `127.0.0.1` and serves both static files and API routes. You can change the port with `PORT=5180 npm run start`.

For a static-only preview without API routes:

```sh
npm run static
```

## Verify

```sh
npm run check
npm run smoke
```

`npm run smoke` starts Agent Monitor on a temporary port with isolated config and state files. It verifies static routes, API auth, CORS preflight, lifecycle actions, and state persistence across a server restart.

## Push to GitHub

```sh
gh auth login -h github.com
npm run github:push
```

`npm run github:push` expects a clean tracked worktree, creates or attaches `origin`, and pushes `main`. Defaults are `GITHUB_REPO=agent-monitor` and `GITHUB_VISIBILITY=private`.

## Run as a standalone macOS app

```sh
npm run desktop:build
open "dist/Agent Monitor.app"
```

The desktop app is a native macOS WebKit wrapper. It starts the local Agent Monitor Node server from this project directory and loads the app in its own window. Node must be available on the machine running the app. `npm run desktop:build` also verifies the generated `.app` bundle, executable, plist, and PkgInfo.

To create a shareable zip of the verified app bundle:

```sh
npm run desktop:package
```

This writes `dist/Agent Monitor.zip`.

## Embed on another site

For personal sites, use the standalone widget script:

```html
<agent-monitor-widget api-base="http://127.0.0.1:5173"></agent-monitor-widget>
<script src="/agent-monitor-widget.js"></script>
```

Host `embed/agent-monitor-widget.js` wherever the site serves static assets. The `api-base` attribute should point at the Agent Monitor server that exposes `/api/snapshot` and `/api/agents/:id/actions`. If `api-base` is omitted or unreachable, the widget stays interactive with local fallback data. The standalone widget also falls back to the older `/api/agents` snapshot shape for compatibility with older local servers.

For cross-site embeds, add the site origins that may call the local API:

```json
{
  "apiToken": "replace-with-a-long-random-token",
  "allowedOrigins": [
    "https://zo.computer",
    "https://your-personal-site.example"
  ]
}
```

`allowedOrigins` and `apiToken` are read from `agent-monitor.config.json`. API routes answer CORS preflight requests for trusted origins. When `apiToken` is set, cross-origin widget requests must include the same token:

```html
<agent-monitor-widget
  api-base="http://127.0.0.1:5173"
  api-token="replace-with-a-long-random-token"
></agent-monitor-widget>
```

Same-origin local app requests continue to work without putting the token into `index.html`.

The app sidebar includes a Settings panel for trusted origins, local discovery include/exclude patterns, snapshot refresh cadence, remote HTTP providers, OpenAI Responses, and Anthropic Message Batches. It writes through the local API, surfaces non-blocking validation warnings, and does not expose configured API tokens or provider credentials.

When snapshot refresh is enabled, the browser app polls at the configured interval and the local server runs a matching background scanner. Scanner status is available in the Sources panel and at `GET /api/scanner`.

Local standalone embed demo:

- http://localhost:5173/embed-standalone.html

Repo-module widget demo:

```html
<agent-monitor-widget></agent-monitor-widget>
<script type="module" src="/path/to/agent-monitor/src/widget.js"></script>
```

The module widget uses the same client as the browser app, so it reads from the local API when Agent Monitor is running and falls back to local demo state when it is embedded without the API.

When the widget is served from Agent Monitor's local server, lifecycle actions use the HTTP API and refresh through `/api/snapshot`. When embedded from static hosting without the API, it falls back to local in-memory state so the component still renders and remains interactive. The app and widgets escape provider-supplied text/attributes and show lifecycle action feedback; if the API is reachable but rejects an action, the standalone widget leaves its current state unchanged instead of applying a local fallback action and shows the rejection message in the widget.

Embedded widgets show compact provider/source health from `/api/snapshot`, including provider count, source count, and provider issue count when an adapter is failing.

## Local API

- `GET /api/snapshot` returns agents, recent history, provider status, and sanitized config in one response. The browser app uses this as its primary refresh path.
- `GET /api/scanner` returns server-side background scanner status.
- `GET /api/agents` returns the current agent snapshot. Agents include `scannedAt` when they came from a provider snapshot.
- `GET /api/providers` returns configured provider adapters, lifecycle capabilities, and `scannedAt` freshness metadata.
- `POST /api/providers/:id/test` runs one provider snapshot check and returns that provider's health.
- `GET /api/history` returns recent lifecycle actions.
- `GET /api/config` returns non-secret setup fields for the local UI.
- `PUT /api/config` updates trusted origins, local discovery settings, remote HTTP providers, OpenAI Responses, and Anthropic Message Batches while preserving existing provider credentials.
- `POST /api/agents/:id/actions` accepts `{ "action": "start|stop|interrupt|end|force-end|go-to", "prompt": "optional text" }`. Action responses include refreshed agents, history, provider status, sanitized config, and scanner status. Unknown action IDs return `400`; valid actions outside the target agent's `capabilities` return `409`.

Provider snapshots are reused for a short window so app refreshes and paired legacy calls to `/api/agents` plus `/api/providers` do not rescan every adapter twice. The default cache window is 1000 ms and can be changed with `AGENT_MONITOR_SCAN_CACHE_MS`.

Provider adapters live in `server/providerRegistry.js`. The current adapters are in-memory implementations for local, OpenAI, Anthropic, and remote cloud namespaces. Real integrations should implement the same shape:

```js
{
  id,
  label,
  source,
  capabilities,
  async listAgents() {},
  async performAction(agentId, actionId, prompt) {}
}
```

Agent-level `capabilities` should only include actions the provider can actually perform. The app disables unsupported controls, and the local API validates action IDs before enforcing capabilities. Unknown action IDs return `400`; direct action requests that are not in an agent's advertised capabilities return `409`. Configured local agents expose `start` because Agent Monitor can launch their commands. Remote HTTP agents may expose `start` when the remote service supports it. OpenAI Responses and Anthropic Message Batches currently expose cancel-style lifecycle actions plus optional `go-to` links, but do not expose `start` for already-created tracked objects.

Disabled action buttons include a title explaining why the action is unavailable, including unsupported `Go To` targets and lifecycle actions that do not apply to the agent's current status.

## Monitor local processes

Copy `agent-monitor.config.example.json` to `agent-monitor.config.json` and add local commands to monitor:

```json
{
  "localAgents": [
    {
      "id": "local-codex",
      "name": "Local Codex",
      "command": "codex",
      "match": "codex",
      "cwd": "."
    }
  ]
}
```

When this file exists, Agent Monitor adds a `local-process` provider. It reads PID, parent PID, descendant child PIDs, CPU, memory, command, and start time from `ps`. `cpu` and `memoryMb` include the matched process plus descendant child processes; `processCpu`/`processMemoryMb` and `childCpu`/`childMemoryMb` expose the breakdown. `start` launches the configured command. `stop`, `interrupt`, and `end` send `SIGTERM` to the process tree; `force-end` sends `SIGKILL` to the process tree.

Agent Monitor also actively discovers known local agent CLI processes even when they are not listed in `localAgents`. Discovery is enabled by default and currently looks for common agent tools such as Codex, Claude, Gemini, Aider, Goose, OpenCode, Cursor Agent, and Amp.

Configured local agents can be edited from the app Settings panel. Saved local agent environment variables are not returned by `GET /api/config`; leaving the env field blank preserves an existing env map for that local agent ID.

```json
{
  "localDiscovery": {
    "enabled": true,
    "include": ["my-custom-agent"],
    "exclude": ["experimental-agent"]
  }
}
```

Discovered agents are shown with PID, PPID, child process count, scan freshness, and resource usage. When two monitored local agents are related by OS parent process ID, Agent Monitor links them in the lineage tree. Lifecycle stop/end actions signal the discovered process by PID; `start` is only available for explicitly configured `localAgents`. On macOS, the `Go To` action activates the likely local surface for discovered terminal, browser, or editor-backed processes.

## Connect remote HTTP providers

Add remote providers to `agent-monitor.config.json`:

```json
{
  "remoteHttpProviders": [
    {
      "id": "remote-runner",
      "label": "Remote Runner",
      "source": "cloud",
      "baseUrl": "https://agents.example.com/api",
      "token": "replace-me"
    }
  ]
}
```

Agent Monitor calls:

- `GET {baseUrl}/agents`
- `POST {baseUrl}/agents/:id/actions`

`GET /agents` should return `{ "agents": [...] }`. Each agent can include `id`, `name`, `type`, `status`, `task`, `cpu`, `memoryMb`, `processCpu`, `processMemoryMb`, `childCpu`, `childMemoryMb`, `tokens`, `tokensPerSecond`, `tokenRateWindowMs`, `tokenCountConfidence`, `costUsd`, `startedAt`, `endedAt`, `parentId`, `children`, `pid`, `parentPid`, `childPids`, `goToTarget`, `goToKind`, and `windowTitle`. Remote adapters preserve the process-resource breakdown fields when providers report them.

Use `tokenCountConfidence` to distinguish provider-reported totals from rough or unknown counts. Accepted values are `observed`, `estimated`, `reported`, and `unknown`.

Use `goToTarget` with `goToKind: "url"` to enable browser-side `Go To` for remote dashboards, provider consoles, or hosted agent pages.

Agents may also include a `logs` array for recent provider, process, transcript, or operator events:

```json
{
  "logs": [
    {
      "at": 1781648578000,
      "level": "info",
      "source": "remote-runner",
      "message": "Fetched branch and started tests."
    }
  ]
}
```

Agents may also include a `transcript` array for recent conversation turns:

```json
{
  "transcript": [
    {
      "at": 1781648578000,
      "role": "assistant",
      "source": "remote",
      "content": "Validated the hosted widget."
    }
  ]
}
```

Action requests receive:

```json
{ "action": "interrupt", "prompt": "optional operator prompt" }
```

Remote provider setup can be edited from the app Settings panel. Saved provider tokens are not returned by `GET /api/config`; leaving the token field blank preserves an existing token for that provider ID.

The response may return `{ "agent": {...} }` or `{ "agents": [...] }`. Provider health is surfaced through `GET /api/providers`; a failing remote provider is shown in the Sources panel without breaking other providers.

## Track OpenAI Responses

Agent Monitor can observe configured OpenAI Responses by ID:

```json
{
  "openAIResponsesProviders": [
    {
      "id": "openai-responses",
      "label": "OpenAI Responses",
      "apiKeyEnv": "OPENAI_API_KEY",
      "responses": [
        {
          "id": "openai-response-example",
          "name": "OpenAI Background Response",
          "responseId": "resp_replace_me",
          "task": "Tracked OpenAI response"
        }
      ]
    }
  ]
}
```

The adapter uses OpenAI's Responses API retrieve and cancel endpoints. It maps response status, model, token usage, and creation time into Agent Monitor's task-manager view. Lifecycle actions that terminate work call the cancel endpoint for the configured response. Already-created Responses do not expose a provider-backed `start` action.

OpenAI Responses setup can be edited from the app Settings panel. Saved API keys are not returned by `GET /api/config`; leaving the API key field blank preserves the existing key for that provider ID. Tracked response rows accept `id | name | responseId | task | goToUrl`; the URL is optional.

## Track Anthropic Message Batches

Agent Monitor can also observe configured Anthropic Message Batch IDs:

```json
{
  "anthropicMessageBatchesProviders": [
    {
      "id": "anthropic-batches",
      "label": "Anthropic Message Batches",
      "apiKeyEnv": "ANTHROPIC_API_KEY",
      "batches": [
        {
          "id": "anthropic-batch-example",
          "name": "Anthropic Batch",
          "batchId": "msgbatch_replace_me",
          "task": "Tracked Anthropic message batch"
        }
      ]
    }
  ]
}
```

The adapter uses Anthropic's Message Batch retrieve and cancel endpoints. It maps processing status and request counts into Agent Monitor's task-manager view. Already-created Message Batches do not expose a provider-backed `start` action.

Anthropic Message Batch setup can be edited from the app Settings panel. Saved API keys are not returned by `GET /api/config`; leaving the API key field blank preserves the existing key for that provider ID. Tracked batch rows accept `id | name | batchId | task | goToUrl`; the URL is optional.

## Current capability

- Track agents from multiple provider namespaces.
- Classify every agent with a stable `type` such as `local`, `openai`, `anthropic`, or a third-party provider slug.
- Show status, provider, parent/child relationships, process lineage, resource usage, spend, runtime, recent logs, and recent transcript turns.
- Show named parent/child lineage in the browser app and embedded widgets.
- Show compact provider/source health in embedded widgets.
- Start, stop, interrupt with prompt, end with prompt, and force end agents.
- Run as a full browser app or embedded widget.
- Use a local API when available, with static fallback for hosted embeds.
- Configure trusted embed origins, configured local agents, local discovery, remote HTTP providers, OpenAI Responses, and Anthropic Message Batches from the app.
- Surface setup validation warnings without exposing saved secrets.
- Configure optional browser-app auto refresh cadence from the app; embeddable widgets can set `refresh-ms`.
- Test configured provider connections from the Sources panel.
- Persist local server state and recent action history under `data/`.
- Persist per-agent logs and transcripts for state-backed agents.
- Optionally monitor configured local processes with PID, PPID, descendant child PIDs, aggregate/own/child CPU and memory, and process-tree signals.
- Actively discover known local agent CLI processes.
- Observe configured OpenAI Responses by response ID.
- Observe configured Anthropic Message Batches by batch ID.

## Next backend milestones

1. Add real provider-specific start/resume creation flows where APIs expose them.
