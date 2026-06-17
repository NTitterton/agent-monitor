import { agentActions, lifecycleActions } from "../src/core.js";
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
  const startedAt = normalizeTimestamp(agent.startedAt);
  const tokens = Number(agent.tokens || 0);
  const tokensPerSecond = Number(agent.tokensPerSecond || 0);
  const tokenRateWindowMs = Number(agent.tokenRateWindowMs || 0);
  const costUsd = Number(agent.costUsd || 0);
  const goToTarget = agent.goToTarget || agent.remoteUrl || config.dashboardUrl || config.baseUrl;
  return {
    id: String(agent.id || "").trim(),
    name: String(agent.name || agent.id || "").trim(),
    provider: config.label || config.id,
    providerId: config.id,
    type: agent.type || config.type || config.id || "remote",
    source: config.source || "cloud",
    status: agent.status || "waiting",
    parentId: normalizeOptionalString(agent.parentId),
    task: String(agent.task || agent.name || agent.id || "").trim(),
    owner: String(agent.owner || "").trim(),
    workspace: String(agent.workspace || "").trim(),
    repository: String(agent.repository || agent.repo || "").trim(),
    branch: String(agent.branch || "").trim(),
    queue: String(agent.queue || "").trim(),
    priority: String(agent.priority || "").trim(),
    currentStep: String(agent.currentStep || agent.step || "").trim(),
    progressPercent: normalizeProgress(agent.progressPercent ?? agent.progress),
    cpu: finiteNumber(agent.cpu),
    memoryMb: finiteNumber(agent.memoryMb),
    processCpu: finiteNumber(agent.processCpu),
    processMemoryMb: finiteNumber(agent.processMemoryMb),
    childCpu: finiteNumber(agent.childCpu),
    childMemoryMb: finiteNumber(agent.childMemoryMb),
    tokens: Number.isFinite(tokens) ? tokens : 0,
    tokensPerSecond: Number.isFinite(tokensPerSecond) ? tokensPerSecond : 0,
    tokenRateWindowMs: Number.isFinite(tokenRateWindowMs) ? tokenRateWindowMs : 0,
    tokenCountConfidence: normalizeTokenConfidence(agent.tokenCountConfidence, tokens > 0 ? "reported" : "unknown"),
    costUsd: Number.isFinite(costUsd) ? costUsd : 0,
    startedAt,
    endedAt: agent.endedAt ? normalizeTimestamp(agent.endedAt, null) : undefined,
    children: normalizeStringList(agent.children),
    pid: normalizeOptionalPid(agent.pid),
    parentPid: normalizeOptionalPid(agent.parentPid),
    childPids: normalizePidList(agent.childPids),
    transcript: normalizeTranscript(agent.transcript),
    logs: normalizeLogs(agent.logs),
    remoteUrl: agent.remoteUrl || config.baseUrl,
    goToTarget,
    goToKind: agent.goToKind || "url",
    windowTitle: agent.windowTitle || "",
    capabilities: normalizeCapabilities(agent.capabilities, goToTarget)
  };
}

function normalizeCapabilities(capabilities, goToTarget) {
  const knownActions = new Set(agentActions.map((action) => action.id));
  const values = Array.isArray(capabilities)
    ? capabilities.map((capability) => String(capability).trim()).filter((capability) => knownActions.has(capability))
    : lifecycleActions.map((action) => action.id);
  const nextValues = goToTarget ? [...values, "go-to"] : values;
  return [...new Set(nextValues)];
}

function normalizeTokenConfidence(value, fallback = "unknown") {
  return ["observed", "estimated", "reported", "unknown"].includes(value) ? value : fallback;
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function normalizeOptionalString(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function normalizeOptionalPid(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizePidList(value) {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeOptionalPid).filter((pid) => pid !== null);
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value ?? fallback);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeProgress(value) {
  const progress = Number(value);
  return Number.isFinite(progress) ? Math.min(Math.max(Math.round(progress), 0), 100) : null;
}

function normalizeTimestamp(value, fallback = Date.now()) {
  if (value === null || value === undefined || value === "") return fallback;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? fallback : parsed;
}

function normalizeLogs(logs) {
  if (!Array.isArray(logs)) return [];

  return logs
    .filter((log) => log && log.message)
    .map((log) => ({
      at: normalizeTimestamp(log.at),
      level: log.level || "info",
      source: log.source || "remote",
      message: String(log.message)
    }))
    .slice(0, 50);
}

function normalizeTranscript(transcript) {
  if (!Array.isArray(transcript)) return [];

  return transcript
    .filter((entry) => entry && (entry.content || entry.message || entry.text))
    .map((entry) => ({
      at: normalizeTimestamp(entry.at),
      role: ["system", "user", "assistant", "tool"].includes(entry.role) ? entry.role : "assistant",
      source: entry.source || "remote",
      content: String(entry.content || entry.message || entry.text).trim()
    }))
    .slice(0, 100);
}
