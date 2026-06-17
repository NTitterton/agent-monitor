import { agentActions, createActionRecord, createAgentStore } from "./core.js";

export function createAgentClient() {
  const localStore = createAgentStore();
  const subscribers = new Set();
  let agents = localStore.list();
  let history = [];
  let providers = [];
  let config = null;
  let scanner = null;
  let mode = "local";
  let actionMessage = null;

  function emit(
    nextAgents,
    nextHistory = history,
    nextProviders = providers,
    nextConfig = config,
    nextActionMessage = actionMessage,
    nextScanner = scanner
  ) {
    agents = nextAgents.map(cloneAgent);
    history = nextHistory.map((record) => ({ ...record }));
    providers = nextProviders.map((provider) => ({ ...provider }));
    config = cloneConfig(nextConfig);
    scanner = cloneScanner(nextScanner);
    actionMessage = cloneActionMessage(nextActionMessage);
    subscribers.forEach((subscriber) => subscriber(snapshot()));
  }

  async function refresh() {
    try {
      const response = await fetch("/api/snapshot", { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`API returned ${response.status}`);
      const payload = await response.json();
      mode = "api";
      emit(
        payload.agents,
        payload.history || [],
        payload.providers || [],
        payload.config || null,
        null,
        payload.scanner || null
      );
    } catch {
      await refreshLegacy();
    }
  }

  async function refreshLegacy() {
    try {
      const response = await fetch("/api/agents", { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`API returned ${response.status}`);
      const payload = await response.json();
      mode = "api";
      const providerResponse = await fetch("/api/providers", { headers: { Accept: "application/json" } });
      const providerPayload = providerResponse.ok ? await providerResponse.json() : { providers: [] };
      const configResponse = await fetch("/api/config", { headers: { Accept: "application/json" } });
      const configPayload = configResponse.ok ? await configResponse.json() : { config: null };
      emit(payload.agents, payload.history || [], providerPayload.providers || [], configPayload.config);
    } catch {
      mode = "local";
      emit(localStore.list());
    }
  }

  localStore.subscribe((nextAgents) => {
    if (mode === "local") emit(nextAgents);
  });

  function list() {
    return agents.map(cloneAgent);
  }

  function historyList() {
    return history.map((record) => ({ ...record }));
  }

  function snapshot() {
    return {
      agents: list(),
      history: historyList(),
      providers: providers.map((provider) => ({ ...provider })),
      config: cloneConfig(config),
      scanner: cloneScanner(scanner),
      actionMessage: cloneActionMessage(actionMessage),
      mode
    };
  }

  return {
    list,
    history: historyList,
    mode() {
      return mode;
    },
    subscribe(subscriber) {
      subscribers.add(subscriber);
      subscriber(snapshot());
      void refresh();
      return () => subscribers.delete(subscriber);
    },
    async refresh() {
      await refresh();
    },
    async updateConfig(patch) {
      if (mode !== "api") return null;

      const response = await fetch("/api/config", {
        method: "PUT",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ config: patch })
      });
      if (!response.ok) throw new Error(`API returned ${response.status}`);
      const payload = await response.json();
      config = payload.config;
      await refresh();
      if (payload.config?.validationWarnings?.length && config) {
        config = { ...config, validationWarnings: [...payload.config.validationWarnings] };
      }
      return cloneConfig(config || payload.config);
    },
    async testProvider(providerId) {
      if (mode !== "api") return null;

      const response = await fetch(`/api/providers/${encodeURIComponent(providerId)}/test`, {
        method: "POST",
        headers: { Accept: "application/json" }
      });
      if (!response.ok) throw new Error(`API returned ${response.status}`);
      const payload = await response.json();
      const nextProviders = payload.providers || mergeProviderStatus(providers, payload.provider);
      if (payload.agents) {
        emit(
          payload.agents,
          payload.history || history,
          nextProviders,
          payload.config || config,
          null,
          payload.scanner || scanner
        );
      } else {
        emit(agents, history, nextProviders, config, null, scanner);
      }
      return payload.provider;
    },
    async detail(agentId) {
      if (mode === "api") {
        const response = await fetch(`/api/agents/${encodeURIComponent(agentId)}`, {
          headers: { Accept: "application/json" }
        });
        if (response.ok) return response.json();
        const errorPayload = await readJsonResponse(response);
        if (errorPayload?.agents) {
          emit(
            errorPayload.agents,
            errorPayload.history || history,
            errorPayload.providers || providers,
            errorPayload.config || config,
            { tone: "warn", text: errorPayload.error || `Agent detail failed (${response.status})` },
            errorPayload.scanner || scanner
          );
          return null;
        }
      }

      const currentAgents = list();
      const agent = currentAgents.find((item) => item.id === agentId);
      if (!agent) return null;

      return {
        agent,
        parent: agent.parentId ? currentAgents.find((item) => item.id === agent.parentId) || null : null,
        children: agent.children
          .map((childId) => currentAgents.find((item) => item.id === childId))
          .filter(Boolean),
        history: history.filter((record) => record.agentId === agentId)
      };
    },
    async perform(agentId, actionId, prompt = "") {
      const action = agentActions.find((item) => item.id === actionId);
      if (!action) return;
      const agent = agents.find((item) => item.id === agentId);

      if (actionId === "go-to" && isUrlGoTo(agent)) {
        window.open(agent.goToTarget || agent.remoteUrl, "_blank", "noopener");
        return;
      }

      if (mode === "api") {
        try {
          const response = await fetch(`/api/agents/${encodeURIComponent(agentId)}/actions`, {
            method: "POST",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json"
            },
            body: JSON.stringify({ action: actionId, prompt })
          });
          if (!response.ok) {
            const errorPayload = await readJsonResponse(response);
            const message = {
              tone: response.status >= 500 ? "error" : "warn",
              text: errorPayload?.error || `Action failed (${response.status})`
            };
            emit(
              errorPayload?.agents || agents,
              errorPayload?.history || history,
              errorPayload?.providers || providers,
              errorPayload?.config || config,
              message,
              errorPayload?.scanner || scanner
            );
            return message;
          }
          const payload = await response.json();
          const message = { tone: "ok", text: `${action.label} sent to ${agent?.name || agentId}` };
          emit(
            payload.agents,
            payload.history || history,
            payload.providers || providers,
            payload.config || config,
            message,
            payload.scanner || scanner
          );
          return message;
        } catch {
          mode = "local";
        }
      }

      localStore.perform(agentId, actionId, prompt);
      if (agent) {
        history = [createActionRecord(agent, actionId, prompt), ...history].filter(Boolean).slice(0, 25);
        const message = { tone: "ok", text: `${action.label} applied locally to ${agent.name}` };
        emit(localStore.list(), history, providers, config, message);
        return message;
      }
    }
  };
}

async function readJsonResponse(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function cloneActionMessage(message) {
  return message ? { ...message } : null;
}

function mergeProviderStatus(currentProviders, testedProvider) {
  if (!testedProvider) return currentProviders;
  const merged = currentProviders.map((provider) =>
    provider.id === testedProvider.id ? { ...provider, ...testedProvider } : provider
  );
  if (!merged.some((provider) => provider.id === testedProvider.id)) merged.push(testedProvider);
  return merged;
}

function isUrlGoTo(agent) {
  if (!agent) return false;
  const target = agent.goToTarget || agent.remoteUrl;
  return agent.goToKind === "url" && /^https?:\/\//i.test(target || "");
}

function cloneAgent(agent) {
  const tokens = finiteNumber(agent.tokens);
  return {
    ...agent,
    type: agent.type || agent.providerId || agent.source || "unknown",
    cpu: finiteNumber(agent.cpu),
    memoryMb: finiteNumber(agent.memoryMb),
    processCpu: finiteNumber(agent.processCpu),
    processMemoryMb: finiteNumber(agent.processMemoryMb),
    childCpu: finiteNumber(agent.childCpu),
    childMemoryMb: finiteNumber(agent.childMemoryMb),
    tokens,
    tokensPerSecond: finiteNumber(agent.tokensPerSecond),
    tokenRateWindowMs: finiteNumber(agent.tokenRateWindowMs),
    tokenCountConfidence: normalizeTokenConfidence(agent.tokenCountConfidence, tokens ? "estimated" : "unknown"),
    costUsd: finiteNumber(agent.costUsd),
    startedAt: normalizeTimestamp(agent.startedAt),
    endedAt: agent.endedAt ? normalizeTimestamp(agent.endedAt, null) : undefined,
    currentStep: agent.currentStep || "",
    progressPercent: normalizeProgress(agent.progressPercent),
    parentId: normalizeOptionalString(agent.parentId),
    children: normalizeStringList(agent.children),
    pid: normalizeOptionalPid(agent.pid),
    parentPid: normalizeOptionalPid(agent.parentPid),
    childPids: normalizePidList(agent.childPids),
    capabilities: normalizeCapabilities(agent.capabilities),
    logs: normalizeLogs(agent.logs),
    transcript: normalizeTranscript(agent.transcript)
  };
}

function normalizeCapabilities(capabilities) {
  if (!Array.isArray(capabilities)) return [];
  const knownActions = new Set(agentActions.map((action) => action.id));
  return [...new Set(capabilities.map((capability) => String(capability).trim()).filter((capability) => knownActions.has(capability)))];
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function normalizeOptionalString(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function normalizeTokenConfidence(value, fallback = "unknown") {
  return ["observed", "estimated", "reported", "unknown"].includes(value) ? value : fallback;
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
      ...log,
      at: normalizeTimestamp(log.at),
      message: String(log.message)
    }))
    .slice(0, 50);
}

function normalizeTranscript(transcript) {
  if (!Array.isArray(transcript)) return [];
  return transcript
    .filter((entry) => entry && (entry.content || entry.message || entry.text))
    .map((entry) => ({
      ...entry,
      at: normalizeTimestamp(entry.at),
      content: String(entry.content || entry.message || entry.text).trim()
    }))
    .slice(0, 100);
}

function cloneConfig(config) {
  if (!config) return null;

  return {
    ...config,
    localDiscovery: { ...(config.localDiscovery || {}) },
    remoteHttpProviders: Array.isArray(config.remoteHttpProviders)
      ? config.remoteHttpProviders.map((provider) => ({ ...provider }))
      : [],
    openAIResponsesProviders: Array.isArray(config.openAIResponsesProviders)
      ? config.openAIResponsesProviders.map((provider) => ({
          ...provider,
          responses: Array.isArray(provider.responses)
            ? provider.responses.map((response) => ({ ...response }))
            : []
        }))
      : [],
    anthropicMessageBatchesProviders: Array.isArray(config.anthropicMessageBatchesProviders)
      ? config.anthropicMessageBatchesProviders.map((provider) => ({
          ...provider,
          batches: Array.isArray(provider.batches)
            ? provider.batches.map((batch) => ({ ...batch }))
            : []
        }))
      : []
  };
}

function normalizeProgress(value) {
  const progress = Number(value);
  return Number.isFinite(progress) ? Math.min(Math.max(Math.round(progress), 0), 100) : null;
}

function cloneScanner(scanner) {
  return scanner ? { ...scanner } : null;
}
