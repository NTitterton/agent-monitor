# Decisions

## Local-first runtime

Agent Monitor uses a small Node HTTP server rather than a hosted backend. This keeps local agent monitoring and desktop usage straightforward.

## Desktop wrapper

The desktop app uses native macOS Swift + WebKit instead of Electron. This avoids a large dependency tree while preserving a real standalone app window.

## Provider abstraction

Provider adapters expose `listAgents()` and `performAction(...)`. This keeps local processes, remote HTTP services, and future OpenAI/Anthropic integrations behind the same task-manager surface.

## State persistence

Local state persists to `data/agent-state.json`. Tests can override this with `AGENT_MONITOR_STATE` to avoid touching runtime data.

## Embed security

Cross-site widgets require configured origins, and optional `apiToken` protects cross-origin API calls. Same-origin local app requests remain frictionless.
