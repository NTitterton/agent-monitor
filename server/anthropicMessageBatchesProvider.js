import { lifecycleActions } from "../src/core.js";
import { readConfig } from "./config.js";

const baseUrl = "https://api.anthropic.com/v1";
const anthropicVersion = "2023-06-01";

export function createAnthropicMessageBatchesProvider(config) {
  return {
    id: config.id,
    label: config.label || "Anthropic Message Batches",
    source: "user-account",
    type: "anthropic",
    recordsHistory: false,
    capabilities: ["list", "stop", "interrupt", "end", "force-end"],
    async listAgents() {
      const batchConfigs = config.batches || [];
      return Promise.all(
        batchConfigs.map(async (batchConfig) => {
          const batch = await request(config, `/messages/batches/${encodeURIComponent(batchConfig.batchId)}`, {
            method: "GET"
          });
          return normalizeBatch(batch, config, batchConfig);
        })
      );
    },
    async performAction(agentId, actionId, prompt = "") {
      const batchConfig = (config.batches || []).find((item) => item.id === agentId);
      if (!batchConfig) return null;

      if (["stop", "interrupt", "end", "force-end"].includes(actionId)) {
        await request(config, `/messages/batches/${encodeURIComponent(batchConfig.batchId)}/cancel`, {
          method: "POST"
        });
      }

      const batch = await request(config, `/messages/batches/${encodeURIComponent(batchConfig.batchId)}`, {
        method: "GET"
      });
      return normalizeBatch(batch, config, batchConfig);
    }
  };
}

export async function readAnthropicMessageBatchesProviders() {
  const config = await readConfig();
  if (!Array.isArray(config.anthropicMessageBatchesProviders)) return [];

  return config.anthropicMessageBatchesProviders
    .filter((provider) => provider.id)
    .map((provider) =>
      createAnthropicMessageBatchesProvider({
        label: "Anthropic Message Batches",
        ...provider,
        apiKey: provider.apiKey || process.env[provider.apiKeyEnv || "ANTHROPIC_API_KEY"]
      })
    );
}

async function request(config, pathname, options) {
  if (!config.apiKey) {
    throw new Error(`${config.id} missing apiKey or apiKeyEnv`);
  }

  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: {
      Accept: "application/json",
      "Anthropic-Version": config.version || anthropicVersion,
      "Content-Type": "application/json",
      "x-api-key": config.apiKey
    }
  });

  if (!response.ok) {
    throw new Error(`${config.id} returned ${response.status}`);
  }

  return response.json();
}

function normalizeBatch(batch, providerConfig, batchConfig) {
  const counts = batch.request_counts || {};
  const processing = Number(counts.processing || 0);
  const succeeded = Number(counts.succeeded || 0);
  const errored = Number(counts.errored || 0);
  const canceled = Number(counts.canceled || 0);
  const expired = Number(counts.expired || 0);
  const total = processing + succeeded + errored + canceled + expired;
  const status = normalizeStatus(batch.processing_status, processing);
  const startedAt = batch.created_at ? Date.parse(batch.created_at) : Date.now();

  return {
    id: batchConfig.id,
    name: batchConfig.name || batch.id,
    provider: providerConfig.label || "Anthropic Message Batches",
    providerId: providerConfig.id,
    type: "anthropic",
    source: "user-account",
    status,
    parentId: batchConfig.parentId || null,
    task: batchConfig.task || `${total} batched requests`,
    cpu: 0,
    memoryMb: 0,
    tokens: 0,
    costUsd: 0,
    startedAt: Number.isNaN(startedAt) ? Date.now() : startedAt,
    endedAt: status === "ended" ? Date.now() : undefined,
    children: batchConfig.children || [],
    logs: [
      {
        at: Number.isNaN(startedAt) ? Date.now() : startedAt,
        level: "info",
        source: "anthropic",
        message: `Batch ${batch.id} is ${batch.processing_status || "unknown"} with ${total} request${total === 1 ? "" : "s"}.`
      },
      ...(errored
        ? [{
            at: Date.now(),
            level: "error",
            source: "anthropic",
            message: `${errored} request${errored === 1 ? "" : "s"} errored.`
          }]
        : [])
    ],
    remoteId: batch.id,
    requestCounts: counts,
    capabilities: lifecycleActions.map((action) => action.id)
  };
}

function normalizeStatus(status, processing) {
  if (processing > 0) return "running";

  return {
    in_progress: "running",
    canceling: "waiting",
    ended: "ended",
    completed: "ended",
    canceled: "ended",
    expired: "ended"
  }[status] || "waiting";
}
