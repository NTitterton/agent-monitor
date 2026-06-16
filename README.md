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

## Run as a standalone macOS app

```sh
npm run desktop:build
open "dist/Agent Monitor.app"
```

The desktop app is a native macOS WebKit wrapper. It starts the local Agent Monitor Node server from this project directory and loads the app in its own window. Node must be available on the machine running the app.

## Embed on another site

For personal sites, use the standalone widget script:

```html
<agent-monitor-widget api-base="http://127.0.0.1:5173"></agent-monitor-widget>
<script src="/agent-monitor-widget.js"></script>
```

Host `embed/agent-monitor-widget.js` wherever the site serves static assets. The `api-base` attribute should point at the Agent Monitor server that exposes `/api/agents` and `/api/agents/:id/actions`. If `api-base` is omitted or unreachable, the widget stays interactive with local fallback data.

For cross-site embeds, add the site origins that may call the local API:

```json
{
  "allowedOrigins": [
    "https://zo.computer",
    "https://your-personal-site.example"
  ]
}
```

`allowedOrigins` is read from `agent-monitor.config.json`. API routes answer CORS preflight requests for trusted origins.

Local standalone embed demo:

- http://localhost:5173/embed-standalone.html

Repo-module widget demo:

```html
<agent-monitor-widget></agent-monitor-widget>
<script type="module" src="/path/to/agent-monitor/src/widget.js"></script>
```

The widget currently uses the same local mock provider as the app. The provider boundary is in `src/core.js`; that is where OpenAI, Anthropic, local process, and cloud agent adapters should plug in.

When the widget is served from Agent Monitor's local server, lifecycle actions use the HTTP API. When embedded from static hosting without the API, it falls back to local in-memory state so the component still renders and remains interactive.

## Local API

- `GET /api/agents` returns the current agent snapshot.
- `GET /api/providers` returns configured provider adapters and lifecycle capabilities.
- `GET /api/history` returns recent lifecycle actions.
- `POST /api/agents/:id/actions` accepts `{ "action": "start|stop|interrupt|end|force-end", "prompt": "optional text" }`.

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

When this file exists, Agent Monitor adds a `local-process` provider. It reads PID, CPU, memory, command, and start time from `ps`. `start` launches the configured command. `stop`, `interrupt`, and `end` send `SIGTERM`; `force-end` sends `SIGKILL`.

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

`GET /agents` should return `{ "agents": [...] }`. Each agent can include `id`, `name`, `status`, `task`, `cpu`, `memoryMb`, `tokens`, `costUsd`, `startedAt`, `endedAt`, `parentId`, and `children`.

Action requests receive:

```json
{ "action": "interrupt", "prompt": "optional operator prompt" }
```

The response may return `{ "agent": {...} }` or `{ "agents": [...] }`. Provider health is surfaced through `GET /api/providers`; a failing remote provider is shown in the Sources panel without breaking other providers.

## Current capability

- Track agents from multiple provider namespaces.
- Show status, provider, parent/child relationships, resource usage, spend, and runtime.
- Start, stop, interrupt with prompt, end with prompt, and force end agents.
- Run as a full browser app or embedded widget.
- Use a local API when available, with static fallback for hosted embeds.
- Persist local server state and recent action history under `data/`.
- Optionally monitor configured local processes with PID, CPU, memory, and process signals.

## Next backend milestones

1. Replace in-memory adapters with real local process/resource inspection.
2. Add authenticated OpenAI, Anthropic, and remote cloud provider adapters.
3. Add richer per-agent logs, process metadata, and provider health checks.
4. Add GitHub repository remote once `gh auth login -h github.com` has refreshed credentials.
