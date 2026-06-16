import { lifecycleActions } from "../src/core.js";
import { readAnthropicMessageBatchesProviders } from "./anthropicMessageBatchesProvider.js";
import { createLocalProcessProvider, hasLocalProcessConfig } from "./localProcessProvider.js";
import { readOpenAIResponsesProviders } from "./openAIResponsesProvider.js";
import { readRemoteHttpProviders } from "./remoteHttpProvider.js";
import { createStateStore } from "./stateStore.js";

function createStateProvider({ id, label, source, type, stateStore }) {
  return {
    id,
    label,
    source,
    type,
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
      type: "local",
      stateStore
    }),
    createStateProvider({
      id: "openai",
      label: "OpenAI account",
      source: "user-account",
      type: "openai",
      stateStore
    }),
    createStateProvider({
      id: "anthropic",
      label: "Anthropic account",
      source: "user-account",
      type: "anthropic",
      stateStore
    }),
    createStateProvider({
      id: "remote",
      label: "Remote cloud agents",
      source: "cloud",
      type: "remote",
      stateStore
    })
  ];

  providers.push(...stateProviders);

  async function listAgents() {
    const activeProviders = await listActiveProviders();
    const groups = await Promise.all(activeProviders.map((provider) => safeListAgents(provider)));
    return groups.flatMap((result) => result.agents).sort((a, b) => a.startedAt - b.startedAt);
  }

  async function performAction(agentId, actionId, prompt = "") {
    for (const provider of await listActiveProviders()) {
      let agents = [];
      try {
        agents = await provider.listAgents();
      } catch {
        continue;
      }

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

  async function getAgent(agentId) {
    const agents = await listAgents();
    const agent = agents.find((item) => item.id === agentId);
    if (!agent) return null;

    return {
      agent,
      parent: agent.parentId ? agents.find((item) => item.id === agent.parentId) || null : null,
      children: agent.children
        .map((childId) => agents.find((item) => item.id === childId))
        .filter(Boolean),
      history: (await stateStore.listHistory(200)).filter((record) => record.agentId === agentId)
    };
  }

  async function listActiveProviders() {
    const configuredProviders = [
      ...(await readOpenAIResponsesProviders()),
      ...(await readAnthropicMessageBatchesProviders()),
      ...(await readRemoteHttpProviders())
    ];

    if (await hasLocalProcessConfig()) configuredProviders.unshift(createLocalProcessProvider());

    return [...configuredProviders, ...providers];
  }

  async function listProviderStatus() {
    const activeProviders = await listActiveProviders();
    const results = await Promise.all(activeProviders.map((provider) => safeListAgents(provider)));
    return results.map(({ provider, agents, error }) => ({
      id: provider.id,
      label: provider.label,
      source: provider.source,
      type: provider.type || provider.id,
      capabilities: provider.capabilities,
      status: error ? "error" : "ok",
      agentCount: agents.length,
      error: error?.message || null
    }));
  }

  async function safeListAgents(provider) {
    try {
      return { provider, agents: await provider.listAgents(), error: null };
    } catch (error) {
      return { provider, agents: [], error };
    }
  }

  return {
    async providers() {
      return listProviderStatus();
    },
    listAgents,
    getAgent,
    listHistory: stateStore.listHistory,
    performAction
  };
}
