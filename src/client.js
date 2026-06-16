import { createAgentStore, lifecycleActions } from "./core.js";

export function createAgentClient() {
  const localStore = createAgentStore();
  const subscribers = new Set();
  let agents = localStore.list();
  let mode = "local";

  function emit(nextAgents) {
    agents = nextAgents.map((agent) => ({ ...agent, children: [...agent.children] }));
    subscribers.forEach((subscriber) => subscriber(list()));
  }

  async function refresh() {
    try {
      const response = await fetch("/api/agents", { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`API returned ${response.status}`);
      const payload = await response.json();
      mode = "api";
      emit(payload.agents);
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

  return {
    list,
    mode() {
      return mode;
    },
    subscribe(subscriber) {
      subscribers.add(subscriber);
      subscriber(list());
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
          emit(payload.agents);
          return;
        } catch {
          mode = "local";
        }
      }

      localStore.perform(agentId, actionId, prompt);
    }
  };
}
