# Agent Monitor

Agent Monitor is a local-first task manager for AI agents. This first slice runs as a plain browser app and as an embeddable web component widget with no build step.

## Run locally

```sh
npm run start
```

Then open:

- App: http://localhost:5173/
- Widget demo: http://localhost:5173/embed.html

You can also serve the directory with any static file server.

## Embed on another site

```html
<agent-monitor-widget></agent-monitor-widget>
<script type="module" src="/path/to/agent-monitor/src/widget.js"></script>
```

The widget currently uses the same local mock provider as the app. The provider boundary is in `src/core.js`; that is where OpenAI, Anthropic, local process, and cloud agent adapters should plug in.

## Current capability

- Track agents from multiple provider namespaces.
- Show status, provider, parent/child relationships, resource usage, spend, and runtime.
- Start, stop, interrupt with prompt, end with prompt, and force end agents.
- Run as a full browser app or embedded widget.

## Next backend milestones

1. Add a small local API service for real process/resource inspection.
2. Define provider adapters for OpenAI, Anthropic, local agents, and remote cloud agents.
3. Persist action history and agent snapshots.
4. Add GitHub repository remote once credentials and repo name are available.
