import { lifecycleActions } from "../src/core.js";
import { readConfig } from "./config.js";

const timeoutMs = 5000;

export function createRemoteHttpProvider(config) {
  return {
    id: config.id,
    label: config.label || config.id,
    source: config.source || "cloud",
    recordsHistory: false,
    capabilities: ["list", ...lifecycleActions.map((action) => action.id)],
    async listAgents() {
      const payload = await request(config, "/agents", { method: "GET" });
      return normalizeAgents(payload.agents || [], config);
    },
    async performAction(agentId, actionId, prompt = "") {
      const payload = await request(config, `/agents/${encodeURIComponent(agentId)}/actions`, {
        method: "POST",
        body: JSON.stringify({ action: actionId, prompt })
      });

      if (payload.agent) return normalizeAgent(payload.agent, config);
      const agents = normalizeAgents(payload.agents || [], config);
      return agents.find((agent) => agent.id === agentId) || null;
    }
  };
}

export async function readRemoteHttpProviders() {
  const config = await readConfig();
  if (!Array.isArray(config.remoteHttpProviders)) return [];

  return config.remoteHttpProviders
    .filter((provider) => provider.id && provider.baseUrl)
    .map((provider) =>
      createRemoteHttpProvider({
        source: "cloud",
        ...provider,
        baseUrl: provider.baseUrl.replace(/\/+$/, "")
      })
    );
}

async function request(config, pathname, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs || timeoutMs);

  try {
    const response = await fetch(`${config.baseUrl}${pathname}`, {
      ...options,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}),
        ...(config.headers || {})
      },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`${config.id} returned ${response.status}`);
    }

    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeAgents(agents, config) {
  return agents.map((agent) => normalizeAgent(agent, config));
}

function normalizeAgent(agent, config) {
  const startedAt = agent.startedAt || Date.now();
  return {
    id: agent.id,
    name: agent.name || agent.id,
    provider: config.label || config.id,
    providerId: config.id,
    source: config.source || "cloud",
    status: agent.status || "waiting",
    parentId: agent.parentId || null,
    task: agent.task || agent.name || agent.id,
    cpu: Number(agent.cpu || 0),
    memoryMb: Number(agent.memoryMb || 0),
    tokens: Number(agent.tokens || 0),
    costUsd: Number(agent.costUsd || 0),
    startedAt,
    endedAt: agent.endedAt,
    children: Array.isArray(agent.children) ? agent.children : [],
    remoteUrl: config.baseUrl
  };
}
