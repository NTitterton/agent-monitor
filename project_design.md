# Project Design: Agent Monitor

Agent Monitor is a local-first task manager for AI agents. The core goals are: 1. run as a standalone desktop app, browser web app, or embeddable widget; 2. integrate agents from local processes, personal provider accounts, and remote/cloud systems; 3. let operators inspect agent state, resource usage, and parent/child relationships; 4. expose task-manager lifecycle controls: start, stop, interrupt with prompt, end with prompt, and force end; 5. keep the project in `~/agent-monitor/` with git and a GitHub remote.

## 1. System Design Diagram

```mermaid
graph TD
    subgraph "Operator Surfaces"
        Desktop["macOS Desktop App<br/>WebKit wrapper"]
        Browser["Browser App<br/>index.html"]
        ModuleWidget["Repo Module Widget<br/>src/widget.js"]
        StandaloneWidget["Standalone Embed Widget<br/>embed/agent-monitor-widget.js"]
    end

    subgraph "Local Agent Monitor Runtime"
        StaticServer["Node HTTP Server<br/>server/index.js"]
        API["Local HTTP API<br/>/api/snapshot, /api/agents, /api/providers"]
        Scanner["Background Scanner<br/>server/backgroundScanner.js"]
        Registry["Provider Registry<br/>server/providerRegistry.js"]
        StateStore[("State Store<br/>data/agent-state.json")]
        Config[("Local Config<br/>agent-monitor.config.json")]
    end

    subgraph "Provider Adapters"
        SeedProviders["Seed Providers<br/>local/openai/anthropic/remote"]
        LocalProcess["Local Process Provider<br/>ps + process signals"]
        RemoteHTTP["Remote HTTP Provider<br/>configured baseUrl"]
        OpenAIResponses["OpenAI Responses Provider<br/>tracked + launchable rows"]
        AnthropicBatches["Anthropic Message Batches Provider<br/>tracked + launchable rows"]
    end

    subgraph "External Agent Systems"
        LocalAgents["Local CLIs / Agent Processes"]
        OpenAI["OpenAI Account Agents"]
        Anthropic["Anthropic Account Agents"]
        CloudAgents["Remote / Cloud Agent Services"]
    end

    Desktop --> StaticServer
    Browser --> StaticServer
    ModuleWidget --> API
    StandaloneWidget -- "CORS + optional token" --> API
    StaticServer --> API
    StaticServer --> Scanner
    API --> Registry
    Scanner --> Registry
    Registry --> StateStore
    Registry --> Config
    Registry --> SeedProviders
    Registry --> LocalProcess
    Registry --> RemoteHTTP
    Registry --> OpenAIResponses
    Registry --> AnthropicBatches
    LocalProcess --> LocalAgents
    RemoteHTTP --> CloudAgents
    OpenAIResponses --> OpenAI
    AnthropicBatches --> Anthropic

    classDef surface fill:#f9f,stroke:#333,stroke-width:2px;
    classDef runtime fill:#DDEBFF,stroke:#2E73B8,stroke-width:2px;
    classDef store fill:#2E73B8,stroke:#000,stroke-width:2px,color:#fff;
    classDef provider fill:#E8F5E9,stroke:#2E7D32,stroke-width:2px;
    classDef external fill:#EEE,stroke:#666,stroke-width:2px;
    class Desktop,Browser,ModuleWidget,StandaloneWidget surface;
    class StaticServer,API,Scanner,Registry runtime;
    class StateStore,Config store;
    class SeedProviders,LocalProcess,RemoteHTTP,OpenAIResponses,AnthropicBatches provider;
    class LocalAgents,OpenAI,Anthropic,CloudAgents external;
```

## 2. Requirements

### Functional Requirements

- **Run modes:** Agent Monitor must run as a local desktop app, local browser app, and embeddable widget.
- **Multiple sources:** It must integrate local agents, agents in personal provider accounts, and remote/cloud agents.
- **Lifecycle control:** Operators must be able to start, stop, interrupt with prompt, end with prompt, and force end agents.
- **Task-manager data:** The UI must show status, provider, type, runtime, CPU, memory, token/cost usage, token throughput, confidence, parent/child relationships, process metadata, logs, transcripts, and recent lifecycle actions.
- **Embeddability:** A standalone widget must be hostable on external sites and able to call the local API through trusted-origin CORS plus an optional API token.
- **Persistence:** Agent snapshots and action history should survive local server restarts.
- **Repository:** The project lives at `~/agent-monitor/`, is tracked with git, and is pushed to the public GitHub repo at `https://github.com/NTitterton/agent-monitor`.

### Non-Functional Requirements

- **Local-first:** The app should work without a hosted backend for local monitoring.
- **Provider-extensible:** New provider integrations should plug into a small adapter contract.
- **Safe-by-default:** Cross-origin API access should be explicitly allowed by config and optionally token-gated.
- **Untrusted-provider rendering:** App and widget surfaces should escape provider-supplied text and attributes before rendering HTML.
- **Embeddable with low ceremony:** The standalone widget should work from a single script tag.
- **Testable:** Verification should be scriptable and isolated from the operator's real local state.

## 3. High-Level Design

Agent Monitor is a static web UI plus a small Node local API. The API serves the app, exposes agent/task endpoints, performs lifecycle actions through provider adapters, and persists state in a local JSON file. The desktop app is a native macOS WebKit wrapper that starts the same local Node server and opens the web UI in its own window. Its build verifier can run the compiled wrapper in a headless self-test mode that starts a temporary local server and verifies `/api/health`.

The system has four major layers:

- **Surfaces:** desktop app, browser app, module widget, and standalone widget.
- **Local API:** static file server, API router, CORS/auth handling, and JSON response helpers.
- **Provider registry:** discovers configured providers, normalizes agent snapshots, caches scans, records lifecycle history, validates lifecycle actions, and routes supported actions.
- **Background scanner:** optionally refreshes provider snapshots on the configured cadence so task-manager state stays warm even when the UI is idle.
- **Provider adapters:** seed adapters, local process adapter, remote HTTP adapter, configured OpenAI Responses observer, and configured Anthropic Message Batches observer.

## 4. Core Data Flow

```mermaid
sequenceDiagram
    participant UI as App or Widget
    participant API as Local HTTP API
    participant Registry as Provider Registry
    participant Provider as Provider Adapter
    participant Store as State Store

    UI->>API: GET /api/snapshot
    API->>Registry: listAgents() + providers()
    Registry->>Provider: listAgents()
    Provider-->>Registry: normalized agent snapshots
    Registry->>Store: listHistory()
    Store-->>Registry: recent actions
    Registry-->>API: agents + providers + history
    API-->>UI: JSON snapshot + sanitized config

    UI->>API: POST /api/agents/:id/actions
    API->>Registry: validate + performAction(id, action, prompt)
    alt invalid or unsupported action
        Registry-->>API: 400 Invalid action or 409 Action not supported
        API-->>UI: error + current snapshot
    else supported action
    Registry->>Provider: performAction(...)
    Provider-->>Registry: updated agent
    Registry->>Store: record action / persist state
    Registry-->>API: refreshed agents + history
    API-->>UI: JSON snapshot
    end
```

## 5. Provider Adapter Contract

Provider adapters are objects with this shape:

```js
{
  id,
  label,
  source,
  capabilities,
  recordsHistory,
  async listAgents() {},
  async performAction(agentId, actionId, prompt) {}
}
```

Adapters should return normalized agent objects with:

- `id`
- `name`
- `provider`
- `providerId`
- `source`
- `type`
- `status`
- `parentId`
- `task`
- `cpu`
- `memoryMb`
- `processCpu`
- `processMemoryMb`
- `childCpu`
- `childMemoryMb`
- `tokens`
- `tokensPerSecond`
- `tokenRateWindowMs`
- `tokenCountConfidence`
- `costUsd`
- `startedAt`
- `endedAt`
- `children`
- `pid`
- `parentPid`
- `childPids`
- `goToTarget`
- `goToKind`
- `capabilities`
- `logs`
- `transcript`

Capabilities are part of the action contract. Snapshot boundaries normalize capability arrays to known unique action IDs. Unknown action IDs are rejected with `400`. Valid actions outside the target agent's advertised capabilities are rejected with `409`. Provider action responses must confirm the same target agent ID before Agent Monitor records lifecycle history.

## 6. Lifecycle Actions

```mermaid
stateDiagram-v2
    [*] --> waiting
    waiting --> running: start
    paused --> running: start
    ended --> running: start
    running --> paused: stop
    running --> waiting: interrupt(prompt)
    paused --> waiting: interrupt(prompt)
    running --> ended: end(prompt)
    paused --> ended: end(prompt)
    waiting --> ended: end(prompt)
    running --> ended: force-end
    paused --> ended: force-end
    waiting --> ended: force-end
```

## 7. Local Process Provider

The local process provider is configured through `agent-monitor.config.json`. It uses `ps` snapshots for PID, parent PID, descendant child PIDs, CPU, memory, command, and start time. It can start configured commands while they are stopped, passes private configured environment variables into spawned processes without returning those env values in public config or snapshots, and sends process-tree signals for termination:

- `stop`, `interrupt`, `end`: `SIGTERM`
- `force-end`: `SIGKILL`

Resource totals include the matched process plus descendant processes. The normalized agent also carries `processCpu`, `processMemoryMb`, `childCpu`, and `childMemoryMb` breakdown fields. Snapshot normalization coerces these resource values to finite numbers before UI meters and task sorting. Active discovery can detect known agent CLIs even when they are not explicitly configured. On macOS, `go-to` is best-effort and activates likely Terminal, browser, or editor surfaces. When a browser-hosted local process exposes a visible HTTP(S) URL in its command line, Agent Monitor uses that URL as the Go To target instead of only activating the browser app.

## 8. Remote HTTP Provider

Remote HTTP providers are configured by `baseUrl`. Agent Monitor calls:

- `GET {baseUrl}/agents`
- `POST {baseUrl}/agents/:id/actions`

Provider failures are isolated: `/api/providers` reports health and errors, while healthy providers continue returning agents.

Remote agents can expose the same normalized provider/source/type classification, resource, lineage, log, transcript, capability, and `go-to` fields as local agents. The registry trims and falls back provider, provider ID, source, and type metadata before snapshots reach app and widget clients. The adapter preserves provider-reported process breakdown fields, normalizes parent/child lineage IDs to strings, and routes lifecycle actions through the remote action endpoint.

Provider snapshots can either report token throughput directly or only report cumulative tokens. The registry preserves positive provider-reported rates and otherwise derives `tokensPerSecond` from successive fresh snapshots for the same provider/agent ID. Embedded widgets include nonzero `costUsd` beside resource and token metrics so embeds keep spend visible. Snapshot normalization coerces `costUsd` to a number before UI totals and spend sorting.

## 9. OpenAI Responses Provider

The OpenAI Responses provider observes configured response IDs from a user's OpenAI account. It retrieves each response, maps status/model/token usage/output transcript into the normalized agent shape, estimates spend from operator-configured input/output token rates when available, and routes terminating lifecycle actions to OpenAI's cancel response endpoint.

Rows with `model` and `input` but no `responseId` are launchable placeholders. They render as waiting OpenAI agents with `start`; starting one creates a background Response, persists the returned response ID in config, and then tracks the created response through the normal retrieval path.

This is an observer/control/launch adapter for configured rows, not a full account crawler. It avoids guessing at private account state that the API does not expose as an agent task list. Already-created Responses expose cancel-style capabilities but not `start`.

## 10. Anthropic Message Batches Provider

The Anthropic Message Batches provider observes configured message batch IDs from a user's Anthropic account. When `discoverRecent` is enabled, it also lists recent account Message Batches and normalizes unconfigured batches into stable discovered agents. It retrieves each configured batch, maps processing status and request counts into the normalized agent shape, and routes terminating lifecycle actions to Anthropic's cancel batch endpoint for both configured and discovered batches.

Rows with `model` and `input` but no `batchId` are launchable placeholders. They render as waiting Anthropic agents with `start`; starting one creates a single-request Message Batch, persists the returned batch ID in config, and then tracks the created batch through the normal retrieval path.

This is an observer/control/launch adapter for configured rows plus optional recent-batch account discovery. Already-created Message Batches expose cancel-style capabilities but not `start`.

## 11. Embed Security

Cross-site embeds require explicit `allowedOrigins` configuration. If `apiToken` is configured, cross-origin calls must include either:

- `Authorization: Bearer <token>`
- `X-Agent-Monitor-Token: <token>`

Same-origin local app requests continue working without embedding secrets in `index.html`.

The standalone widget prefers `/api/snapshot`, falls back to the legacy `/api/agents` shape for older local servers, and uses local in-memory fallback only when no API base is configured or the network request fails. If a reachable API rejects an action, the widget leaves its state unchanged.

Both widget implementations preserve the full snapshot for lineage lookups while rendering cards in task-pressure order: active status, provider-reported priority, CPU usage, newest start time, then name.

Hosted personal sites can serve `embed/agent-monitor-widget.js` as a static asset while the browser calls the local Agent Monitor API. `docs/hosted-embed.md` documents the `zo.computer`-style deployment model, CORS/token setup, snippet variants, fallback behavior, browser localhost restrictions, and quick local checks.

## 12. Verification

Verification is currently handled by:

- `npm run check`: JavaScript syntax checks across app, server, widgets, and scripts.
- `npm run smoke`: starts an isolated local server with temporary config/state and verifies static routes, API auth, CORS, snapshot responses, lifecycle actions, action validation, local process start/force-end, provider normalization, per-agent detail, and persistence.
- `npm run desktop:build`: compiles the macOS app wrapper, verifies bundle structure, and runs a compiled-binary local-server self-test.
- `npm run desktop:package`: builds and zips the verified macOS app bundle.

## 13. Known Gaps

- OpenAI integration currently observes configured Responses API IDs; it does not discover all account activity automatically.
- Anthropic integration can discover recent Message Batches when enabled, but does not yet provide a full account activity archive beyond the API's batch listing window.
- Desktop packaging is a local macOS app bundle and zip, not a signed installer.
- Local process control is signal-based and should grow safer start/stop policies and deeper terminal-tab/window targeting.
- Account integrations observe configured OpenAI Response IDs and configured or recently discovered Anthropic Message Batch IDs; broader provider discovery depends on what those APIs expose.
