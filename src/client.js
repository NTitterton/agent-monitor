import { agentActions, createActionRecord, createAgentStore } from "./core.js";

export function createAgentClient() {
  const localStore = createAgentStore();
  const subscribers = new Set();
  let agents = localStore.list();
  let history = [];
  let providers = [];
  let config = null;
  let mode = "local";

  function emit(nextAgents, nextHistory = history, nextProviders = providers, nextConfig = config) {
    agents = nextAgents.map(cloneAgent);
    history = nextHistory.map((record) => ({ ...record }));
    providers = nextProviders.map((provider) => ({ ...provider }));
    config = cloneConfig(nextConfig);
    subscribers.forEach((subscriber) => subscriber(snapshot()));
  }

  async function refresh() {
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
          if (!response.ok) throw new Error(`API returned ${response.status}`);
          const payload = await response.json();
          emit(payload.agents, payload.history || history);
          return;
        } catch {
          mode = "local";
        }
      }

      const agent = agents.find((item) => item.id === agentId);
      localStore.perform(agentId, actionId, prompt);
      if (agent) {
        history = [createActionRecord(agent, actionId, prompt), ...history].filter(Boolean).slice(0, 25);
        emit(localStore.list(), history);
      }
    }
  };
}

function cloneAgent(agent) {
  return {
    ...agent,
    type: agent.type || agent.providerId || agent.source || "unknown",
    tokens: Number(agent.tokens || 0),
    tokensPerSecond: Number(agent.tokensPerSecond || 0),
    tokenRateWindowMs: Number(agent.tokenRateWindowMs || 0),
    tokenCountConfidence: agent.tokenCountConfidence || (agent.tokens ? "estimated" : "unknown"),
    children: Array.isArray(agent.children) ? [...agent.children] : []
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
