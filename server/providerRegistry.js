import { createAgentStore, initialAgents, lifecycleActions } from "../src/core.js";

function createMemoryProvider({ id, label, source, agentIds }) {
  const seedAgents = initialAgents.filter((agent) => agentIds.includes(agent.id));
  const store = createAgentStore(seedAgents);

  return {
    id,
    label,
    source,
    capabilities: ["list", ...lifecycleActions.map((action) => action.id)],
    async listAgents() {
      return store.list();
    },
    async performAction(agentId, actionId, prompt = "") {
      store.perform(agentId, actionId, prompt);
      return store.list().find((agent) => agent.id === agentId) || null;
    }
  };
}

export function createProviderRegistry() {
  const providers = [
    createMemoryProvider({
      id: "local",
      label: "Local agents",
      source: "local",
      agentIds: ["local-codex-1"]
    }),
    createMemoryProvider({
      id: "openai",
      label: "OpenAI account",
      source: "user-account",
      agentIds: ["openai-research-2"]
    }),
    createMemoryProvider({
      id: "anthropic",
      label: "Anthropic account",
      source: "user-account",
      agentIds: ["anthropic-review-1"]
    }),
    createMemoryProvider({
      id: "remote",
      label: "Remote cloud agents",
      source: "cloud",
      agentIds: ["remote-build-7"]
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
        return listAgents();
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
    performAction
  };
}
