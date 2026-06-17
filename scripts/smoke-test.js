import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createOpenAIResponsesProvider } from "../server/openAIResponsesProvider.js";
import { createAnthropicMessageBatchesProvider } from "../server/anthropicMessageBatchesProvider.js";
import { createRemoteHttpProvider } from "../server/remoteHttpProvider.js";
import { signalPidsForProcessTree, summarizeProcessResources } from "../server/localProcessProvider.js";

const port = 5199;
const apiBase = `http://127.0.0.1:${port}`;
const allowedOrigin = "https://zo.computer";
const addedOrigin = "https://personal.example";
const apiToken = "smoke-token";

const tempDir = await mkdtemp(join(tmpdir(), "agent-monitor-smoke-"));
const configPath = join(tempDir, "agent-monitor.config.json");
const statePath = join(tempDir, "agent-state.json");

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
  const appSource = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
  assert(appSource.includes("renderActionMessage"), "browser app should render action feedback");
  assert(
    appSource.includes("escapeText(agent.name)") &&
      appSource.includes("escapeAttribute(agent.id)") &&
      appSource.includes("escapeText(provider.label)") &&
      appSource.includes("escapeText(record.prompt)"),
    "browser app should escape provider-supplied agent, provider, and history text"
  );
  assert(appSource.includes("actionDisabledReason"), "browser app should explain disabled action controls");
  const moduleWidgetSource = await readFile(new URL("../src/widget.js", import.meta.url), "utf8");
  assert(moduleWidgetSource.includes("renderActionMessage"), "module widget should render action feedback");
  assert(moduleWidgetSource.includes("function escapeText"), "module widget should escape dynamic text");
  assert(moduleWidgetSource.includes("escapeAttribute(agent.id)"), "module widget should escape provider-supplied attributes");
  assert(moduleWidgetSource.includes("actionDisabledReason"), "module widget should explain disabled action controls");
  assert(moduleWidgetSource.includes("lineageSummary(agent, agents)"), "module widget should resolve lineage names from the snapshot");
  assert(standaloneWidgetSource.includes("actionDisabledReason"), "standalone widget should explain disabled action controls");
  assert(standaloneWidgetSource.includes("lineageSummary(agent, this.agents)"), "standalone widget should resolve lineage names from the snapshot");

  const sameOriginAgents = await request("/api/agents");
  assert(sameOriginAgents.status === 200, "same-origin API request should succeed");
  assert(Array.isArray(sameOriginAgents.body.agents), "agent list should be an array");
  assert(sameOriginAgents.body.agents.every((agent) => agent.type), "every agent should include type");
  assert(sameOriginAgents.body.agents.every((agent) => typeof agent.tokens === "number"), "every agent should include numeric tokens");
  assert(sameOriginAgents.body.agents.every((agent) => typeof agent.tokensPerSecond === "number"), "every agent should include numeric token rate");
  assert(sameOriginAgents.body.agents.every((agent) => agent.tokenCountConfidence), "every agent should include token confidence");
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
  assert(scannerStatus.body.scanner.enabled === false, "scanner should default to disabled");

  const providers = await request("/api/providers");
  assert(providers.status === 200, "provider status request should succeed");
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
  const startedLocalAgent = localStart.body.agents.find((agent) => agent.id === "smoke-local");
  assert(startedLocalAgent?.status === "running", "configured local agent should report running after start");
  assert(typeof startedLocalAgent?.pid === "number", "configured local agent should report pid after start");
  assert(localStart.body.history[0]?.agentId === "smoke-local", "local start should be recorded in history");

  const localForceEnd = await request("/api/agents/smoke-local/actions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "force-end" })
  });
  assert(localForceEnd.status === 200, "configured local agent force-end should succeed");
  assert(localForceEnd.body.history[0]?.action === "force-end", "local force-end should be recorded in history");

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
    invalidConfig.body.config.validationWarnings.some((warning) => warning.includes("responseId")),
    "invalid response row should produce a warning"
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

  const invalidAction = await request("/api/agents/local-codex-1/actions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "launch-sideways" })
  });
  assert(invalidAction.status === 400, "invalid agent action should return bad request");
  assert(invalidAction.body.error === "Invalid action", "invalid agent action should return a clear error");

  const detail = await request("/api/agents/local-codex-1");
  assert(detail.status === 200, "agent detail should succeed");
  assert(detail.body.agent.id === "local-codex-1", "agent detail should return requested agent");
  assert(detail.body.children[0]?.id === "openai-research-2", "agent detail should include children");
  assert(detail.body.history[0]?.prompt === "smoke test", "agent detail should include agent history");
  assert(detail.body.agent.logs[0]?.source === "operator", "agent detail should include logs");
  assert(detail.body.agent.transcript?.length > 0, "agent detail should include transcript");

  await stopServer(server);
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

  const stateFile = JSON.parse(await readFile(statePath, "utf8"));
  assert(stateFile.history.length > 0, "state file should contain history");
  assert(stateFile.agents.find((agent) => agent.id === "local-codex-1")?.logs?.length > 0, "state file should contain logs");
  assert(stateFile.agents.find((agent) => agent.id === "local-codex-1")?.transcript?.length > 0, "state file should contain transcript");

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
  assertProcessResourceAggregation();
  assertProcessTreeSignalOrder();

  console.log("Smoke test passed");
} finally {
  await stopServer(server);
}

async function assertRemoteProviderNormalization() {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).endsWith("/agents")) {
      return jsonResponse({
        agents: [
          {
            id: "remote-normalized",
            name: "Remote Normalized",
            status: "running",
            cpu: 7.5,
            memoryMb: 256,
            processCpu: 2.5,
            processMemoryMb: 100,
            childCpu: 5,
            childMemoryMb: 156,
            pid: 200,
            parentPid: 100,
            childPids: [201, 202],
            capabilities: ["stop"],
            goToTarget: "https://remote.example/agents/remote-normalized"
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
    const [agent] = await provider.listAgents();
    assert(agent.processCpu === 2.5, "remote provider should preserve own CPU");
    assert(agent.childCpu === 5, "remote provider should preserve child CPU");
    assert(agent.childMemoryMb === 156, "remote provider should preserve child memory");
    assert(agent.pid === 200, "remote provider should preserve pid");
    assert(agent.parentPid === 100, "remote provider should preserve parent pid");
    assert(agent.childPids.length === 2, "remote provider should preserve child pids");
    assert(agent.capabilities.includes("go-to"), "remote provider should add URL go-to capability");

    const changedAgent = await provider.performAction("remote-normalized", "stop", "pause");
    assert(changedAgent.status === "waiting", "remote action response should normalize returned agent");
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

    if (String(url).includes("/messages/batches/msgbatch_smoke")) {
      return jsonResponse({
        id: "msgbatch_smoke",
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
    assert(
      fetchCalls.every((call) => !call.url.includes("/cancel") || call.method === "POST"),
      "cancel endpoints should only be called through explicit cancel-style actions"
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
