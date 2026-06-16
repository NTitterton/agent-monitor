import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { applyLifecycleAction, createActionRecord, initialAgents } from "../src/core.js";

const statePath = resolve(new URL("../data/agent-state.json", import.meta.url).pathname);

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
      const file = await readFile(statePath, "utf8");
      state = normalizeState(JSON.parse(file));
    } catch {
      state = createDefaultState();
      await persist();
    }

    loaded = true;
  }

  async function persist() {
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
      children: [...agent.children]
    })),
    history: []
  };
}

function normalizeState(nextState) {
  const fallback = createDefaultState();
  const agents = Array.isArray(nextState.agents) ? nextState.agents : fallback.agents;
  const history = Array.isArray(nextState.history) ? nextState.history : [];

  return {
    version: 1,
    agents: agents.map((agent) => ({
      ...agent,
      providerId: agent.providerId || agentProviderIds[agent.id] || "local",
      children: Array.isArray(agent.children) ? [...agent.children] : []
    })),
    history
  };
}

function cloneAgents(agents) {
  return agents.map((agent) => ({ ...agent, children: [...agent.children] }));
}
