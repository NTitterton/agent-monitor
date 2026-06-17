import { agentActions, createActionRecord, createAgentStore } from "./core.js";

export function createAgentClient() {
  const localStore = createAgentStore();
  const subscribers = new Set();
  let agents = localStore.list();
  let history = [];
  let providers = [];
  let config = null;
  let mode = "local";
  let actionMessage = null;

  function emit(nextAgents, nextHistory = history, nextProviders = providers, nextConfig = config, nextActionMessage = actionMessage) {
    agents = nextAgents.map(cloneAgent);
    history = nextHistory.map((record) => ({ ...record }));
    providers = nextProviders.map((provider) => ({ ...provider }));
    config = cloneConfig(nextConfig);
    actionMessage = cloneActionMessage(nextActionMessage);
    subscribers.forEach((subscriber) => subscriber(snapshot()));
  }

  async function refresh() {
    try {
      const response = await fetch("/api/snapshot", { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`API returned ${response.status}`);
      const payload = await response.json();
      mode = "api";
      emit(payload.agents, payload.history || [], payload.providers || [], payload.config || null);
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
      return payload.config;
    },
    async testProvider(providerId) {
      if (mode !== "api") return null;

      const response = await fetch(`/api/providers/${encodeURIComponent(providerId)}/test`, {
        method: "POST",
        headers: { Accept: "application/json" }
      });
      if (!response.ok) throw new Error(`API returned ${response.status}`);
      const payload = await response.json();
      await refresh();
      return payload.provider;
    },
    async detail(agentId) {
      if (mode === "api") {
        const response = await fetch(`/api/agents/${encodeURIComponent(agentId)}`, {
          headers: { Accept: "application/json" }
        });
        if (response.ok) return response.json();
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
            emit(errorPayload?.agents || agents, errorPayload?.history || history, providers, config, message);
            return message;
          }
          const payload = await response.json();
          const message = { tone: "ok", text: `${action.label} sent to ${agent?.name || agentId}` };
          emit(payload.agents, payload.history || history, providers, config, message);
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

function isUrlGoTo(agent) {
  if (!agent) return false;
  const target = agent.goToTarget || agent.remoteUrl;
  return agent.goToKind === "url" && /^https?:\/\//i.test(target || "");
}

function cloneAgent(agent) {
  return {
    ...agent,
    type: agent.type || agent.providerId || agent.source || "unknown",
    tokens: Number(agent.tokens || 0),
    tokensPerSecond: Number(agent.tokensPerSecond || 0),
    tokenRateWindowMs: Number(agent.tokenRateWindowMs || 0),
    tokenCountConfidence: agent.tokenCountConfidence || (agent.tokens ? "estimated" : "unknown"),
    children: Array.isArray(agent.children) ? [...agent.children] : [],
    childPids: Array.isArray(agent.childPids) ? [...agent.childPids] : [],
    transcript: Array.isArray(agent.transcript) ? agent.transcript.map((entry) => ({ ...entry })) : []
  };
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
