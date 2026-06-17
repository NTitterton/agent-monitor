import { agentActions, lifecycleActions } from "../src/core.js";
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
  const snapshotCache = new Map();
  const previousTokenSnapshots = new Map();
  const snapshotCacheTtlMs = Math.max(0, Number(process.env.AGENT_MONITOR_SCAN_CACHE_MS || 1000));

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

  async function refreshSnapshots(options = {}) {
    const activeProviders = await listActiveProviders();
    const results = await Promise.all(
      activeProviders.map((provider) =>
        safeListAgents(provider, {
          force: options.force !== false,
          cacheTtlMs: options.cacheTtlMs
        })
      )
    );
    return {
      scannedAt: Date.now(),
      providerCount: results.length,
      agentCount: results.reduce((total, result) => total + result.agents.length, 0),
      errors: results.filter((result) => result.error).length
    };
  }

  async function performAction(agentId, actionId, prompt = "") {
    if (!agentActions.some((action) => action.id === actionId)) {
      return {
        error: "Invalid action",
        status: 400,
        agents: await listAgents(),
        history: await stateStore.listHistory()
      };
    }

    for (const provider of await listActiveProviders()) {
      let agents = [];
      try {
        agents = (await safeListAgents(provider)).agents;
      } catch {
        continue;
      }

      const agent = agents.find((item) => item.id === agentId);
      if (agent) {
        if (Array.isArray(agent.capabilities) && !agent.capabilities.includes(actionId)) {
          return {
            error: "Action not supported",
            status: 409,
            agents: await listAgents(),
            history: await stateStore.listHistory()
          };
        }

        let changedAgent;
        try {
          changedAgent = await provider.performAction(agentId, actionId, prompt);
          invalidateSnapshots(provider.id);
        } catch (error) {
          return {
            error: error.message || "Provider action failed",
            status: 502,
            agents: await listAgents(),
            history: await stateStore.listHistory()
          };
        }
        if (!changedAgent) {
          return {
            error: "Provider did not return updated agent",
            status: 502,
            agents: await listAgents(),
            history: await stateStore.listHistory()
          };
        }
        if (changedAgent.id !== agentId) {
          return {
            error: "Provider returned a different agent",
            status: 502,
            agents: await listAgents(),
            history: await stateStore.listHistory()
          };
        }

        if (!provider.recordsHistory && changedAgent) {
          await stateStore.recordAction(changedAgent, actionId, prompt);
        }
        return {
          agents: await listAgents(),
          history: await stateStore.listHistory()
        };
      }
    }

    return {
      error: "Agent not found",
      status: 404,
      agents: await listAgents(),
      history: await stateStore.listHistory()
    };
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
    return results.map(providerStatus);
  }

  async function testProvider(providerId) {
    const provider = (await listActiveProviders()).find((item) => item.id === providerId);
    if (!provider) return null;
    return providerStatus(await safeListAgents(provider, { force: true }));
  }

  function providerStatus({ provider, agents, scannedAt, error }) {
    return {
      id: provider.id,
      label: provider.label,
      source: provider.source,
      type: provider.type || provider.id,
      capabilities: provider.capabilities,
      status: error ? "error" : "ok",
      agentCount: agents.length,
      scannedAt,
      error: error?.message || null
    };
  }

  async function safeListAgents(provider, options = {}) {
    const cacheKey = provider.id;
    const cached = snapshotCache.get(cacheKey);
    const cacheTtlMs = cached?.cacheTtlMs ?? snapshotCacheTtlMs;
    if (!options.force && cached && cacheTtlMs > 0 && Date.now() - cached.scannedAt <= cacheTtlMs) {
      return cloneSnapshotResult(cached);
    }

    const scannedAt = Date.now();
    const resultCacheTtlMs = Math.max(0, Number(options.cacheTtlMs ?? snapshotCacheTtlMs));
    try {
      const agents = await provider.listAgents();
      const normalizedAgents = agents.map((agent) => ({ scannedAt, ...agent, scannedAt: agent.scannedAt || scannedAt }));
      const result = {
        provider,
        agents: applySampledTokenRates(provider.id, normalizedAgents, scannedAt, previousTokenSnapshots),
        scannedAt,
        cacheTtlMs: resultCacheTtlMs,
        error: null
      };
      snapshotCache.set(cacheKey, result);
      return cloneSnapshotResult(result);
    } catch (error) {
      const result = buildProviderErrorSnapshot(provider, cached, scannedAt, resultCacheTtlMs, error);
      snapshotCache.set(cacheKey, result);
      return cloneSnapshotResult(result);
    }
  }

  function invalidateSnapshots(providerId = null) {
    if (providerId) {
      snapshotCache.delete(providerId);
      return;
    }
    snapshotCache.clear();
  }

  function cloneSnapshotResult(result) {
    return {
      provider: result.provider,
      agents: result.agents.map(cloneAgent),
      scannedAt: result.scannedAt,
      error: result.error
    };
  }

  function cloneAgent(agent) {
    return {
      ...agent,
      parentId: normalizeOptionalString(agent.parentId),
      children: normalizeStringList(agent.children),
      childPids: Array.isArray(agent.childPids) ? [...agent.childPids] : [],
      capabilities: normalizeCapabilities(agent.capabilities),
      logs: Array.isArray(agent.logs) ? agent.logs.map((entry) => ({ ...entry })) : agent.logs,
      transcript: Array.isArray(agent.transcript) ? agent.transcript.map((entry) => ({ ...entry })) : agent.transcript
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

  return {
    async providers() {
      return listProviderStatus();
    },
    listAgents,
    refreshSnapshots,
    getAgent,
    listHistory: stateStore.listHistory,
    testProvider,
    performAction,
    invalidateSnapshots
  };
}

export function applySampledTokenRates(providerId, agents, scannedAt = Date.now(), previousSnapshots = new Map()) {
  return agents.map((agent) => {
    const tokens = Number(agent.tokens || 0);
    const reportedRate = Number(agent.tokensPerSecond || 0);
    const key = `${providerId}:${agent.id}`;
    const previous = previousSnapshots.get(key);
    previousSnapshots.set(key, { tokens, scannedAt });

    if (!Number.isFinite(tokens) || tokens <= 0 || reportedRate > 0 || !previous) {
      return agent;
    }

    const elapsedMs = Math.max(0, scannedAt - Number(previous.scannedAt || 0));
    const tokenDelta = tokens - Number(previous.tokens || 0);
    if (elapsedMs <= 0 || tokenDelta <= 0) {
      return agent;
    }

    return {
      ...agent,
      tokensPerSecond: Number((tokenDelta / (elapsedMs / 1000)).toFixed(2)),
      tokenRateWindowMs: elapsedMs
    };
  });
}

export function buildProviderErrorSnapshot(provider, cached, scannedAt, cacheTtlMs, error) {
  return {
    provider,
    agents: Array.isArray(cached?.agents) ? cached.agents.map((agent) => ({ ...agent })) : [],
    scannedAt,
    cacheTtlMs,
    error
  };
}
