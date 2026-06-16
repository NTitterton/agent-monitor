import { lifecycleActions } from "../src/core.js";
import { readConfig } from "./config.js";

const timeoutMs = 5000;

export function createRemoteHttpProvider(config) {
  return {
    id: config.id,
    label: config.label || config.id,
    source: config.source || "cloud",
    type: config.type || config.id || "remote",
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
  const tokens = Number(agent.tokens || 0);
  const tokensPerSecond = Number(agent.tokensPerSecond || 0);
  const tokenRateWindowMs = Number(agent.tokenRateWindowMs || 0);
  const goToTarget = agent.goToTarget || agent.remoteUrl || config.dashboardUrl || config.baseUrl;
  return {
    id: agent.id,
    name: agent.name || agent.id,
    provider: config.label || config.id,
    providerId: config.id,
    type: agent.type || config.type || config.id || "remote",
    source: config.source || "cloud",
    status: agent.status || "waiting",
    parentId: agent.parentId || null,
    task: agent.task || agent.name || agent.id,
    cpu: Number(agent.cpu || 0),
    memoryMb: Number(agent.memoryMb || 0),
    tokens: Number.isFinite(tokens) ? tokens : 0,
    tokensPerSecond: Number.isFinite(tokensPerSecond) ? tokensPerSecond : 0,
    tokenRateWindowMs: Number.isFinite(tokenRateWindowMs) ? tokenRateWindowMs : 0,
    tokenCountConfidence: normalizeTokenConfidence(agent.tokenCountConfidence, tokens > 0 ? "reported" : "unknown"),
    costUsd: Number(agent.costUsd || 0),
    startedAt,
    endedAt: agent.endedAt,
    children: Array.isArray(agent.children) ? agent.children : [],
    logs: normalizeLogs(agent.logs),
    remoteUrl: agent.remoteUrl || config.baseUrl,
    goToTarget,
    goToKind: agent.goToKind || "url",
    windowTitle: agent.windowTitle || "",
    capabilities: normalizeCapabilities(agent.capabilities, goToTarget)
  };
}

function normalizeCapabilities(capabilities, goToTarget) {
  const values = Array.isArray(capabilities)
    ? capabilities.map((capability) => String(capability)).filter(Boolean)
    : lifecycleActions.map((action) => action.id);
  return goToTarget && !values.includes("go-to") ? [...values, "go-to"] : values;
}

function normalizeTokenConfidence(value, fallback = "unknown") {
  return ["observed", "estimated", "reported", "unknown"].includes(value) ? value : fallback;
}

function normalizeLogs(logs) {
  if (!Array.isArray(logs)) return [];

  return logs
    .filter((log) => log && log.message)
    .map((log) => ({
      at: Number(log.at || Date.now()),
      level: log.level || "info",
      source: log.source || "remote",
      message: String(log.message)
    }))
    .slice(0, 50);
}
