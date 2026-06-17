import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { agentActions, applyLifecycleAction, createActionRecord, initialAgents, lifecycleActions } from "../src/core.js";

const defaultStatePath = resolve(new URL("../data/agent-state.json", import.meta.url).pathname);

const agentProviderIds = {
  "local-codex-1": "local",
  "openai-research-2": "openai",
  "anthropic-review-1": "anthropic",
  "remote-build-7": "remote"
};

const agentTypes = {
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
      return state.history.slice(0, limit).map(normalizeHistoryRecord);
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
      type: agent.type || agentTypes[agent.id] || agent.providerId || "local",
      ...normalizeLineage(agent),
      ...normalizeResourceMetrics(agent),
      ...normalizeTokenMetrics(agent),
      ...normalizeCostMetrics(agent),
      transcript: normalizeTranscript(agent.transcript),
      logs: normalizeLogs(agent.logs)
    })),
    history: []
  };
}

function normalizeState(nextState) {
  const fallback = createDefaultState();
  const agents = Array.isArray(nextState.agents) ? nextState.agents : fallback.agents;
  const history = Array.isArray(nextState.history) ? nextState.history.map(normalizeHistoryRecord) : [];
  const fallbackAgents = new Map(fallback.agents.map((agent) => [agent.id, agent]));

  return {
    version: 1,
    agents: agents.map((agent) => {
      const fallbackAgent = fallbackAgents.get(agent.id);
      const logs = normalizeLogs(agent.logs);
      const transcript = normalizeTranscript(agent.transcript);
      return {
        ...agent,
        providerId: agent.providerId || agentProviderIds[agent.id] || "local",
        type: agent.type || agentTypes[agent.id] || agent.providerId || agentProviderIds[agent.id] || "remote",
        ...normalizeLineage(agent, fallbackAgent),
        ...normalizeResourceMetrics(agent, fallbackAgent),
        ...normalizeTokenMetrics(agent, fallbackAgent),
        ...normalizeCostMetrics(agent, fallbackAgent),
        ...normalizeTaskProgress(agent, fallbackAgent),
        ...normalizeGoTo(agent, fallbackAgent),
        transcript: transcript.length ? transcript : normalizeTranscript(fallbackAgent?.transcript),
        logs: logs.length ? logs : normalizeLogs(fallbackAgent?.logs)
      };
    }),
    history
  };
}

function normalizeHistoryRecord(record = {}) {
  return {
    ...record,
    provider: record.provider || "",
    providerId: record.providerId || "",
    source: record.source || "",
    type: record.type || ""
  };
}

function cloneAgents(agents) {
  return agents.map((agent) => ({
    ...agent,
    ...normalizeLineage(agent),
    ...normalizeResourceMetrics(agent),
    ...normalizeTokenMetrics(agent),
    ...normalizeCostMetrics(agent),
    ...normalizeTaskProgress(agent),
    ...normalizeGoTo(agent),
    transcript: normalizeTranscript(agent.transcript),
    logs: normalizeLogs(agent.logs)
  }));
}

function normalizeTokenMetrics(agent = {}, fallbackAgent = {}) {
  const tokens = Number(agent.tokens ?? fallbackAgent.tokens ?? 0);
  const tokensPerSecond = Number(agent.tokensPerSecond ?? fallbackAgent.tokensPerSecond ?? 0);
  const tokenRateWindowMs = Number(agent.tokenRateWindowMs ?? fallbackAgent.tokenRateWindowMs ?? 0);
  return {
    tokens: Number.isFinite(tokens) ? tokens : 0,
    tokensPerSecond: Number.isFinite(tokensPerSecond) ? tokensPerSecond : 0,
    tokenRateWindowMs: Number.isFinite(tokenRateWindowMs) ? tokenRateWindowMs : 0,
    tokenCountConfidence: normalizeTokenConfidence(
      agent.tokenCountConfidence,
      fallbackAgent.tokenCountConfidence || (tokens > 0 ? "estimated" : "unknown")
    )
  };
}

function normalizeTokenConfidence(value, fallback = "unknown") {
  return ["observed", "estimated", "reported", "unknown"].includes(value) ? value : fallback;
}

function normalizeCostMetrics(agent = {}, fallbackAgent = {}) {
  const costUsd = Number(agent.costUsd ?? fallbackAgent.costUsd ?? 0);
  return {
    costUsd: Number.isFinite(costUsd) ? costUsd : 0
  };
}

function normalizeResourceMetrics(agent = {}, fallbackAgent = {}) {
  return {
    cpu: finiteNumber(agent.cpu ?? fallbackAgent.cpu),
    memoryMb: finiteNumber(agent.memoryMb ?? fallbackAgent.memoryMb),
    processCpu: finiteNumber(agent.processCpu ?? fallbackAgent.processCpu),
    processMemoryMb: finiteNumber(agent.processMemoryMb ?? fallbackAgent.processMemoryMb),
    childCpu: finiteNumber(agent.childCpu ?? fallbackAgent.childCpu),
    childMemoryMb: finiteNumber(agent.childMemoryMb ?? fallbackAgent.childMemoryMb)
  };
}

function normalizeLineage(agent = {}, fallbackAgent = {}) {
  return {
    parentId: normalizeOptionalString(agent.parentId ?? fallbackAgent.parentId),
    children: normalizeStringList(agent.children ?? fallbackAgent.children)
  };
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function normalizeOptionalString(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value ?? fallback);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeTaskProgress(agent = {}, fallbackAgent = {}) {
  const progress = Number(agent.progressPercent ?? fallbackAgent.progressPercent);
  return {
    currentStep: String(agent.currentStep ?? fallbackAgent.currentStep ?? "").trim(),
    progressPercent: Number.isFinite(progress) ? Math.min(Math.max(Math.round(progress), 0), 100) : null
  };
}

function normalizeGoTo(agent = {}, fallbackAgent = {}) {
  const goToTarget = agent.goToTarget ?? fallbackAgent.goToTarget;
  const remoteUrl = agent.remoteUrl ?? fallbackAgent.remoteUrl;
  const defaultCapabilities = lifecycleActions.map((action) => action.id);
  const capabilities = normalizeCapabilities(
    Array.isArray(agent.capabilities)
      ? agent.capabilities
      : Array.isArray(fallbackAgent.capabilities)
        ? fallbackAgent.capabilities
        : defaultCapabilities
  );
  return {
    ...(remoteUrl ? { remoteUrl } : {}),
    ...(goToTarget ? { goToTarget } : {}),
    ...(agent.goToKind || fallbackAgent.goToKind ? { goToKind: agent.goToKind || fallbackAgent.goToKind } : {}),
    ...(agent.windowTitle || fallbackAgent.windowTitle ? { windowTitle: agent.windowTitle || fallbackAgent.windowTitle } : {}),
    ...(capabilities ? { capabilities } : {})
  };
}

function normalizeCapabilities(capabilities) {
  if (!Array.isArray(capabilities)) return null;
  const knownActions = new Set(agentActions.map((action) => action.id));
  return [...new Set(capabilities.map((capability) => String(capability).trim()).filter((capability) => knownActions.has(capability)))];
}

function normalizeLogs(logs) {
  if (!Array.isArray(logs)) return [];

  return logs
    .filter((log) => log && log.message)
    .map((log) => ({
      at: normalizeTimestamp(log.at),
      level: log.level || "info",
      source: log.source || "agent",
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
      role: normalizeRole(entry.role),
      source: entry.source || "agent",
      content: String(entry.content || entry.message || entry.text).trim()
    }))
    .slice(0, 100);
}

function normalizeRole(role) {
  return ["system", "user", "assistant", "tool"].includes(role) ? role : "assistant";
}

function normalizeTimestamp(value, fallback = Date.now()) {
  if (value === null || value === undefined || value === "") return fallback;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? fallback : parsed;
}

function getStatePath() {
  return process.env.AGENT_MONITOR_STATE
    ? resolve(process.env.AGENT_MONITOR_STATE)
    : defaultStatePath;
}
