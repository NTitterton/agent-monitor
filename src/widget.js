import {
  formatMemory,
  formatRuntime,
  lifecycleActions,
  statusTone
} from "./core.js";
import { createAgentClient } from "./client.js";
import styles from "./widgetStyles.js";

const client = createAgentClient();

class AgentMonitorWidget extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    this.unsubscribe = client.subscribe((agents) => {
      this.agents = agents;
      this.render();
    });
  }

  disconnectedCallback() {
    this.unsubscribe?.();
  }

  render() {
    const agents = this.agents || [];
    const running = agents.filter((agent) => agent.status === "running").length;

    this.shadowRoot.innerHTML = `
      <style>${styles}</style>
      <section class="widget">
        <header>
          <div>
            <p>Agent Monitor</p>
            <h2>${running} running</h2>
          </div>
          <span>${agents.length} total</span>
        </header>
        <div class="list">
          ${agents.map(renderWidgetAgent).join("")}
        </div>
      </section>
    `;

    this.shadowRoot.querySelectorAll("[data-action]").forEach((button) => {
      button.addEventListener("click", () => {
        const agentId = button.getAttribute("data-agent-id");
        const actionId = button.getAttribute("data-action");
        const action = lifecycleActions.find((item) => item.id === actionId);
        const prompt = action?.requiresPrompt ? window.prompt(`${action.label} prompt`) || "" : "";
        void client.perform(agentId, actionId, prompt);
      });
    });
  }
}

function renderWidgetAgent(agent) {
  return `
    <article>
      <div class="agent-line">
        <div>
          <strong>${agent.name}</strong>
          <p>${agent.provider} · ${formatRuntime(agent)}</p>
        </div>
        <span class="${statusTone(agent.status)}">${agent.status}</span>
      </div>
      <p class="metrics">${agent.cpu}% CPU · ${formatMemory(agent.memoryMb)} · ${agent.tokens.toLocaleString()} tokens</p>
      <div class="actions">
        ${lifecycleActions.map((action) => renderAction(agent, action)).join("")}
      </div>
    </article>
  `;
}

function renderAction(agent, action) {
  const disabled =
    (agent.status === "ended" && action.id !== "start") ||
    (agent.status === "running" && action.id === "start");
  return `
    <button
      class="${action.destructive ? "danger" : ""}"
      type="button"
      data-agent-id="${agent.id}"
      data-action="${action.id}"
      ${disabled ? "disabled" : ""}
    >
      ${action.label}
    </button>
  `;
}

customElements.define("agent-monitor-widget", AgentMonitorWidget);
