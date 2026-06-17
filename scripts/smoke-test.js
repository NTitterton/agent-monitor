import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createOpenAIResponsesProvider } from "../server/openAIResponsesProvider.js";
import { createAnthropicMessageBatchesProvider } from "../server/anthropicMessageBatchesProvider.js";
import { createRemoteHttpProvider } from "../server/remoteHttpProvider.js";
import { inferLocalSurface, signalPidsForProcessTree, summarizeProcessResources } from "../server/localProcessProvider.js";
import { applySampledTokenRates, buildProviderErrorSnapshot, normalizeProviderAgent } from "../server/providerRegistry.js";
import { agentActions } from "../src/core.js";

const port = 5199;
const apiBase = `http://127.0.0.1:${port}`;
const allowedOrigin = "https://zo.computer";
const addedOrigin = "https://personal.example";
const apiToken = "smoke-token";

const tempDir = await mkdtemp(join(tmpdir(), "agent-monitor-smoke-"));
const configPath = join(tempDir, "agent-monitor.config.json");
const statePath = join(tempDir, "agent-state.json");
process.env.AGENT_MONITOR_CONFIG = configPath;
process.env.AGENT_MONITOR_STATE = statePath;

await writeFile(
  configPath,
  `${JSON.stringify(
    {
      apiToken,
      allowedOrigins: [allowedOrigin]
    },
    null,
    2
  )}\n`
);

let server = await startServer();

try {
  await assertStatus("/", 200);
  await assertStatus("/embed-standalone.html", 200);
  await assertStatus("/embed/agent-monitor-widget.js", 200);
  const standaloneWidgetSource = await readFile(new URL("../embed/agent-monitor-widget.js", import.meta.url), "utf8");
  assert(standaloneWidgetSource.includes("/api/snapshot"), "standalone widget should prefer the unified snapshot API");
  assert(standaloneWidgetSource.includes("/api/agents"), "standalone widget should keep legacy agent API fallback");
  assert(
    standaloneWidgetSource.includes("if (!response.ok) {") &&
      standaloneWidgetSource.includes("this.actionMessage =") &&
      standaloneWidgetSource.includes("payload?.error"),
    "standalone widget should render rejected API actions without local fallback"
  );
  assert(standaloneWidgetSource.includes("renderActionMessage"), "standalone widget should render action feedback");
  assert(standaloneWidgetSource.includes("observedAttributes"), "standalone widget should react to embed attribute changes");
  assert(standaloneWidgetSource.includes("scheduleRefresh()"), "standalone widget should reschedule polling when attributes change");
  assert(standaloneWidgetSource.includes("Math.min(Math.max(Math.round(value), 5000), 300000)"), "standalone widget should clamp refresh intervals");
  assert(standaloneWidgetSource.includes("authHeader()"), "standalone widget should support configurable auth headers");
  assert(standaloneWidgetSource.includes("Authorization: `Bearer ${token}`"), "standalone widget should support bearer auth");
  assert(standaloneWidgetSource.includes("normalizeWidgetAgents"), "standalone widget should normalize incoming snapshots");
  assert(standaloneWidgetSource.includes("this.snapshotAt = normalizeOptionalTimestamp(payload.snapshotAt)"), "standalone widget should preserve snapshot freshness");
  assert(standaloneWidgetSource.includes("Updated ${formatTimestamp(snapshotAt)}"), "standalone widget should render snapshot freshness");
  assert(standaloneWidgetSource.includes("normalizePidList"), "standalone widget should normalize process ID lists");
  assert(standaloneWidgetSource.includes("normalizeTokenConfidence"), "standalone widget should normalize token confidence");
  assert(standaloneWidgetSource.includes("tokensPerSecond: ending ? 0"), "standalone widget fallback should stop token throughput on ended actions");
  assert(standaloneWidgetSource.includes("providerId: agent.providerId"), "standalone widget fallback history should include provider ID");
  assert(standaloneWidgetSource.includes("action: action.id"), "standalone widget fallback history should include action ID");
  assert(standaloneWidgetSource.includes("actionKind: action.surface ?"), "standalone widget fallback history should classify action kind");
  const registrySource = await readFile(new URL("../server/providerRegistry.js", import.meta.url), "utf8");
  assert(registrySource.includes("Provider did not return updated agent"), "registry should reject unconfirmed provider actions");
  assert(registrySource.includes("Provider returned a different agent"), "registry should reject mismatched provider action confirmations");
  assert(registrySource.includes("buildProviderErrorSnapshot"), "registry should preserve cached agents on provider errors");
  assertSampledTokenRates();
  assertProviderErrorSnapshots();
  assertProviderAgentNormalization();
  const appSource = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
  assert(appSource.includes("renderActionMessage"), "browser app should render action feedback");
  assert(appSource.includes("actionKindLabel"), "browser app should label lifecycle versus surface history");
  assert(appSource.includes("return \"Unknown\""), "browser app should guard invalid timestamps");
  assert(appSource.includes("const statuses ="), "browser app should derive status filters from snapshots");
  assert(appSource.includes("agentProviderOptions"), "browser app should derive provider filter options from snapshots");
  assert(appSource.includes('data-filter="provider"'), "browser app should expose a provider filter");
  assert(appSource.includes("matchesProvider"), "browser app should filter by provider ID");
  assert(appSource.includes("searchableAgentFields"), "browser app should search task-manager context fields");
  assert(appSource.includes("agent.repository"), "browser app search should include remote repository context");
  assert(appSource.includes("agent.queue"), "browser app search should include queue context");
  assert(appSource.includes("compareAgents"), "browser app should support task-table sorting");
  assert(appSource.includes("priority-desc"), "browser app should sort by task priority");
  assert(appSource.includes("Status Pressure"), "browser app should present operational status sorting");
  assert(appSource.includes("statusRank(b) - statusRank(a)"), "browser app should sort statuses by task pressure");
  assert(appSource.includes("collectActionPrompt"), "browser app should cancel prompt actions when the prompt is canceled");
  assert(appSource.includes("window.confirm"), "browser app should confirm destructive actions");
  assert(
    appSource.includes("escapeText(agent.name)") &&
      appSource.includes("escapeAttribute(agent.id)") &&
      appSource.includes("escapeText(provider.label)") &&
      appSource.includes("escapeText(record.prompt)"),
    "browser app should escape provider-supplied agent, provider, and history text"
  );
  assert(appSource.includes("actionDisabledReason"), "browser app should explain disabled action controls");
  assert(appSource.includes("isTerminalStatus"), "browser app should treat provider terminal statuses as terminal");
  assert(appSource.includes("did not advertise"), "browser app should explain unadvertised provider capabilities");
  assert(appSource.includes("No progress reported"), "browser app detail panel should render task progress state");
  assert(appSource.includes("agentContextLine"), "browser app detail panel should render agent context");
  assert(appSource.includes("childrenLabel"), "browser app detail panel should preserve unresolved child lineage IDs");
  assert(appSource.includes("parentLabel"), "browser app detail panel should preserve unresolved parent lineage IDs");
  assert(appSource.includes("Provider Health"), "browser app detail panel should render provider health");
  assert(appSource.includes("Provider Object"), "browser app detail panel should render provider object metadata");
  assert(appSource.includes("providerObjectLine"), "browser app detail panel should summarize provider object metadata");
  assert(appSource.includes("Provider Issues"), "browser app summary should render provider issue count");
  assert(appSource.includes("<p>CPU</p>"), "browser app summary should render aggregate CPU");
  assert(appSource.includes("formatCpu(cpu)"), "browser app summary should format aggregate CPU");
  assert(appSource.includes("<p>Tokens</p>"), "browser app summary should render aggregate tokens");
  assert(appSource.includes("formatTokenTotal(tokens)"), "browser app summary should format aggregate tokens");
  assert(appSource.includes("<p>Tok/sec</p>"), "browser app summary should render aggregate token throughput");
  assert(appSource.includes("formatTokenRate({ tokensPerSecond: tokenRate })"), "browser app summary should format aggregate token throughput");
  assert(appSource.includes("parseOpenAIResponseLines"), "app settings should parse OpenAI launchable response rows");
  assert(appSource.includes("formatOpenAIResponseLines"), "app settings should format OpenAI launchable response rows");
  assert(appSource.includes("parseAnthropicBatchLines"), "app settings should parse Anthropic launchable batch rows");
  assert(appSource.includes("formatAnthropicBatchLines"), "app settings should format Anthropic launchable batch rows");
  assert(appSource.includes("summary-warning"), "browser app summary should highlight provider issues");
  assert(appSource.includes("detail-action-row"), "browser app detail panel should render lifecycle controls");
  assert(appSource.includes("renderAgentHealthLine"), "browser app table should render per-agent health freshness");
  assert(appSource.includes("Updated ${formatTimestamp(this.snapshotAt)}"), "browser app should render unified snapshot freshness");
  assert(appSource.includes("this.detail = buildDetail(this.selectedAgentId, snapshot.agents, snapshot.history)"), "browser app selected detail should refresh from snapshots");
  assert(appSource.includes('data-setting="apiToken"'), "app settings should include write-only API token control");
  assert(appSource.includes("...(apiToken ? { apiToken } : {})"), "app settings should only send nonblank API token updates");
  const clientSource = await readFile(new URL("../src/client.js", import.meta.url), "utf8");
  assert(clientSource.includes("validationWarnings: [...payload.config.validationWarnings]"), "client should preserve config validation warnings after save refresh");
  assert(clientSource.includes("errorPayload?.agents"), "client detail errors should apply returned snapshot context");
  assert(clientSource.includes("mergeProviderStatus"), "client should apply provider test results to source status");
  assert(clientSource.includes("normalizePidList"), "client should normalize process ID lists");
  assert(clientSource.includes("normalizeTokenConfidence"), "client should normalize token confidence");
  assert(clientSource.includes("normalizeTimestamp"), "client should normalize timeline timestamps");
  assert(clientSource.includes("snapshotAt"), "client should preserve unified snapshot timestamps");
  const coreSource = await readFile(new URL("../src/core.js", import.meta.url), "utf8");
  assert(coreSource.includes("Unknown runtime"), "core runtime formatting should guard invalid timestamps");
  const stateStoreSource = await readFile(new URL("../server/stateStore.js", import.meta.url), "utf8");
  assert(stateStoreSource.includes("normalizeTimestamp(log.at)"), "state store should normalize log timestamps");
  assert(stateStoreSource.includes("normalizeTimestamp(entry.at)"), "state store should normalize transcript timestamps");
  assert(stateStoreSource.includes("normalizeTimestamp(record.at)"), "state store should normalize history timestamps");
  assert(stateStoreSource.includes("normalizeActionKind"), "state store should normalize history action kind");
  const moduleWidgetSource = await readFile(new URL("../src/widget.js", import.meta.url), "utf8");
  assert(moduleWidgetSource.includes("renderActionMessage"), "module widget should render action feedback");
  assert(moduleWidgetSource.includes("actionKindLabel"), "module widget should label lifecycle versus surface history");
  assert(moduleWidgetSource.includes("return \"Unknown\""), "module widget should guard invalid timestamps");
  assert(moduleWidgetSource.includes("function escapeText"), "module widget should escape dynamic text");
  assert(moduleWidgetSource.includes("escapeAttribute(agent.id)"), "module widget should escape provider-supplied attributes");
  assert(moduleWidgetSource.includes("actionDisabledReason"), "module widget should explain disabled action controls");
  assert(moduleWidgetSource.includes("isTerminalStatus"), "module widget should treat provider terminal statuses as terminal");
  assert(moduleWidgetSource.includes("did not advertise"), "module widget should explain unadvertised provider capabilities");
  assert(moduleWidgetSource.includes("lineageSummary(agent, agents)"), "module widget should resolve lineage names from the snapshot");
  assert(moduleWidgetSource.includes("renderProviderSummary"), "module widget should render provider/source health");
  assert(moduleWidgetSource.includes("this.snapshotAt = snapshot.snapshotAt"), "module widget should preserve snapshot freshness");
  assert(moduleWidgetSource.includes("Updated ${formatTimestamp(snapshotAt)}"), "module widget should render snapshot freshness");
  assert(moduleWidgetSource.includes("agentContextLine"), "module widget should render remote agent context");
  assert(moduleWidgetSource.includes("formatSpend(agent.costUsd)"), "module widget should render agent spend");
  assert(moduleWidgetSource.includes("sortWidgetAgents"), "module widget should order agents by task pressure");
  assert(moduleWidgetSource.includes("processing: 50"), "module widget should rank provider-specific active statuses");
  assert(moduleWidgetSource.includes("collectActionPrompt"), "module widget should cancel prompt actions when the prompt is canceled");
  assert(moduleWidgetSource.includes("window.confirm"), "module widget should confirm destructive actions");
  assert(standaloneWidgetSource.includes("actionDisabledReason"), "standalone widget should explain disabled action controls");
  assert(standaloneWidgetSource.includes("isTerminalStatus"), "standalone widget should treat provider terminal statuses as terminal");
  assert(standaloneWidgetSource.includes("did not advertise"), "standalone widget should explain unadvertised provider capabilities");
  assert(standaloneWidgetSource.includes("lineageSummary(agent, this.agents)"), "standalone widget should resolve lineage names from the snapshot");
  assert(standaloneWidgetSource.includes("renderProviderSummary"), "standalone widget should render provider/source health");
  assert(standaloneWidgetSource.includes("agentContextLine"), "standalone widget should render remote agent context");
  assert(standaloneWidgetSource.includes("formatSpend(agent.costUsd)"), "standalone widget should render agent spend");
  assert(standaloneWidgetSource.includes("sortWidgetAgents"), "standalone widget should order agents by task pressure");
  assert(standaloneWidgetSource.includes("processing: 50"), "standalone widget should rank provider-specific active statuses");
  assert(standaloneWidgetSource.includes("collectActionPrompt"), "standalone widget should cancel prompt actions when the prompt is canceled");
  assert(standaloneWidgetSource.includes("window.confirm"), "standalone widget should confirm destructive actions");
  assert(standaloneWidgetSource.includes("actionKindLabel"), "standalone widget should label lifecycle versus surface history");
  assert(standaloneWidgetSource.includes("Unknown runtime"), "standalone widget should guard invalid runtimes");
  assert(standaloneWidgetSource.includes("return \"Unknown\""), "standalone widget should guard invalid timestamps");

  const sameOriginAgents = await request("/api/agents");
  assert(sameOriginAgents.status === 200, "same-origin API request should succeed");
  assert(typeof sameOriginAgents.body.snapshotAt === "number", "agent list should include snapshot timestamp");
  assert(Array.isArray(sameOriginAgents.body.agents), "agent list should be an array");
  assert(sameOriginAgents.body.agents.every((agent) => agent.type), "every agent should include type");
  assert(sameOriginAgents.body.agents.every((agent) => typeof agent.tokens === "number"), "every agent should include numeric tokens");
  assert(sameOriginAgents.body.agents.every((agent) => typeof agent.tokensPerSecond === "number"), "every agent should include numeric token rate");
  assert(sameOriginAgents.body.agents.every((agent) => agent.tokenCountConfidence), "every agent should include token confidence");
  assert(sameOriginAgents.body.agents.every((agent) => typeof agent.costUsd === "number"), "every agent should include numeric cost");
  assert(sameOriginAgents.body.agents.every((agent) => typeof agent.cpu === "number"), "every agent should include numeric CPU");
  assert(sameOriginAgents.body.agents.every((agent) => typeof agent.memoryMb === "number"), "every agent should include numeric memory");
  const knownActionIds = new Set(agentActions.map((action) => action.id));
  assert(
    sameOriginAgents.body.agents.every(
      (agent) => Array.isArray(agent.capabilities) && agent.capabilities.every((capability) => knownActionIds.has(capability))
    ),
    "every agent should include known capabilities"
  );
  assert(
    sameOriginAgents.body.agents.every(
      (agent) => Array.isArray(agent.children) && agent.children.every((childId) => typeof childId === "string")
    ),
    "every agent should include string child IDs"
  );
  assert(sameOriginAgents.body.agents.every((agent) => typeof agent.scannedAt === "number"), "every agent should include scan timestamp");
  assert(
    sameOriginAgents.body.agents.find((agent) => agent.id === "remote-build-7")?.capabilities?.includes("go-to"),
    "remote sample should expose URL go-to"
  );
  assert(
    sameOriginAgents.body.agents.find((agent) => agent.id === "remote-build-7")?.goToKind === "url",
    "remote sample should identify URL go-to"
  );

  const snapshot = await request("/api/snapshot");
  assert(snapshot.status === 200, "snapshot request should succeed");
  assert(typeof snapshot.body.snapshotAt === "number", "snapshot should include snapshot timestamp");
  assert(Array.isArray(snapshot.body.agents), "snapshot should include agents");
  assert(Array.isArray(snapshot.body.providers), "snapshot should include providers");
  assert(Array.isArray(snapshot.body.history), "snapshot should include history");
  assert(snapshot.body.config.hasApiToken === true, "snapshot should include sanitized config");
  assert(!("apiToken" in snapshot.body.config), "snapshot should not expose token");
  assert(snapshot.body.scanner?.enabled === false, "snapshot should include disabled background scanner status by default");
  assert(
    snapshot.body.providers.find((provider) => provider.id === "local")?.scannedAt ===
      snapshot.body.agents.find((agent) => agent.providerId === "local")?.scannedAt,
    "snapshot provider status should reuse the agent scan"
  );

  const scannerStatus = await request("/api/scanner");
  assert(scannerStatus.status === 200, "scanner status request should succeed");
  assert(typeof scannerStatus.body.snapshotAt === "number", "scanner status should include snapshot timestamp");
  assert(scannerStatus.body.scanner.enabled === false, "scanner should default to disabled");

  const providers = await request("/api/providers");
  assert(providers.status === 200, "provider status request should succeed");
  assert(typeof providers.body.snapshotAt === "number", "provider status should include snapshot timestamp");
  assert(providers.body.providers.every((provider) => typeof provider.scannedAt === "number"), "every provider should include scan timestamp");
  assert(
    providers.body.providers.find((provider) => provider.id === "local-process")?.capabilities.includes("go-to"),
    "local process provider should expose go-to"
  );
  assert(
    providers.body.providers.find((provider) => provider.id === "local")?.scannedAt ===
      sameOriginAgents.body.agents.find((agent) => agent.providerId === "local")?.scannedAt,
    "provider status should reuse the fresh agent snapshot"
  );

  const providerTest = await request("/api/providers/local-process/test", { method: "POST" });
  assert(providerTest.status === 200, "provider connection test should succeed");
  assert(providerTest.body.provider.id === "local-process", "provider connection test should return provider status");
  assert(providerTest.body.provider.status === "ok", "local process provider test should be ok");
  assert(Array.isArray(providerTest.body.agents), "provider connection test should return agents");
  assert(Array.isArray(providerTest.body.history), "provider connection test should return history");
  assert(Array.isArray(providerTest.body.providers), "provider connection test should return provider status list");
  assert(providerTest.body.config?.hasApiToken === true, "provider connection test should return sanitized config");
  assert(providerTest.body.scanner, "provider connection test should return scanner status");
  assert(typeof providerTest.body.snapshotAt === "number", "provider connection test should return snapshot timestamp");

  const unauthorized = await request("/api/agents", {
    headers: { Origin: allowedOrigin }
  });
  assert(unauthorized.status === 401, "cross-origin request without token should be unauthorized");
  const unauthorizedSnapshot = await request("/api/snapshot", {
    headers: { Origin: allowedOrigin }
  });
  assert(unauthorizedSnapshot.status === 401, "cross-origin snapshot without token should be unauthorized");

  const preflight = await rawRequest("/api/agents", {
    method: "OPTIONS",
    headers: {
      Origin: allowedOrigin,
      "Access-Control-Request-Method": "GET",
      "Access-Control-Request-Headers": "X-Agent-Monitor-Token"
    }
  });
  assert(preflight.status === 204, "preflight should return 204");
  assert(
    preflight.headers.get("access-control-allow-origin") === allowedOrigin,
    "preflight should allow configured origin"
  );

  const authorized = await request("/api/agents", {
    headers: {
      Origin: allowedOrigin,
      "X-Agent-Monitor-Token": apiToken
    }
  });
  assert(authorized.status === 200, "cross-origin request with token should succeed");
  const authorizedSnapshot = await request("/api/snapshot", {
    headers: {
      Origin: allowedOrigin,
      "X-Agent-Monitor-Token": apiToken
    }
  });
  assert(authorizedSnapshot.status === 200, "cross-origin snapshot with token should succeed");
  const bearerAuthorized = await request("/api/snapshot", {
    headers: {
      Origin: allowedOrigin,
      Authorization: `Bearer ${apiToken}`
    }
  });
  assert(bearerAuthorized.status === 200, "cross-origin snapshot with bearer token should succeed");

  const config = await request("/api/config");
  assert(config.status === 200, "config request should succeed");
  assert(config.body.config.hasApiToken === true, "public config should report token presence");
  assert(!("apiToken" in config.body.config), "public config should not expose token");
  assert(config.body.config.allowedOrigins[0] === allowedOrigin, "public config should include trusted origins");

  const updatedConfig = await request("/api/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      allowedOrigins: [allowedOrigin, addedOrigin],
      localDiscovery: {
        enabled: false,
        include: ["custom-agent"],
        exclude: ["noisy-agent"]
      },
      localAgents: [
        {
          id: "smoke-local",
          name: "Smoke Local",
          command: "node",
          args: ["-e", "setTimeout(() => {}, 60000)"],
          match: "setTimeout(() => {}, 60000)",
          cwd: ".",
          env: ["SMOKE_LOCAL=1"]
        },
        {
          id: "smoke-missing-command",
          name: "Smoke Missing Command",
          command: "agent-monitor-missing-command",
          args: [],
          match: "agent-monitor-missing-command",
          cwd: "."
        }
      ],
      snapshotRefresh: {
        enabled: true,
        intervalMs: 12000
      },
      remoteHttpProviders: [
        {
          id: "smoke-remote",
          label: "Smoke Remote",
          source: "cloud",
          baseUrl: `${apiBase}/missing`,
          dashboardUrl: `${apiBase}/dashboard`,
          token: "remote-secret"
        }
      ]
    })
  });
  assert(updatedConfig.status === 200, "config update should succeed");
  assert(updatedConfig.body.config.allowedOrigins.includes(addedOrigin), "config update should add origin");
  assert(updatedConfig.body.config.localDiscovery.enabled === false, "config update should change discovery");
  assert(updatedConfig.body.config.localAgents[0]?.id === "smoke-local", "config update should expose local agent");
  assert(updatedConfig.body.config.localAgents[0]?.hasEnv === true, "public local agent should report env presence");
  assert(!("env" in updatedConfig.body.config.localAgents[0]), "public local agent should not expose env");
  assert(updatedConfig.body.config.snapshotRefresh.enabled === true, "config update should enable snapshot refresh");
  assert(updatedConfig.body.config.snapshotRefresh.intervalMs === 12000, "config update should persist snapshot interval");
  assert(updatedConfig.body.config.localDiscovery.include[0] === "custom-agent", "config update should persist include list");
  assert(updatedConfig.body.config.remoteHttpProviders[0]?.id === "smoke-remote", "config update should add remote provider");
  assert(updatedConfig.body.config.remoteHttpProviders[0]?.type === "smoke-remote", "remote provider should expose type");
  assert(updatedConfig.body.config.remoteHttpProviders[0]?.hasToken === true, "public remote provider should report token presence");
  assert(!("token" in updatedConfig.body.config.remoteHttpProviders[0]), "public remote provider should not expose token");

  const configFileAfterUpdate = JSON.parse(await readFile(configPath, "utf8"));
  assert(configFileAfterUpdate.apiToken === apiToken, "config update should preserve token");
  assert(configFileAfterUpdate.localAgents[0]?.env?.SMOKE_LOCAL === "1", "config file should store local agent env");
  assert(configFileAfterUpdate.snapshotRefresh.intervalMs === 12000, "config file should include snapshot refresh");
  assert(configFileAfterUpdate.allowedOrigins.includes(addedOrigin), "config file should include added origin");
  assert(configFileAfterUpdate.remoteHttpProviders[0]?.dashboardUrl === `${apiBase}/dashboard`, "config file should store remote dashboard URL");
  assert(configFileAfterUpdate.remoteHttpProviders[0]?.token === "remote-secret", "config file should store remote token");

  await waitFor(async () => {
    const status = await request("/api/scanner");
    return status.body.scanner.enabled === true && status.body.scanner.lastFinishedAt;
  });
  const enabledScannerStatus = await request("/api/scanner");
  assert(enabledScannerStatus.body.scanner.intervalMs === 12000, "scanner should use snapshot refresh interval");
  assert(enabledScannerStatus.body.scanner.providerCount >= 1, "scanner should refresh provider snapshots");

  const localStart = await request("/api/agents/smoke-local/actions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "start" })
  });
  assert(localStart.status === 200, "configured local agent start should succeed");
  assert(Array.isArray(localStart.body.providers), "local start should return provider status");
  assert(localStart.body.config?.hasApiToken === true, "local start should return sanitized config");
  assert(localStart.body.scanner?.enabled === true, "local start should return scanner status");
  const startedLocalAgent = localStart.body.agents.find((agent) => agent.id === "smoke-local");
  assert(startedLocalAgent?.status === "running", "configured local agent should report running after start");
  assert(typeof startedLocalAgent?.pid === "number", "configured local agent should report pid after start");
  assert(localStart.body.history[0]?.agentId === "smoke-local", "local start should be recorded in history");
  assert(localStart.body.history[0]?.provider === "Local Process", "local start history should include provider");
  assert(localStart.body.history[0]?.source === "local", "local start history should include source");
  assert(localStart.body.history[0]?.type === "local", "local start history should include type");

  const localForceEnd = await request("/api/agents/smoke-local/actions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "force-end" })
  });
  assert(localForceEnd.status === 200, "configured local agent force-end should succeed");
  assert(localForceEnd.body.history[0]?.action === "force-end", "local force-end should be recorded in history");

  const missingCommandStart = await request("/api/agents/smoke-missing-command/actions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "start" })
  });
  assert(missingCommandStart.status === 502, "missing local command start should return provider error");
  assert(
    missingCommandStart.body.error.includes("Failed to start local agent smoke-missing-command"),
    "missing local command start should return a clear provider error"
  );
  assert(Array.isArray(missingCommandStart.body.agents), "missing local command start should return agents");
  assert(Array.isArray(missingCommandStart.body.providers), "missing local command start should return provider status");
  assert(missingCommandStart.body.config?.hasApiToken === true, "missing local command start should return sanitized config");
  assert(missingCommandStart.body.scanner?.enabled === true, "missing local command start should return scanner status");
  assert(
    !missingCommandStart.body.history.some(
      (record) => record.agentId === "smoke-missing-command" && record.action === "start"
    ),
    "failed local start should not be recorded as successful history"
  );

  const remoteTokenPreserved = await request("/api/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      remoteHttpProviders: [
        {
          id: "smoke-remote",
          label: "Smoke Remote Updated",
          source: "cloud",
          baseUrl: `${apiBase}/missing`
        }
      ]
    })
  });
  assert(remoteTokenPreserved.status === 200, "remote provider update should succeed");
  const configFileAfterRemoteUpdate = JSON.parse(await readFile(configPath, "utf8"));
  assert(configFileAfterRemoteUpdate.remoteHttpProviders[0]?.token === "remote-secret", "remote token should be preserved when omitted");
  assert(configFileAfterRemoteUpdate.remoteHttpProviders[0]?.dashboardUrl === `${apiBase}/dashboard`, "remote dashboard URL should be preserved when omitted");

  const invalidConfig = await request("/api/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      remoteHttpProviders: [
        {
          id: "bad-remote",
          label: "Bad Remote",
          source: "cloud",
          baseUrl: "not-a-url"
        }
      ],
      openAIResponsesProviders: [
        {
          id: "bad-openai",
          responses: [{ id: "missing-response-id" }]
        }
      ],
      anthropicMessageBatchesProviders: [
        {
          id: "bad-anthropic",
          batches: [{ id: "missing-batch-id" }]
        }
      ]
    })
  });
  assert(invalidConfig.status === 200, "invalid config update should still return validation feedback");
  assert(invalidConfig.body.config.validationWarnings.length >= 2, "invalid config should return validation warnings");
  assert(
    invalidConfig.body.config.validationWarnings.some((warning) => warning.includes("baseUrl")),
    "invalid remote URL should produce a warning"
  );
  assert(
    invalidConfig.body.config.validationWarnings.some((warning) => warning.includes("responseId or model/input")),
    "invalid response row should produce a warning"
  );
  assert(
    invalidConfig.body.config.validationWarnings.some((warning) => warning.includes("batchId or model/input")),
    "invalid batch row should produce a warning"
  );

  const localEnvPreserved = await request("/api/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      localAgents: [
        {
          id: "smoke-local",
          name: "Smoke Local Updated",
          command: "node",
          args: ["--version"],
          match: "node --version",
          cwd: "."
        }
      ]
    })
  });
  assert(localEnvPreserved.status === 200, "local agent update should succeed");
  const configFileAfterLocalUpdate = JSON.parse(await readFile(configPath, "utf8"));
  assert(configFileAfterLocalUpdate.localAgents[0]?.env?.SMOKE_LOCAL === "1", "local agent env should be preserved when omitted");

  const updatedOriginRequest = await request("/api/agents", {
    headers: {
      Origin: addedOrigin,
      "X-Agent-Monitor-Token": apiToken
    }
  });
  assert(updatedOriginRequest.status === 200, "newly trusted origin should be allowed");

  const rotatedApiToken = "rotated-smoke-token";
  const rotatedTokenConfig = await request("/api/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiToken: rotatedApiToken })
  });
  assert(rotatedTokenConfig.status === 200, "API token rotation should succeed");
  assert(rotatedTokenConfig.body.config.hasApiToken === true, "rotated API token should remain sanitized");
  assert(!("apiToken" in rotatedTokenConfig.body.config), "rotated API token should not be exposed");
  const configFileAfterTokenRotation = JSON.parse(await readFile(configPath, "utf8"));
  assert(configFileAfterTokenRotation.apiToken === rotatedApiToken, "config file should store rotated API token");
  const rotatedOriginRequest = await request("/api/agents", {
    headers: {
      Origin: addedOrigin,
      "X-Agent-Monitor-Token": rotatedApiToken
    }
  });
  assert(rotatedOriginRequest.status === 200, "rotated API token should authorize trusted origins");

  const action = await request("/api/agents/local-codex-1/actions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "interrupt", prompt: "smoke test" })
  });
  assert(action.status === 200, "lifecycle action should succeed");
  assert(
    action.body.agents.find((agent) => agent.id === "local-codex-1")?.status === "waiting",
    "interrupt should move local-codex-1 to waiting"
  );
  assert(action.body.history[0]?.prompt === "smoke test", "action prompt should be recorded");
  assert(action.body.history[0]?.provider === "Local Codex", "action history should include provider");
  assert(action.body.history[0]?.source === "local", "action history should include source");
  assert(action.body.history[0]?.type === "local", "action history should include type");
  assert(action.body.history[0]?.actionKind === "lifecycle", "lifecycle action history should be classified");
  assert(
    action.body.agents.find((agent) => agent.id === "local-codex-1")?.logs?.[0]?.message.includes("smoke test"),
    "lifecycle action should append an agent log"
  );

  const unsupportedAction = await request("/api/agents/openai-research-2/actions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "start" })
  });
  assert(unsupportedAction.status === 409, "unsupported agent action should return conflict");
  assert(unsupportedAction.body.error === "Action not supported", "unsupported agent action should return a clear error");
  assert(Array.isArray(unsupportedAction.body.providers), "unsupported action should return provider status");

  const terminalAction = await request("/api/agents/remote-build-7/actions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "stop" })
  });
  assert(terminalAction.status === 409, "terminal agent lifecycle action should return conflict");
  assert(terminalAction.body.error === "Action not supported", "terminal agent lifecycle action should return a clear error");

  const invalidAction = await request("/api/agents/local-codex-1/actions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "launch-sideways" })
  });
  assert(invalidAction.status === 400, "invalid agent action should return bad request");
  assert(invalidAction.body.error === "Invalid action", "invalid agent action should return a clear error");
  assert(Array.isArray(invalidAction.body.providers), "invalid action should return provider status");

  const malformedAction = await request("/api/agents/local-codex-1/actions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{"
  });
  assert(malformedAction.status === 400, "malformed agent action JSON should return bad request");
  assert(malformedAction.body.error === "Invalid JSON", "malformed agent action JSON should return a clear error");

  const missingAgentAction = await request("/api/agents/missing-agent/actions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "stop" })
  });
  assert(missingAgentAction.status === 404, "missing agent action should return not found");
  assert(missingAgentAction.body.error === "Agent not found", "missing agent action should return a clear error");
  assert(Array.isArray(missingAgentAction.body.agents), "missing agent action should return agents");
  assert(Array.isArray(missingAgentAction.body.history), "missing agent action should return history");
  assert(Array.isArray(missingAgentAction.body.providers), "missing agent action should return provider status");
  assert(missingAgentAction.body.config?.hasApiToken === true, "missing agent action should return sanitized config");
  assert(missingAgentAction.body.scanner, "missing agent action should return scanner status");

  const detail = await request("/api/agents/local-codex-1");
  assert(detail.status === 200, "agent detail should succeed");
  assert(detail.body.agent.id === "local-codex-1", "agent detail should return requested agent");
  assert(detail.body.children[0]?.id === "openai-research-2", "agent detail should include children");
  assert(detail.body.history[0]?.prompt === "smoke test", "agent detail should include agent history");
  assert(detail.body.agent.logs[0]?.source === "operator", "agent detail should include logs");
  assert(detail.body.agent.transcript?.length > 0, "agent detail should include transcript");

  const missingDetail = await request("/api/agents/missing-agent");
  assert(missingDetail.status === 404, "missing agent detail should return not found");
  assert(missingDetail.body.error === "Agent not found", "missing agent detail should return a clear error");
  assert(Array.isArray(missingDetail.body.agents), "missing agent detail should return agents");
  assert(Array.isArray(missingDetail.body.history), "missing agent detail should return history");
  assert(Array.isArray(missingDetail.body.providers), "missing agent detail should return provider status");
  assert(missingDetail.body.config?.hasApiToken === true, "missing agent detail should return sanitized config");
  assert(missingDetail.body.scanner, "missing agent detail should return scanner status");

  await stopServer(server);
  const stateBeforeRestart = JSON.parse(await readFile(statePath, "utf8"));
  stateBeforeRestart.history.push({
    agentId: 123,
    agentName: 456,
    provider: 789,
    providerId: " legacy-provider ",
    source: " local ",
    type: " local ",
    action: "stop",
    prompt: " normalize me ",
    at: "2026-01-02T03:04:05.000Z"
  });
  await writeFile(statePath, `${JSON.stringify(stateBeforeRestart, null, 2)}\n`);
  server = await startServer();

  const persisted = await request("/api/agents");
  assert(
    persisted.body.agents.find((agent) => agent.id === "local-codex-1")?.status === "waiting",
    "agent status should persist after restart"
  );
  assert(persisted.body.history[0]?.prompt === "smoke test", "history should persist after restart");
  assert(
    persisted.body.agents.find((agent) => agent.id === "local-codex-1")?.logs?.[0]?.source === "operator",
    "agent logs should persist after restart"
  );
  assert(
    persisted.body.agents.find((agent) => agent.id === "local-codex-1")?.transcript?.length > 0,
    "agent transcript should persist after restart"
  );

  const persistedHistory = await request("/api/history");
  const legacyHistory = persistedHistory.body.history.find((record) => record.prompt === "normalize me");
  assert(legacyHistory?.id === "123-stop-1767323045000", "legacy history should receive a stable generated ID");
  assert(legacyHistory.agentId === "123", "legacy history should normalize agent ID to a string");
  assert(legacyHistory.agentName === "456", "legacy history should normalize agent name to a string");
  assert(legacyHistory.provider === "789", "legacy history should normalize provider to a string");
  assert(legacyHistory.providerId === "legacy-provider", "legacy history should trim provider ID");
  assert(legacyHistory.source === "local", "legacy history should trim source");
  assert(legacyHistory.type === "local", "legacy history should trim type");
  assert(legacyHistory.actionKind === "lifecycle", "legacy lifecycle history should infer action kind");
  assert(legacyHistory.label === "Stop", "legacy history should infer action label");
  assert(legacyHistory.at === Date.parse("2026-01-02T03:04:05.000Z"), "legacy history should normalize ISO timestamps");

  const stateFile = JSON.parse(await readFile(statePath, "utf8"));
  assert(stateFile.history.length > 0, "state file should contain history");
  assert(stateFile.agents.find((agent) => agent.id === "local-codex-1")?.logs?.length > 0, "state file should contain logs");
  assert(stateFile.agents.find((agent) => agent.id === "local-codex-1")?.transcript?.length > 0, "state file should contain transcript");

  const surfaceAction = await request("/api/agents/remote-build-7/actions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "go-to" })
  });
  assert(surfaceAction.status === 200, "surface go-to action should succeed");
  assert(surfaceAction.body.history[0]?.action === "go-to", "surface go-to should be recorded in history");
  assert(surfaceAction.body.history[0]?.actionKind === "surface", "surface go-to history should be classified");

  const accountProviderConfig = await request("/api/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      openAIResponsesProviders: [
        {
          id: "smoke-openai",
          label: "Smoke OpenAI",
          apiKeyEnv: "SMOKE_OPENAI_KEY",
          apiKey: "openai-secret",
          responses: [
            {
              id: "smoke-response",
              name: "Smoke Response",
              responseId: "resp_smoke",
              task: "Smoke response tracking"
            }
          ]
        }
      ],
      anthropicMessageBatchesProviders: [
        {
          id: "smoke-anthropic",
          label: "Smoke Anthropic",
          apiKeyEnv: "SMOKE_ANTHROPIC_KEY",
          apiKey: "anthropic-secret",
          batches: [
            {
              id: "smoke-batch",
              name: "Smoke Batch",
              batchId: "msgbatch_smoke",
              task: "Smoke batch tracking"
            }
          ]
        }
      ]
    })
  });
  assert(accountProviderConfig.status === 200, "account provider config update should succeed");
  assert(accountProviderConfig.body.config.openAIResponsesProviders[0]?.hasApiKey === true, "OpenAI public config should report API key presence");
  assert(accountProviderConfig.body.config.anthropicMessageBatchesProviders[0]?.hasApiKey === true, "Anthropic public config should report API key presence");
  assert(!("apiKey" in accountProviderConfig.body.config.openAIResponsesProviders[0]), "OpenAI public config should not expose API key");
  assert(!("apiKey" in accountProviderConfig.body.config.anthropicMessageBatchesProviders[0]), "Anthropic public config should not expose API key");

  const accountConfigFile = JSON.parse(await readFile(configPath, "utf8"));
  assert(accountConfigFile.openAIResponsesProviders[0]?.apiKey === "openai-secret", "OpenAI API key should be stored");
  assert(accountConfigFile.anthropicMessageBatchesProviders[0]?.apiKey === "anthropic-secret", "Anthropic API key should be stored");

  await request("/api/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      openAIResponsesProviders: [
        {
          id: "smoke-openai",
          label: "Smoke OpenAI Updated",
          apiKeyEnv: "SMOKE_OPENAI_KEY",
          responses: [
            {
              id: "smoke-response",
              name: "Smoke Response",
              responseId: "resp_smoke",
              task: "Smoke response tracking"
            }
          ]
        }
      ],
      anthropicMessageBatchesProviders: [
        {
          id: "smoke-anthropic",
          label: "Smoke Anthropic Updated",
          apiKeyEnv: "SMOKE_ANTHROPIC_KEY",
          batches: [
            {
              id: "smoke-batch",
              name: "Smoke Batch",
              batchId: "msgbatch_smoke",
              task: "Smoke batch tracking"
            }
          ]
        }
      ]
    })
  });
  const preservedAccountConfigFile = JSON.parse(await readFile(configPath, "utf8"));
  assert(preservedAccountConfigFile.openAIResponsesProviders[0]?.apiKey === "openai-secret", "OpenAI API key should be preserved when omitted");
  assert(preservedAccountConfigFile.anthropicMessageBatchesProviders[0]?.apiKey === "anthropic-secret", "Anthropic API key should be preserved when omitted");

  await assertAccountProviderCapabilities();
  await assertRemoteProviderNormalization();
  assertLocalSurfaceInference();
  assertProcessResourceAggregation();
  assertProcessTreeSignalOrder();

  console.log("Smoke test passed");
} finally {
  await stopServer(server);
}

async function assertRemoteProviderNormalization() {
  const originalFetch = globalThis.fetch;
  const fetchCalls = [];
  globalThis.fetch = async (url, options = {}) => {
    fetchCalls.push({ url: String(url), method: options.method || "GET" });

    if (String(url).endsWith("/agents")) {
      return jsonResponse({
        agents: [
          {
            id: "remote-normalized",
            name: "Remote Normalized",
            status: "running",
            startedAt: "2026-01-02T03:04:05.000Z",
            endedAt: "2026-01-02T04:04:05.000Z",
            owner: "platform-team",
            workspace: "agent-monitor",
            repository: "NTitterton/agent-monitor",
            branch: "main",
            parentId: 123,
            children: [456, "remote-child"],
            queue: "ci",
            priority: "high",
            currentStep: "Running tests",
            progressPercent: 42.4,
            cpu: "7.5",
            memoryMb: "256",
            processCpu: "2.5",
            processMemoryMb: 100,
            childCpu: 5,
            childMemoryMb: 156,
            pid: "200",
            parentPid: "100",
            childPids: ["201", 202, "not-a-pid"],
            capabilities: ["stop", "bogus", "stop"],
            goToTarget: "https://remote.example/agents/remote-normalized",
            logs: [{ at: "2026-01-02T03:05:05.000Z", message: "remote log" }],
            transcript: [{ at: "2026-01-02T03:06:05.000Z", role: "assistant", content: "remote transcript" }]
          },
          {
            id: "remote-view-only",
            name: "Remote View Only",
            status: "running",
            startedAt: "2026-01-02T03:04:05.000Z",
            goToTarget: "https://remote.example/agents/remote-view-only"
          }
        ]
      });
    }

    if (String(url).endsWith("/agents/remote-normalized/actions")) {
      const body = JSON.parse(options.body || "{}");
      return jsonResponse({
        agent: {
          id: "remote-normalized",
          name: "Remote Normalized",
          status: body.action === "stop" ? "waiting" : "running",
          capabilities: ["stop"]
        }
      });
    }

    return jsonResponse({ error: "unexpected smoke URL" }, 404);
  };

  try {
    const provider = createRemoteHttpProvider({
      id: "mock-remote",
      label: "Mock Remote",
      baseUrl: "https://remote.example/api"
    });
    const [agent, viewOnlyAgent] = await provider.listAgents();
    assert(agent.owner === "platform-team", "remote provider should preserve owner");
    assert(agent.workspace === "agent-monitor", "remote provider should preserve workspace");
    assert(agent.repository === "NTitterton/agent-monitor", "remote provider should preserve repository");
    assert(agent.branch === "main", "remote provider should preserve branch");
    assert(agent.parentId === "123", "remote provider should normalize parent IDs to strings");
    assert(agent.children.join(",") === "456,remote-child", "remote provider should normalize child IDs to strings");
    assert(agent.queue === "ci", "remote provider should preserve queue");
    assert(agent.priority === "high", "remote provider should preserve priority");
    assert(agent.currentStep === "Running tests", "remote provider should preserve current step");
    assert(agent.progressPercent === 42, "remote provider should normalize progress percent");
    assert(agent.startedAt === Date.parse("2026-01-02T03:04:05.000Z"), "remote provider should normalize ISO startedAt");
    assert(agent.endedAt === Date.parse("2026-01-02T04:04:05.000Z"), "remote provider should normalize ISO endedAt");
    assert(agent.cpu === 7.5, "remote provider should normalize CPU");
    assert(agent.memoryMb === 256, "remote provider should normalize memory");
    assert(agent.processCpu === 2.5, "remote provider should preserve own CPU");
    assert(agent.childCpu === 5, "remote provider should preserve child CPU");
    assert(agent.childMemoryMb === 156, "remote provider should preserve child memory");
    assert(agent.pid === 200, "remote provider should normalize pid");
    assert(agent.parentPid === 100, "remote provider should normalize parent pid");
    assert(agent.childPids.join(",") === "201,202", "remote provider should normalize child pids");
    assert(agent.capabilities.join(",") === "stop,go-to", "remote provider should normalize known unique capabilities");
    assert(viewOnlyAgent.capabilities.join(",") === "go-to", "remote provider should not invent lifecycle capabilities");
    assert(agent.logs[0]?.at === Date.parse("2026-01-02T03:05:05.000Z"), "remote provider should normalize log timestamps");
    assert(
      agent.transcript[0]?.at === Date.parse("2026-01-02T03:06:05.000Z"),
      "remote provider should normalize transcript timestamps"
    );

    const changedAgent = await provider.performAction("remote-normalized", "stop", "pause");
    assert(changedAgent.status === "waiting", "remote action response should normalize returned agent");
    const mutationCallsBeforeGoTo = fetchCalls.filter((call) => call.url.endsWith("/agents/remote-normalized/actions")).length;
    const goToAgent = await provider.performAction("remote-normalized", "go-to");
    const mutationCallsAfterGoTo = fetchCalls.filter((call) => call.url.endsWith("/agents/remote-normalized/actions")).length;
    assert(goToAgent.id === "remote-normalized", "remote go-to should return the current agent");
    assert(mutationCallsAfterGoTo === mutationCallsBeforeGoTo, "remote go-to should not call the action endpoint");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function assertProcessTreeSignalOrder() {
  const pids = signalPidsForProcessTree(10, [
    { pid: 10, ppid: 1 },
    { pid: 11, ppid: 10 },
    { pid: 12, ppid: 11 },
    { pid: 13, ppid: 10 },
    { pid: 14, ppid: 99 }
  ]);
  assert(pids.join(",") === "12,13,11,10", "local lifecycle signals should target descendants before root");
}

function assertLocalSurfaceInference() {
  const chromeSurface = inferLocalSurface(
    { command: "codex" },
    { pid: 10, ppid: 9, command: "codex" },
    [
      { pid: 9, ppid: 1, command: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" },
      { pid: 10, ppid: 9, command: "codex" }
    ]
  );
  assert(chromeSurface.goToKind === "browser", "Chrome-hosted agents should expose browser go-to");
  assert(chromeSurface.windowTitle === "Google Chrome", "Chrome-hosted agents should identify Chrome");
  assert(chromeSurface.goToTarget === "pid:10", "local surfaces should target the agent PID");

  const terminalSurface = inferLocalSurface(
    { command: "claude" },
    { pid: 20, ppid: 19, command: "claude" },
    [
      { pid: 19, ppid: 1, command: "/System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal" },
      { pid: 20, ppid: 19, command: "claude" }
    ]
  );
  assert(terminalSurface.goToKind === "terminal", "Terminal-hosted agents should expose terminal go-to");
  assert(terminalSurface.windowTitle === "Terminal", "Terminal-hosted agents should identify Terminal");

  const editorSurface = inferLocalSurface(
    { command: "aider" },
    { pid: 30, ppid: 29, command: "/bin/zsh -l" },
    [
      { pid: 29, ppid: 1, command: "/Applications/Cursor.app/Contents/MacOS/Cursor" },
      { pid: 30, ppid: 29, command: "/bin/zsh -l" }
    ]
  );
  assert(editorSurface.goToKind === "process", "Editor-hosted agents should expose process go-to");
  assert(editorSurface.windowTitle === "Cursor", "Editor-hosted agents should identify the editor before the shell");

  const unknownSurface = inferLocalSurface(
    { command: "custom-agent", pid: 40 },
    { pid: 40, ppid: 1, command: "custom-agent" },
    [{ pid: 40, ppid: 1, command: "custom-agent" }]
  );
  assert(unknownSurface.goToKind === "process", "Unknown running local agents should still expose process go-to");
  assert(unknownSurface.windowTitle === "Process 40", "Unknown running local agents should identify the PID");
}

function assertProcessResourceAggregation() {
  const resources = summarizeProcessResources(
    { cpu: 2.25, memoryMb: 100 },
    [
      { cpu: 3.15, memoryMb: 25 },
      { cpu: 0.44, memoryMb: 10 }
    ]
  );
  assert(resources.cpu === 5.9, "aggregate local CPU should include child processes");
  assert(resources.memoryMb === 135, "aggregate local memory should include child processes");
  assert(resources.processCpu === 2.3, "local process own CPU should be rounded");
  assert(resources.childCpu === 3.6, "local child CPU should be rounded");
  assert(resources.processMemoryMb === 100, "local process memory should be preserved");
  assert(resources.childMemoryMb === 35, "local child memory should be summed");
}

function assertSampledTokenRates() {
  const previous = new Map();
  const [first] = applySampledTokenRates(
    "mock-provider",
    [{ id: "agent-1", tokens: 100, tokensPerSecond: 0, tokenRateWindowMs: 0 }],
    1000,
    previous
  );
  const [second] = applySampledTokenRates(
    "mock-provider",
    [{ id: "agent-1", tokens: 160, tokensPerSecond: 0, tokenRateWindowMs: 0 }],
    4000,
    previous
  );
  const [reported] = applySampledTokenRates(
    "mock-provider",
    [{ id: "agent-1", tokens: 200, tokensPerSecond: 9, tokenRateWindowMs: 1000 }],
    5000,
    previous
  );

  assert(first.tokensPerSecond === 0, "first token sample should not invent a rate");
  assert(second.tokensPerSecond === 20, "token sampling should derive throughput from cumulative deltas");
  assert(second.tokenRateWindowMs === 3000, "token sampling should report the sample window");
  assert(reported.tokensPerSecond === 9, "provider-reported token rates should take precedence");
}

function assertProviderErrorSnapshots() {
  const error = new Error("temporary provider outage");
  const cached = {
    agents: [
      {
        id: "stale-agent",
        name: "Stale Agent",
        scannedAt: 1000
      }
    ]
  };
  const result = buildProviderErrorSnapshot(
    { id: "mock-provider", label: "Mock Provider" },
    cached,
    5000,
    1000,
    error
  );

  assert(result.error === error, "provider error snapshot should retain the provider error");
  assert(result.scannedAt === 5000, "provider error snapshot should use the failed scan timestamp");
  assert(result.agents[0]?.id === "stale-agent", "provider error snapshot should retain cached agents");
  result.agents[0].name = "Changed";
  assert(cached.agents[0].name === "Stale Agent", "provider error snapshot should clone cached agents");
}

function assertProviderAgentNormalization() {
  const scannedAt = Date.parse("2026-01-02T03:04:05.000Z");
  const agent = normalizeProviderAgent(
    {
      id: " third-party-cloud ",
      label: " Third Party Cloud ",
      source: " cloud ",
      type: " third-party "
    },
    {
      id: 123,
      name: "  ",
      provider: "  ",
      providerId: "  ",
      source: "  ",
      type: "  ",
      scannedAt: "not-a-timestamp"
    },
    scannedAt
  );

  assert(agent.id === "123", "registry should normalize provider agent IDs to strings");
  assert(agent.name === "123", "registry should fall back blank provider agent names to ID");
  assert(agent.provider === "Third Party Cloud", "registry should fall back blank provider labels to provider defaults");
  assert(agent.providerId === "third-party-cloud", "registry should fall back blank provider IDs to provider defaults");
  assert(agent.source === "cloud", "registry should fall back blank agent sources to provider source");
  assert(agent.type === "third-party", "registry should fall back blank agent types to provider type");
  assert(agent.scannedAt === scannedAt, "registry should normalize invalid agent scan timestamps to snapshot time");
}

async function assertAccountProviderCapabilities() {
  const originalFetch = globalThis.fetch;
  const fetchCalls = [];

  globalThis.fetch = async (url, options = {}) => {
    fetchCalls.push({ url: String(url), method: options.method || "GET" });

    if (String(url).includes("/responses/resp_smoke")) {
      return jsonResponse({
        id: "resp_smoke",
        status: "in_progress",
        model: "gpt-smoke",
        created_at: Math.floor(Date.now() / 1000),
        usage: { input_tokens: 10, output_tokens: 5 },
        output: []
      });
    }

    if (String(url).endsWith("/responses") && options.method === "POST") {
      const body = JSON.parse(options.body || "{}");
      assert(body.model === "gpt-smoke", "OpenAI start should create a response with the configured model");
      assert(body.input === "launch prompt", "OpenAI start should send the operator prompt as response input");
      assert(body.background === true, "OpenAI start should request background execution by default");
      return jsonResponse({
        id: "resp_created",
        status: "queued",
        model: body.model,
        created_at: Math.floor(Date.now() / 1000),
        usage: { input_tokens: 0, output_tokens: 0 },
        output: []
      });
    }

    if (String(url).includes("/responses/resp_created")) {
      return jsonResponse({
        id: "resp_created",
        status: "queued",
        model: "gpt-smoke",
        created_at: Math.floor(Date.now() / 1000),
        usage: { input_tokens: 0, output_tokens: 0 },
        output: []
      });
    }

    if (String(url).includes("/messages/batches/msgbatch_smoke")) {
      return jsonResponse({
        id: "msgbatch_smoke",
        processing_status: "in_progress",
        created_at: new Date().toISOString(),
        request_counts: { processing: 1, succeeded: 0, errored: 0, canceled: 0, expired: 0 }
      });
    }

    if (String(url).endsWith("/messages/batches") && options.method === "POST") {
      const body = JSON.parse(options.body || "{}");
      const request = body.requests?.[0];
      assert(request?.custom_id === "mock-batch-launch", "Anthropic start should create a batch request with the configured row ID");
      assert(request?.params?.model === "claude-smoke", "Anthropic start should create a batch with the configured model");
      assert(request?.params?.max_tokens === 1024, "Anthropic start should use the default max token limit");
      assert(
        request?.params?.messages?.[0]?.content === "batch launch prompt",
        "Anthropic start should send the operator prompt as batch input"
      );
      return jsonResponse({
        id: "msgbatch_created",
        processing_status: "in_progress",
        created_at: new Date().toISOString(),
        request_counts: { processing: 1, succeeded: 0, errored: 0, canceled: 0, expired: 0 }
      });
    }

    if (String(url).includes("/messages/batches/msgbatch_created")) {
      return jsonResponse({
        id: "msgbatch_created",
        processing_status: "in_progress",
        created_at: new Date().toISOString(),
        request_counts: { processing: 1, succeeded: 0, errored: 0, canceled: 0, expired: 0 }
      });
    }

    return jsonResponse({ error: "unexpected smoke URL" }, 404);
  };

  try {
    const openAIProvider = createOpenAIResponsesProvider({
      id: "mock-openai",
      apiKey: "test",
      responses: [{ id: "mock-response", responseId: "resp_smoke", goToTarget: "https://platform.openai.com/responses/resp_smoke" }]
    });
    const [openAIAgent] = await openAIProvider.listAgents();
    assert(openAIAgent.capabilities.includes("stop"), "OpenAI response should expose cancel-style actions");
    assert(openAIAgent.capabilities.includes("go-to"), "OpenAI response should expose configured go-to URL");
    assert(!openAIAgent.capabilities.includes("start"), "OpenAI response should not expose unsupported start action");
    const unsupportedOpenAIStart = await openAIProvider.performAction("mock-response", "start");
    assert(unsupportedOpenAIStart === null, "OpenAI response start should be unsupported");
    const openAIGoTo = await openAIProvider.performAction("mock-response", "go-to");
    assert(openAIGoTo.id === "mock-response", "OpenAI go-to should return the tracked response without cancellation");

    const configBeforeLaunch = JSON.parse(await readFile(configPath, "utf8"));
    configBeforeLaunch.openAIResponsesProviders = [
      {
        id: "mock-openai-launch",
        apiKey: "test",
        responses: [{ id: "mock-launch", name: "Mock Launch", model: "gpt-smoke", input: "configured input" }]
      }
    ];
    await writeFile(configPath, `${JSON.stringify(configBeforeLaunch, null, 2)}\n`);

    const launchableOpenAIProvider = createOpenAIResponsesProvider({
      id: "mock-openai-launch",
      apiKey: "test",
      responses: [{ id: "mock-launch", name: "Mock Launch", model: "gpt-smoke", input: "configured input" }]
    });
    const [launchableAgent] = await launchableOpenAIProvider.listAgents();
    assert(launchableAgent.status === "waiting", "OpenAI launchable response should render as waiting before start");
    assert(launchableAgent.capabilities.includes("start"), "OpenAI launchable response should expose start");
    assert(!launchableAgent.capabilities.includes("stop"), "OpenAI launchable response should not expose cancel before creation");
    const startedOpenAI = await launchableOpenAIProvider.performAction("mock-launch", "start", "launch prompt");
    assert(startedOpenAI.id === "mock-launch", "OpenAI start should return the configured launchable agent");
    assert(startedOpenAI.remoteId === "resp_created", "OpenAI start should track the created response id");
    const configAfterLaunch = JSON.parse(await readFile(configPath, "utf8"));
    assert(
      configAfterLaunch.openAIResponsesProviders[0]?.responses[0]?.responseId === "resp_created",
      "OpenAI start should persist the created response id"
    );

    const anthropicProvider = createAnthropicMessageBatchesProvider({
      id: "mock-anthropic",
      apiKey: "test",
      batches: [{ id: "mock-batch", batchId: "msgbatch_smoke", goToTarget: "https://console.anthropic.com/batches/msgbatch_smoke" }]
    });
    const [anthropicAgent] = await anthropicProvider.listAgents();
    assert(anthropicAgent.capabilities.includes("stop"), "Anthropic batch should expose cancel-style actions");
    assert(anthropicAgent.capabilities.includes("go-to"), "Anthropic batch should expose configured go-to URL");
    assert(!anthropicAgent.capabilities.includes("start"), "Anthropic batch should not expose unsupported start action");
    const unsupportedAnthropicStart = await anthropicProvider.performAction("mock-batch", "start");
    assert(unsupportedAnthropicStart === null, "Anthropic batch start should be unsupported");
    const anthropicGoTo = await anthropicProvider.performAction("mock-batch", "go-to");
    assert(anthropicGoTo.id === "mock-batch", "Anthropic go-to should return the tracked batch without cancellation");

    const configBeforeBatchLaunch = JSON.parse(await readFile(configPath, "utf8"));
    configBeforeBatchLaunch.anthropicMessageBatchesProviders = [
      {
        id: "mock-anthropic-launch",
        apiKey: "test",
        batches: [
          { id: "mock-batch-launch", name: "Mock Batch Launch", model: "claude-smoke", input: "configured batch input" }
        ]
      }
    ];
    await writeFile(configPath, `${JSON.stringify(configBeforeBatchLaunch, null, 2)}\n`);

    const launchableAnthropicProvider = createAnthropicMessageBatchesProvider({
      id: "mock-anthropic-launch",
      apiKey: "test",
      batches: [{ id: "mock-batch-launch", name: "Mock Batch Launch", model: "claude-smoke", input: "configured batch input" }]
    });
    const [launchableBatch] = await launchableAnthropicProvider.listAgents();
    assert(launchableBatch.status === "waiting", "Anthropic launchable batch should render as waiting before start");
    assert(launchableBatch.capabilities.includes("start"), "Anthropic launchable batch should expose start");
    assert(!launchableBatch.capabilities.includes("stop"), "Anthropic launchable batch should not expose cancel before creation");
    const startedBatch = await launchableAnthropicProvider.performAction("mock-batch-launch", "start", "batch launch prompt");
    assert(startedBatch.id === "mock-batch-launch", "Anthropic start should return the configured launchable batch");
    assert(startedBatch.remoteId === "msgbatch_created", "Anthropic start should track the created batch id");
    const configAfterBatchLaunch = JSON.parse(await readFile(configPath, "utf8"));
    assert(
      configAfterBatchLaunch.anthropicMessageBatchesProviders[0]?.batches[0]?.batchId === "msgbatch_created",
      "Anthropic start should persist the created batch id"
    );
    assert(
      fetchCalls.every((call) => !call.url.includes("/cancel") || call.method === "POST"),
      "cancel endpoints should only be called through explicit cancel-style actions"
    );
    assert(
      fetchCalls.every((call) => !call.url.includes("/cancel")),
      "go-to and unsupported start should not call cancel endpoints"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

async function startServer() {
  const child = spawn("node", ["server/index.js"], {
    cwd: new URL("..", import.meta.url).pathname,
    env: {
      ...process.env,
      AGENT_MONITOR_CONFIG: configPath,
      AGENT_MONITOR_STATE: statePath,
      PORT: String(port)
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });

  await waitFor(async () => {
    if (child.exitCode !== null) {
      throw new Error(`server exited early:\n${output}`);
    }
    const response = await rawRequest("/api/providers").catch(() => null);
    return response?.status === 200;
  });

  return child;
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;

  child.kill("SIGTERM");
  await new Promise((resolve) => {
    child.once("exit", resolve);
    setTimeout(resolve, 1500);
  });
}

async function assertStatus(pathname, status) {
  const response = await rawRequest(pathname);
  assert(response.status === status, `${pathname} should return ${status}, got ${response.status}`);
}

async function request(pathname, options = {}) {
  const response = await rawRequest(pathname, options);
  const text = await response.text();
  return {
    status: response.status,
    headers: response.headers,
    body: text ? JSON.parse(text) : null
  };
}

async function rawRequest(pathname, options = {}) {
  return fetch(`${apiBase}${pathname}`, options);
}

async function waitFor(check) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 5000) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("timed out waiting for server");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
