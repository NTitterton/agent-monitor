import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const defaultConfigPath = resolve(new URL("../agent-monitor.config.json", import.meta.url).pathname);

export async function readConfig() {
  try {
    return JSON.parse(await readFile(configPath(), "utf8"));
  } catch {
    return {};
  }
}

export async function readPublicConfig() {
  const config = await readConfig();
  return publicConfig(config);
}

export async function updateConfig(patch) {
  patch = patch && typeof patch === "object" ? patch : {};
  const current = await readConfig();
  const next = {
    ...current,
    ...(Object.hasOwn(patch, "allowedOrigins")
      ? { allowedOrigins: normalizeStringList(patch.allowedOrigins) }
      : {}),
    ...(Object.hasOwn(patch, "localDiscovery")
      ? { localDiscovery: normalizeLocalDiscovery(patch.localDiscovery, current.localDiscovery) }
      : {}),
    ...(Object.hasOwn(patch, "snapshotRefresh")
      ? { snapshotRefresh: normalizeSnapshotRefresh(patch.snapshotRefresh, current.snapshotRefresh) }
      : {}),
    ...(Object.hasOwn(patch, "remoteHttpProviders")
      ? { remoteHttpProviders: normalizeRemoteHttpProviders(patch.remoteHttpProviders, current.remoteHttpProviders) }
      : {}),
    ...(Object.hasOwn(patch, "openAIResponsesProviders")
      ? {
          openAIResponsesProviders: normalizeOpenAIResponsesProviders(
            patch.openAIResponsesProviders,
            current.openAIResponsesProviders
          )
        }
      : {}),
    ...(Object.hasOwn(patch, "anthropicMessageBatchesProviders")
      ? {
          anthropicMessageBatchesProviders: normalizeAnthropicMessageBatchesProviders(
            patch.anthropicMessageBatchesProviders,
            current.anthropicMessageBatchesProviders
          )
        }
      : {})
  };

  await writeConfig(next);
  return publicConfig(next);
}

async function writeConfig(config) {
  const target = configPath();
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(config, null, 2)}\n`);
}

function configPath() {
  return process.env.AGENT_MONITOR_CONFIG
    ? resolve(process.env.AGENT_MONITOR_CONFIG)
    : defaultConfigPath;
}

function publicConfig(config) {
  return {
    allowedOrigins: normalizeStringList(config.allowedOrigins),
    localDiscovery: normalizeLocalDiscovery(config.localDiscovery),
    snapshotRefresh: normalizeSnapshotRefresh(config.snapshotRefresh),
    remoteHttpProviders: publicRemoteHttpProviders(config.remoteHttpProviders),
    openAIResponsesProviders: publicOpenAIResponsesProviders(config.openAIResponsesProviders),
    anthropicMessageBatchesProviders: publicAnthropicMessageBatchesProviders(
      config.anthropicMessageBatchesProviders
    ),
    hasApiToken: Boolean(config.apiToken),
    providerCounts: {
      localAgents: Array.isArray(config.localAgents) ? config.localAgents.length : 0,
      remoteHttpProviders: Array.isArray(config.remoteHttpProviders) ? config.remoteHttpProviders.length : 0,
      openAIResponsesProviders: Array.isArray(config.openAIResponsesProviders)
        ? config.openAIResponsesProviders.length
        : 0,
      anthropicMessageBatchesProviders: Array.isArray(config.anthropicMessageBatchesProviders)
        ? config.anthropicMessageBatchesProviders.length
        : 0
    }
  };
}

function publicOpenAIResponsesProviders(providers) {
  if (!Array.isArray(providers)) return [];

  return providers
    .filter((provider) => provider && provider.id)
    .map((provider) => ({
      id: String(provider.id),
      label: provider.label || "OpenAI Responses",
      apiKeyEnv: provider.apiKeyEnv || "OPENAI_API_KEY",
      hasApiKey: Boolean(provider.apiKey),
      organization: provider.organization || "",
      project: provider.project || "",
      responses: normalizeTrackedItems(provider.responses, "responseId")
    }));
}

function publicAnthropicMessageBatchesProviders(providers) {
  if (!Array.isArray(providers)) return [];

  return providers
    .filter((provider) => provider && provider.id)
    .map((provider) => ({
      id: String(provider.id),
      label: provider.label || "Anthropic Message Batches",
      apiKeyEnv: provider.apiKeyEnv || "ANTHROPIC_API_KEY",
      hasApiKey: Boolean(provider.apiKey),
      version: provider.version || "",
      batches: normalizeTrackedItems(provider.batches, "batchId")
    }));
}

function publicRemoteHttpProviders(providers) {
  if (!Array.isArray(providers)) return [];

  return providers
    .filter((provider) => provider && provider.id && provider.baseUrl)
    .map((provider) => ({
      id: String(provider.id),
      label: provider.label || provider.id,
      source: provider.source || "cloud",
      type: provider.type || provider.id,
      baseUrl: provider.baseUrl,
      hasToken: Boolean(provider.token),
      timeoutMs: provider.timeoutMs
    }));
}

function normalizeRemoteHttpProviders(value, fallback = []) {
  if (!Array.isArray(value)) return [];

  const existingById = new Map(
    (Array.isArray(fallback) ? fallback : [])
      .filter((provider) => provider && provider.id)
      .map((provider) => [provider.id, provider])
  );

  return value
    .filter((provider) => provider && provider.id && provider.baseUrl)
    .map((provider) => {
      const existing = existingById.get(provider.id) || {};
      return {
        ...existing,
        id: String(provider.id).trim(),
        label: String(provider.label || provider.id).trim(),
        source: String(provider.source || existing.source || "cloud").trim(),
        type: String(provider.type || existing.type || provider.id).trim(),
        baseUrl: String(provider.baseUrl).trim().replace(/\/+$/, ""),
        ...(provider.token ? { token: String(provider.token) } : {}),
        ...(provider.timeoutMs ? { timeoutMs: Number(provider.timeoutMs) } : {})
      };
    });
}

function normalizeOpenAIResponsesProviders(value, fallback = []) {
  if (!Array.isArray(value)) return [];

  const existingById = providerMap(fallback);
  return value
    .filter((provider) => provider && provider.id)
    .map((provider) => {
      const existing = existingById.get(provider.id) || {};
      return {
        ...existing,
        id: String(provider.id).trim(),
        label: String(provider.label || existing.label || "OpenAI Responses").trim(),
        apiKeyEnv: String(provider.apiKeyEnv || existing.apiKeyEnv || "OPENAI_API_KEY").trim(),
        ...(provider.apiKey ? { apiKey: String(provider.apiKey) } : {}),
        ...(provider.organization ? { organization: String(provider.organization).trim() } : {}),
        ...(provider.project ? { project: String(provider.project).trim() } : {}),
        responses: normalizeTrackedItems(provider.responses, "responseId")
      };
    });
}

function normalizeAnthropicMessageBatchesProviders(value, fallback = []) {
  if (!Array.isArray(value)) return [];

  const existingById = providerMap(fallback);
  return value
    .filter((provider) => provider && provider.id)
    .map((provider) => {
      const existing = existingById.get(provider.id) || {};
      return {
        ...existing,
        id: String(provider.id).trim(),
        label: String(provider.label || existing.label || "Anthropic Message Batches").trim(),
        apiKeyEnv: String(provider.apiKeyEnv || existing.apiKeyEnv || "ANTHROPIC_API_KEY").trim(),
        ...(provider.apiKey ? { apiKey: String(provider.apiKey) } : {}),
        ...(provider.version ? { version: String(provider.version).trim() } : {}),
        batches: normalizeTrackedItems(provider.batches, "batchId")
      };
    });
}

function normalizeTrackedItems(items, remoteIdKey) {
  if (!Array.isArray(items)) return [];

  return items
    .filter((item) => item && item.id && item[remoteIdKey])
    .map((item) => ({
      id: String(item.id).trim(),
      name: String(item.name || item.id).trim(),
      [remoteIdKey]: String(item[remoteIdKey]).trim(),
      task: String(item.task || item.name || item.id).trim(),
      ...(item.parentId ? { parentId: String(item.parentId).trim() } : {}),
      ...(Array.isArray(item.children) ? { children: normalizeStringList(item.children) } : {})
    }));
}

function providerMap(providers) {
  return new Map(
    (Array.isArray(providers) ? providers : [])
      .filter((provider) => provider && provider.id)
      .map((provider) => [provider.id, provider])
  );
}

function normalizeLocalDiscovery(value = {}, fallback = {}) {
  const source = value && typeof value === "object" ? value : {};
  const fallbackSource = fallback && typeof fallback === "object" ? fallback : {};
  return {
    enabled: Object.hasOwn(source, "enabled")
      ? source.enabled !== false
      : fallbackSource.enabled !== false,
    include: normalizeStringList(source.include ?? fallbackSource.include),
    exclude: normalizeStringList(source.exclude ?? fallbackSource.exclude)
  };
}

function normalizeSnapshotRefresh(value = {}, fallback = {}) {
  const source = value && typeof value === "object" ? value : {};
  const fallbackSource = fallback && typeof fallback === "object" ? fallback : {};
  const intervalMs = Number(source.intervalMs ?? fallbackSource.intervalMs ?? 15000);
  return {
    enabled: Object.hasOwn(source, "enabled")
      ? source.enabled === true
      : fallbackSource.enabled === true,
    intervalMs: Number.isFinite(intervalMs) ? Math.min(Math.max(Math.round(intervalMs), 5000), 300000) : 15000
  };
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}
