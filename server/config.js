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
