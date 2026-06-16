import { lifecycleActions } from "../src/core.js";
import { createStateStore } from "./stateStore.js";

function createStateProvider({ id, label, source, stateStore }) {
  return {
    id,
    label,
    source,
    capabilities: ["list", ...lifecycleActions.map((action) => action.id)],
    async listAgents() {
      return stateStore.listAgents(id);
    },
    async performAction(agentId, actionId, prompt = "") {
      const agents = await stateStore.performAction(agentId, actionId, prompt);
      return agents?.find((agent) => agent.id === agentId) || null;
    }
  };
}

export function createProviderRegistry() {
  const stateStore = createStateStore();
  const providers = [
    createStateProvider({
      id: "local",
      label: "Local agents",
      source: "local",
      stateStore
    }),
    createStateProvider({
      id: "openai",
      label: "OpenAI account",
      source: "user-account",
      stateStore
    }),
    createStateProvider({
      id: "anthropic",
      label: "Anthropic account",
      source: "user-account",
      stateStore
    }),
    createStateProvider({
      id: "remote",
      label: "Remote cloud agents",
      source: "cloud",
      stateStore
    })
  ];

  async function listAgents() {
    const groups = await Promise.all(providers.map((provider) => provider.listAgents()));
    return groups.flat().sort((a, b) => a.startedAt - b.startedAt);
  }

  async function performAction(agentId, actionId, prompt = "") {
    for (const provider of providers) {
      const agents = await provider.listAgents();
      if (agents.some((agent) => agent.id === agentId)) {
        await provider.performAction(agentId, actionId, prompt);
        return {
          agents: await listAgents(),
          history: await stateStore.listHistory()
        };
      }
    }

    return null;
  }

  return {
    providers: providers.map(({ id, label, source, capabilities }) => ({
      id,
      label,
      source,
      capabilities
    })),
    listAgents,
    listHistory: stateStore.listHistory,
    performAction
  };
}
