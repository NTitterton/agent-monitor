import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

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

  const providers = await request("/api/providers");
  assert(providers.status === 200, "provider status request should succeed");
  assert(providers.body.providers.every((provider) => typeof provider.scannedAt === "number"), "every provider should include scan timestamp");
  assert(
    providers.body.providers.find((provider) => provider.id === "local-process")?.capabilities.includes("go-to"),
    "local process provider should expose go-to"
  );

  const providerTest = await request("/api/providers/local-process/test", { method: "POST" });
  assert(providerTest.status === 200, "provider connection test should succeed");
  assert(providerTest.body.provider.id === "local-process", "provider connection test should return provider status");
  assert(providerTest.body.provider.status === "ok", "local process provider test should be ok");

  const unauthorized = await request("/api/agents", {
    headers: { Origin: allowedOrigin }
  });
  assert(unauthorized.status === 401, "cross-origin request without token should be unauthorized");

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
  assert(updatedConfig.body.config.snapshotRefresh.enabled === true, "config update should enable snapshot refresh");
  assert(updatedConfig.body.config.snapshotRefresh.intervalMs === 12000, "config update should persist snapshot interval");
  assert(updatedConfig.body.config.localDiscovery.include[0] === "custom-agent", "config update should persist include list");
  assert(updatedConfig.body.config.remoteHttpProviders[0]?.id === "smoke-remote", "config update should add remote provider");
  assert(updatedConfig.body.config.remoteHttpProviders[0]?.type === "smoke-remote", "remote provider should expose type");
  assert(updatedConfig.body.config.remoteHttpProviders[0]?.hasToken === true, "public remote provider should report token presence");
  assert(!("token" in updatedConfig.body.config.remoteHttpProviders[0]), "public remote provider should not expose token");

  const configFileAfterUpdate = JSON.parse(await readFile(configPath, "utf8"));
  assert(configFileAfterUpdate.apiToken === apiToken, "config update should preserve token");
  assert(configFileAfterUpdate.snapshotRefresh.intervalMs === 12000, "config file should include snapshot refresh");
  assert(configFileAfterUpdate.allowedOrigins.includes(addedOrigin), "config file should include added origin");
  assert(configFileAfterUpdate.remoteHttpProviders[0]?.dashboardUrl === `${apiBase}/dashboard`, "config file should store remote dashboard URL");
  assert(configFileAfterUpdate.remoteHttpProviders[0]?.token === "remote-secret", "config file should store remote token");

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

  const detail = await request("/api/agents/local-codex-1");
  assert(detail.status === 200, "agent detail should succeed");
  assert(detail.body.agent.id === "local-codex-1", "agent detail should return requested agent");
  assert(detail.body.children[0]?.id === "openai-research-2", "agent detail should include children");
  assert(detail.body.history[0]?.prompt === "smoke test", "agent detail should include agent history");
  assert(detail.body.agent.logs[0]?.source === "operator", "agent detail should include logs");

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

  const stateFile = JSON.parse(await readFile(statePath, "utf8"));
  assert(stateFile.history.length > 0, "state file should contain history");
  assert(stateFile.agents.find((agent) => agent.id === "local-codex-1")?.logs?.length > 0, "state file should contain logs");

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

  console.log("Smoke test passed");
} finally {
  await stopServer(server);
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
