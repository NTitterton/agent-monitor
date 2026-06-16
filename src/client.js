import { createActionRecord, createAgentStore, lifecycleActions } from "./core.js";

export function createAgentClient() {
  const localStore = createAgentStore();
  const subscribers = new Set();
  let agents = localStore.list();
  let history = [];
  let providers = [];
  let mode = "local";

  function emit(nextAgents, nextHistory = history, nextProviders = providers) {
    agents = nextAgents.map((agent) => ({ ...agent, children: [...agent.children] }));
    history = nextHistory.map((record) => ({ ...record }));
    providers = nextProviders.map((provider) => ({ ...provider }));
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
      emit(payload.agents, payload.history || [], providerPayload.providers || []);
    } catch {
      mode = "local";
      emit(localStore.list());
    }
  }

  localStore.subscribe((nextAgents) => {
    if (mode === "local") emit(nextAgents);
  });

  function list() {
    return agents.map((agent) => ({ ...agent, children: [...agent.children] }));
  }

  function historyList() {
    return history.map((record) => ({ ...record }));
  }

  function snapshot() {
    return {
      agents: list(),
      history: historyList(),
      providers: providers.map((provider) => ({ ...provider })),
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
      const action = lifecycleActions.find((item) => item.id === actionId);
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
