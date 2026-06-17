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
    ...(Object.hasOwn(patch, "apiToken") && String(patch.apiToken || "").trim()
      ? { apiToken: String(patch.apiToken).trim() }
      : {}),
    ...(Object.hasOwn(patch, "allowedOrigins")
      ? { allowedOrigins: normalizeStringList(patch.allowedOrigins) }
      : {}),
    ...(Object.hasOwn(patch, "localDiscovery")
      ? { localDiscovery: normalizeLocalDiscovery(patch.localDiscovery, current.localDiscovery) }
      : {}),
    ...(Object.hasOwn(patch, "localAgents")
      ? { localAgents: normalizeLocalAgents(patch.localAgents, current.localAgents) }
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
  return publicConfig(next, validateConfigPatch(patch));
}

export async function assignOpenAIResponseId(providerId, itemId, responseId) {
  const config = await readConfig();
  const providers = Array.isArray(config.openAIResponsesProviders) ? config.openAIResponsesProviders : [];
  let updated = false;

  const openAIResponsesProviders = providers.map((provider) => {
    if (provider?.id !== providerId) return provider;

    return {
      ...provider,
      responses: (Array.isArray(provider.responses) ? provider.responses : []).map((item) => {
        if (item?.id !== itemId) return item;
        updated = true;
        return {
          ...item,
          responseId
        };
      })
    };
  });

  if (!updated) return false;
  await writeConfig({
    ...config,
    openAIResponsesProviders
  });
  return true;
}

export async function assignAnthropicBatchId(providerId, itemId, batchId) {
  const config = await readConfig();
  const providers = Array.isArray(config.anthropicMessageBatchesProviders) ? config.anthropicMessageBatchesProviders : [];
  let updated = false;

  const anthropicMessageBatchesProviders = providers.map((provider) => {
    if (provider?.id !== providerId) return provider;

    return {
      ...provider,
      batches: (Array.isArray(provider.batches) ? provider.batches : []).map((item) => {
        if (item?.id !== itemId) return item;
        updated = true;
        return {
          ...item,
          batchId
        };
      })
    };
  });

  if (!updated) return false;
  await writeConfig({
    ...config,
    anthropicMessageBatchesProviders
  });
  return true;
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

function publicConfig(config, validationWarnings = []) {
  return {
    allowedOrigins: normalizeStringList(config.allowedOrigins),
    localAgents: publicLocalAgents(config.localAgents),
    localDiscovery: normalizeLocalDiscovery(config.localDiscovery),
    snapshotRefresh: normalizeSnapshotRefresh(config.snapshotRefresh),
    remoteHttpProviders: publicRemoteHttpProviders(config.remoteHttpProviders),
    openAIResponsesProviders: publicOpenAIResponsesProviders(config.openAIResponsesProviders),
    anthropicMessageBatchesProviders: publicAnthropicMessageBatchesProviders(
      config.anthropicMessageBatchesProviders
    ),
    hasApiToken: Boolean(config.apiToken),
    validationWarnings,
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

function validateConfigPatch(patch) {
  const warnings = [];
  if (!patch || typeof patch !== "object") return warnings;

  if (Object.hasOwn(patch, "localAgents")) {
    validateRows(patch.localAgents, "localAgents", ["id", "name", "command"], warnings);
  }

  if (Object.hasOwn(patch, "remoteHttpProviders")) {
    validateRows(patch.remoteHttpProviders, "remoteHttpProviders", ["id", "baseUrl"], warnings);
    for (const provider of Array.isArray(patch.remoteHttpProviders) ? patch.remoteHttpProviders : []) {
      if (provider?.baseUrl && !isHttpUrl(provider.baseUrl)) {
        warnings.push(`remoteHttpProviders ${provider.id || provider.baseUrl} baseUrl should be an http(s) URL.`);
      }
      if (provider?.dashboardUrl && !isHttpUrl(provider.dashboardUrl)) {
        warnings.push(`remoteHttpProviders ${provider.id || provider.dashboardUrl} dashboardUrl should be an http(s) URL.`);
      }
    }
  }

  if (Object.hasOwn(patch, "openAIResponsesProviders")) {
    validateRows(patch.openAIResponsesProviders, "openAIResponsesProviders", ["id"], warnings);
    for (const provider of Array.isArray(patch.openAIResponsesProviders) ? patch.openAIResponsesProviders : []) {
      validateOpenAIResponseRows(provider?.responses, `openAIResponsesProviders ${provider?.id || "unknown"} responses`, warnings);
    }
  }

  if (Object.hasOwn(patch, "anthropicMessageBatchesProviders")) {
    validateRows(patch.anthropicMessageBatchesProviders, "anthropicMessageBatchesProviders", ["id"], warnings);
    for (const provider of Array.isArray(patch.anthropicMessageBatchesProviders) ? patch.anthropicMessageBatchesProviders : []) {
      validateAnthropicBatchRows(
        provider?.batches,
        `anthropicMessageBatchesProviders ${provider?.id || "unknown"} batches`,
        warnings,
        provider?.discoverRecent === true
      );
    }
  }

  return warnings;
}

function validateRows(rows, label, requiredFields, warnings) {
  if (!Array.isArray(rows)) {
    warnings.push(`${label} should be a list.`);
    return;
  }

  const seen = new Set();
  rows.forEach((row, index) => {
    if (!row || typeof row !== "object") {
      warnings.push(`${label} row ${index + 1} should be an object.`);
      return;
    }

    for (const field of requiredFields) {
      if (!String(row[field] || "").trim()) {
        warnings.push(`${label} row ${index + 1} missing ${field}.`);
      }
    }

    if (row.id) {
      if (seen.has(row.id)) warnings.push(`${label} contains duplicate id ${row.id}.`);
      seen.add(row.id);
    }
  });
}

function validateOpenAIResponseRows(rows, label, warnings) {
  if (!Array.isArray(rows)) {
    warnings.push(`${label} should be a list.`);
    return;
  }

  const seen = new Set();
  rows.forEach((row, index) => {
    if (!row || typeof row !== "object") {
      warnings.push(`${label} row ${index + 1} should be an object.`);
      return;
    }

    if (!String(row.id || "").trim()) {
      warnings.push(`${label} row ${index + 1} missing id.`);
    }

    if (!String(row.responseId || "").trim() && !(String(row.model || "").trim() && String(row.input || "").trim())) {
      warnings.push(`${label} row ${index + 1} missing responseId or model/input launch fields.`);
    }

    if (row.id) {
      if (seen.has(row.id)) warnings.push(`${label} contains duplicate id ${row.id}.`);
      seen.add(row.id);
    }
  });
}

function validateAnthropicBatchRows(rows, label, warnings, allowEmpty = false) {
  if (!Array.isArray(rows)) {
    if (allowEmpty && rows === undefined) return;
    warnings.push(`${label} should be a list.`);
    return;
  }

  if (allowEmpty && rows.length === 0) return;

  const seen = new Set();
  rows.forEach((row, index) => {
    if (!row || typeof row !== "object") {
      warnings.push(`${label} row ${index + 1} should be an object.`);
      return;
    }

    if (!String(row.id || "").trim()) {
      warnings.push(`${label} row ${index + 1} missing id.`);
    }

    if (!String(row.batchId || "").trim() && !(String(row.model || "").trim() && String(row.input || "").trim())) {
      warnings.push(`${label} row ${index + 1} missing batchId or model/input launch fields.`);
    }

    if (row.id) {
      if (seen.has(row.id)) warnings.push(`${label} contains duplicate id ${row.id}.`);
      seen.add(row.id);
    }
  });
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
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
      responses: normalizeOpenAITrackedResponses(provider.responses)
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
      discoverRecent: provider.discoverRecent === true,
      discoverLimit: provider.discoverLimit || 10,
      dashboardUrl: provider.dashboardUrl || "",
      batches: normalizeAnthropicTrackedBatches(provider.batches)
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
      dashboardUrl: provider.dashboardUrl || "",
      hasToken: Boolean(provider.token),
      timeoutMs: provider.timeoutMs
    }));
}

function publicLocalAgents(agents) {
  if (!Array.isArray(agents)) return [];

  return agents
    .filter((agent) => agent && agent.id && agent.name && agent.command)
    .map((agent) => ({
      id: String(agent.id),
      name: agent.name,
      command: agent.command,
      args: normalizeStringList(agent.args),
      match: agent.match || agent.command,
      cwd: agent.cwd || ".",
      hasEnv: Boolean(agent.env && Object.keys(agent.env).length)
    }));
}

function normalizeLocalAgents(value, fallback = []) {
  if (!Array.isArray(value)) return [];

  const existingById = providerMap(fallback);
  return value
    .filter((agent) => agent && agent.id && agent.name && agent.command)
    .map((agent) => {
      const existing = existingById.get(agent.id) || {};
      const env = normalizeEnvLines(agent.env, existing.env);
      return {
        ...existing,
        id: String(agent.id).trim(),
        name: String(agent.name).trim(),
        command: String(agent.command).trim(),
        args: normalizeStringList(agent.args),
        match: String(agent.match || existing.match || agent.command).trim(),
        cwd: String(agent.cwd || existing.cwd || ".").trim(),
        ...(env ? { env } : {})
      };
    });
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
        ...(provider.dashboardUrl || existing.dashboardUrl
          ? { dashboardUrl: String(provider.dashboardUrl || existing.dashboardUrl).trim() }
          : {}),
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
        responses: normalizeOpenAITrackedResponses(provider.responses)
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
        discoverRecent: Object.hasOwn(provider, "discoverRecent")
          ? provider.discoverRecent === true
          : existing.discoverRecent === true,
        discoverLimit: normalizeDiscoverLimit(provider.discoverLimit ?? existing.discoverLimit),
        ...(provider.dashboardUrl || existing.dashboardUrl
          ? { dashboardUrl: String(provider.dashboardUrl || existing.dashboardUrl).trim() }
          : {}),
        batches: normalizeAnthropicTrackedBatches(provider.batches)
      };
    });
}

function normalizeDiscoverLimit(value) {
  const number = Number(value || 10);
  return Number.isFinite(number) ? Math.min(Math.max(Math.round(number), 1), 100) : 10;
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
      ...(item.goToTarget || item.dashboardUrl
        ? { goToTarget: String(item.goToTarget || item.dashboardUrl).trim() }
        : {}),
      ...(item.goToKind ? { goToKind: String(item.goToKind).trim() } : {}),
      ...(item.windowTitle ? { windowTitle: String(item.windowTitle).trim() } : {}),
      ...(Array.isArray(item.children) ? { children: normalizeStringList(item.children) } : {})
    }));
}

function normalizeOpenAITrackedResponses(items) {
  if (!Array.isArray(items)) return [];

  return items
    .filter((item) => {
      if (!item || !item.id) return false;
      const responseId = String(item.responseId || "").trim();
      const model = String(item.model || "").trim();
      const input = String(item.input || "").trim();
      return responseId || (model && input);
    })
    .map((item) => ({
      id: String(item.id).trim(),
      name: String(item.name || item.id).trim(),
      ...(item.responseId ? { responseId: String(item.responseId).trim() } : {}),
      ...(item.model ? { model: String(item.model).trim() } : {}),
      ...(item.input ? { input: String(item.input).trim() } : {}),
      task: String(item.task || item.name || item.id).trim(),
      ...(item.parentId ? { parentId: String(item.parentId).trim() } : {}),
      ...(item.goToTarget || item.dashboardUrl
        ? { goToTarget: String(item.goToTarget || item.dashboardUrl).trim() }
        : {}),
      ...(item.goToKind ? { goToKind: String(item.goToKind).trim() } : {}),
      ...(item.windowTitle ? { windowTitle: String(item.windowTitle).trim() } : {}),
      ...(Array.isArray(item.children) ? { children: normalizeStringList(item.children) } : {})
    }));
}

function normalizeAnthropicTrackedBatches(items) {
  if (!Array.isArray(items)) return [];

  return items
    .filter((item) => {
      if (!item || !item.id) return false;
      const batchId = String(item.batchId || "").trim();
      const model = String(item.model || "").trim();
      const input = String(item.input || "").trim();
      return batchId || (model && input);
    })
    .map((item) => ({
      id: String(item.id).trim(),
      name: String(item.name || item.id).trim(),
      ...(item.batchId ? { batchId: String(item.batchId).trim() } : {}),
      ...(item.model ? { model: String(item.model).trim() } : {}),
      ...(item.input ? { input: String(item.input).trim() } : {}),
      ...(item.maxTokens ? { maxTokens: Number(item.maxTokens) } : {}),
      task: String(item.task || item.name || item.id).trim(),
      ...(item.parentId ? { parentId: String(item.parentId).trim() } : {}),
      ...(item.goToTarget || item.dashboardUrl
        ? { goToTarget: String(item.goToTarget || item.dashboardUrl).trim() }
        : {}),
      ...(item.goToKind ? { goToKind: String(item.goToKind).trim() } : {}),
      ...(item.windowTitle ? { windowTitle: String(item.windowTitle).trim() } : {}),
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

function normalizeEnvLines(value, fallback = null) {
  if (value === undefined || value === null || value === "") return fallback || null;
  if (typeof value === "object" && !Array.isArray(value)) return value;
  const entries = normalizeStringList(Array.isArray(value) ? value : String(value).split("\n"))
    .map((line) => {
      const index = line.indexOf("=");
      if (index <= 0) return null;
      return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
    })
    .filter(Boolean);
  return entries.length ? Object.fromEntries(entries) : null;
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}
