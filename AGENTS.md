# AGENTS.md

## Project

Agent Monitor is a local-first task manager for AI agents. It should run as a desktop app, browser app, and embeddable widget; integrate local agents, OpenAI/Anthropic account-backed agents, and remote/cloud agents; expose task-manager lifecycle controls; and show resources, lineage, and other task-manager metadata.

## Operating Rules

- Read the current worktree before making assumptions. Treat local files and command output as authoritative.
- Keep changes scoped to the active request and the Agent Monitor goal.
- Do not overwrite or revert user changes unless explicitly asked.
- Preserve unrelated local files and dirty worktree changes.
- Prefer existing repo patterns over new abstractions.
- Use `rg` or `rg --files` for search.
- Use `apply_patch` for manual file edits.

## Project Documentation

- Update `project_spec.md` often when requirements, product behavior, data model fields, open questions, or acceptance criteria change.
- Update `project_design.md` often when architecture, provider contracts, diagrams, lifecycle semantics, integration design, or implementation tradeoffs change.
- Keep `.agents/status.md` current after meaningful progress, blockers, verification, or operational changes.
- If a user gives product requirements in chat, capture them in the relevant project doc before they fade into conversation history.

## Git And GitHub

- Commit after meaningful, coherent checkpoints.
- Push to GitHub often, especially after passing verification or before a context pause.
- Keep commits focused and descriptive.
- Do not stage unrelated changes such as local config, generated data, build output, or user-created files outside the current task.
- If the GitHub helper refuses to push because unrelated files are dirty, push committed `main` directly rather than altering those unrelated files.

## Verification

- Run `npm run check` after JavaScript/server changes.
- Run `npm run smoke` after API, provider, lifecycle, auth, CORS, persistence, or config behavior changes.
- Run `npm run desktop:build` after app/server changes that affect the standalone desktop app.
- Restart `npm run start` after server-side changes; this project does not hot-reload the Node server.
- Before finalizing UI work, verify the local app at `http://127.0.0.1:5173/` when feasible.

## Local Runtime

- Local server: `npm run start`
- Browser app: `http://127.0.0.1:5173/`
- Module widget demo: `http://127.0.0.1:5173/embed.html`
- Standalone widget demo: `http://127.0.0.1:5173/embed-standalone.html`
- Desktop build: `npm run desktop:build`

## Known Local Files

- `agent-monitor.config.json`, `data/`, and `dist/` are ignored local runtime/build artifacts.
- `project_design.md` may contain user edits; read before changing.
- `stock-research/` is unrelated to Agent Monitor unless the user says otherwise.

## Source Guidance

This file follows OpenAI Codex best-practice guidance for keeping durable repo instructions in `AGENTS.md`: include project context, commands, conventions, verification expectations, and team-specific workflow rules.
