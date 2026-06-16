import { createActionRecord, createAgentStore, lifecycleActions } from "./core.js";

export function createAgentClient() {
  const localStore = createAgentStore();
  const subscribers = new Set();
  let agents = localStore.list();
  let history = [];
  let mode = "local";

  function emit(nextAgents, nextHistory = history) {
    agents = nextAgents.map((agent) => ({ ...agent, children: [...agent.children] }));
    history = nextHistory.map((record) => ({ ...record }));
    subscribers.forEach((subscriber) => subscriber(snapshot()));
  }

  async function refresh() {
    try {
      const response = await fetch("/api/agents", { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`API returned ${response.status}`);
      const payload = await response.json();
      mode = "api";
      emit(payload.agents, payload.history || []);
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
