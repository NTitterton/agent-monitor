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
    ...(Object.hasOwn(patch, "remoteHttpProviders")
      ? { remoteHttpProviders: normalizeRemoteHttpProviders(patch.remoteHttpProviders, current.remoteHttpProviders) }
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
    remoteHttpProviders: publicRemoteHttpProviders(config.remoteHttpProviders),
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

function publicRemoteHttpProviders(providers) {
  if (!Array.isArray(providers)) return [];

  return providers
    .filter((provider) => provider && provider.id && provider.baseUrl)
    .map((provider) => ({
      id: String(provider.id),
      label: provider.label || provider.id,
      source: provider.source || "cloud",
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
        baseUrl: String(provider.baseUrl).trim().replace(/\/+$/, ""),
        ...(provider.token ? { token: String(provider.token) } : {}),
        ...(provider.timeoutMs ? { timeoutMs: Number(provider.timeoutMs) } : {})
      };
    });
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

function normalizeStringList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}
