import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { applyLifecycleAction, createActionRecord, initialAgents } from "../src/core.js";

const defaultStatePath = resolve(new URL("../data/agent-state.json", import.meta.url).pathname);

const agentProviderIds = {
  "local-codex-1": "local",
  "openai-research-2": "openai",
  "anthropic-review-1": "anthropic",
  "remote-build-7": "remote"
};

export function createStateStore() {
  let loaded = false;
  let state = createDefaultState();

  async function load() {
    if (loaded) return;

    try {
      const statePath = getStatePath();
      const file = await readFile(statePath, "utf8");
      state = normalizeState(JSON.parse(file));
    } catch {
      state = createDefaultState();
      await persist();
    }

    loaded = true;
  }

  async function persist() {
    const statePath = getStatePath();
    await mkdir(dirname(statePath), { recursive: true });
    await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
  }

  return {
    async listAgents(providerId = null) {
      await load();
      const agents = providerId
        ? state.agents.filter((agent) => agent.providerId === providerId)
        : state.agents;
      return cloneAgents(agents);
    },
    async listHistory(limit = 25) {
      await load();
      return state.history.slice(0, limit).map((record) => ({ ...record }));
    },
    async performAction(agentId, actionId, prompt = "") {
      await load();
      const at = Date.now();
      let record = null;
      let found = false;

      state.agents = state.agents.map((agent) => {
        if (agent.id !== agentId) return agent;
        found = true;
        record = createActionRecord(agent, actionId, prompt, at);
        return applyLifecycleAction(agent, actionId, prompt, at);
      });

      if (!found || !record) return null;

      state.history = [record, ...state.history].slice(0, 200);
      await persist();
      return cloneAgents(state.agents);
    },
    async recordAction(agent, actionId, prompt = "") {
      await load();
      const record = createActionRecord(agent, actionId, prompt);
      if (!record) return null;

      state.history = [record, ...state.history].slice(0, 200);
      await persist();
      return { ...record };
    }
  };
}

function createDefaultState() {
  return {
    version: 1,
    agents: initialAgents.map((agent) => ({
      ...agent,
      providerId: agentProviderIds[agent.id] || "local",
      children: [...agent.children],
      logs: normalizeLogs(agent.logs)
    })),
    history: []
  };
}

function normalizeState(nextState) {
  const fallback = createDefaultState();
  const agents = Array.isArray(nextState.agents) ? nextState.agents : fallback.agents;
  const history = Array.isArray(nextState.history) ? nextState.history : [];
  const fallbackAgents = new Map(fallback.agents.map((agent) => [agent.id, agent]));

  return {
    version: 1,
    agents: agents.map((agent) => {
      const fallbackAgent = fallbackAgents.get(agent.id);
      const logs = normalizeLogs(agent.logs);
      return {
        ...agent,
        providerId: agent.providerId || agentProviderIds[agent.id] || "local",
        children: Array.isArray(agent.children) ? [...agent.children] : [],
        logs: logs.length ? logs : normalizeLogs(fallbackAgent?.logs)
      };
    }),
    history
  };
}

function cloneAgents(agents) {
  return agents.map((agent) => ({
    ...agent,
    children: [...agent.children],
    logs: normalizeLogs(agent.logs)
  }));
}

function normalizeLogs(logs) {
  if (!Array.isArray(logs)) return [];

  return logs
    .filter((log) => log && log.message)
    .map((log) => ({
      at: Number(log.at || Date.now()),
      level: log.level || "info",
      source: log.source || "agent",
      message: String(log.message)
    }))
    .slice(0, 50);
}

function getStatePath() {
  return process.env.AGENT_MONITOR_STATE
    ? resolve(process.env.AGENT_MONITOR_STATE)
    : defaultStatePath;
}
