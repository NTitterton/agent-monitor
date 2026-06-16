import { lifecycleActions } from "../src/core.js";
import { createLocalProcessProvider, hasLocalProcessConfig } from "./localProcessProvider.js";
import { createStateStore } from "./stateStore.js";

function createStateProvider({ id, label, source, stateStore }) {
  return {
    id,
    label,
    source,
    recordsHistory: true,
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
  const providers = [];

  const stateProviders = [
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

  providers.push(...stateProviders);

  async function listAgents() {
    const activeProviders = await listActiveProviders();
    const groups = await Promise.all(activeProviders.map((provider) => provider.listAgents()));
    return groups.flat().sort((a, b) => a.startedAt - b.startedAt);
  }

  async function performAction(agentId, actionId, prompt = "") {
    for (const provider of await listActiveProviders()) {
      const agents = await provider.listAgents();
      if (agents.some((agent) => agent.id === agentId)) {
        const changedAgent = await provider.performAction(agentId, actionId, prompt);
        if (!provider.recordsHistory && changedAgent) {
          await stateStore.recordAction(changedAgent, actionId, prompt);
        }
        return {
          agents: await listAgents(),
          history: await stateStore.listHistory()
        };
      }
    }

    return null;
  }

  async function listActiveProviders() {
    if (await hasLocalProcessConfig()) {
      return [createLocalProcessProvider(), ...providers];
    }

    return providers;
  }

  return {
    async providers() {
      return (await listActiveProviders()).map(({ id, label, source, capabilities }) => ({
        id,
        label,
        source,
        capabilities
      }));
    },
    listAgents,
    listHistory: stateStore.listHistory,
    performAction
  };
}
