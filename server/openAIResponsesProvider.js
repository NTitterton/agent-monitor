import { lifecycleActions } from "../src/core.js";
import { readConfig } from "./config.js";

const baseUrl = "https://api.openai.com/v1";

export function createOpenAIResponsesProvider(config) {
  return {
    id: config.id,
    label: config.label || "OpenAI Responses",
    source: "user-account",
    recordsHistory: false,
    capabilities: ["list", "stop", "interrupt", "end", "force-end"],
    async listAgents() {
      const responseConfigs = config.responses || [];
      const responses = await Promise.all(
        responseConfigs.map(async (responseConfig) => {
          const response = await request(config, `/responses/${encodeURIComponent(responseConfig.responseId)}`, {
            method: "GET"
          });
          return normalizeResponse(response, config, responseConfig);
        })
      );

      return responses;
    },
    async performAction(agentId, actionId, prompt = "") {
      const responseConfig = (config.responses || []).find((item) => item.id === agentId);
      if (!responseConfig) return null;

      if (["stop", "interrupt", "end", "force-end"].includes(actionId)) {
        await request(config, `/responses/${encodeURIComponent(responseConfig.responseId)}/cancel`, {
          method: "POST"
        });
      }

      const response = await request(config, `/responses/${encodeURIComponent(responseConfig.responseId)}`, {
        method: "GET"
      });
      return normalizeResponse(response, config, responseConfig);
    }
  };
}

export async function readOpenAIResponsesProviders() {
  const config = await readConfig();
  if (!Array.isArray(config.openAIResponsesProviders)) return [];

  return config.openAIResponsesProviders
    .filter((provider) => provider.id)
    .map((provider) =>
      createOpenAIResponsesProvider({
        label: "OpenAI Responses",
        ...provider,
        apiKey: provider.apiKey || process.env[provider.apiKeyEnv || "OPENAI_API_KEY"]
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
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      ...(config.organization ? { "OpenAI-Organization": config.organization } : {}),
      ...(config.project ? { "OpenAI-Project": config.project } : {})
    }
  });

  if (!response.ok) {
    throw new Error(`${config.id} returned ${response.status}`);
  }

  return response.json();
}

function normalizeResponse(response, providerConfig, responseConfig) {
  const usage = response.usage || {};
  const inputTokens = Number(usage.input_tokens || 0);
  const outputTokens = Number(usage.output_tokens || 0);
  const status = normalizeStatus(response.status);
  const startedAt = response.created_at ? response.created_at * 1000 : Date.now();

  return {
    id: responseConfig.id,
    name: responseConfig.name || response.id,
    provider: providerConfig.label || "OpenAI Responses",
    providerId: providerConfig.id,
    source: "user-account",
    status,
    parentId: responseConfig.parentId || null,
    task: responseConfig.task || response.model || "OpenAI response",
    cpu: 0,
    memoryMb: 0,
    tokens: inputTokens + outputTokens,
    costUsd: 0,
    startedAt,
    endedAt: status === "ended" ? Date.now() : undefined,
    children: responseConfig.children || [],
    logs: [
      {
        at: startedAt,
        level: status === "ended" ? "info" : "info",
        source: "openai",
        message: `Response ${response.id} is ${response.status || "unknown"}${response.model ? ` on ${response.model}` : ""}.`
      },
      ...(response.error
        ? [{
            at: Date.now(),
            level: "error",
            source: "openai",
            message: response.error.message || "OpenAI response reported an error."
          }]
        : [])
    ],
    remoteId: response.id,
    model: response.model,
    capabilities: lifecycleActions.map((action) => action.id)
  };
}

function normalizeStatus(status) {
  return {
    queued: "waiting",
    in_progress: "running",
    completed: "ended",
    cancelled: "ended",
    failed: "ended",
    incomplete: "waiting"
  }[status] || "waiting";
}
