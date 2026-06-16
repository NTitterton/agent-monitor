export default `
  :host {
    display: block;
    color: #172033;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }

  .widget {
    background: #ffffff;
    border: 1px solid #d7dce5;
    border-radius: 8px;
    box-shadow: 0 18px 45px rgba(25, 34, 51, 0.12);
    overflow: hidden;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 18px 20px;
    background: #172033;
    color: #ffffff;
  }

  header p,
  header h2,
  article p {
    margin: 0;
  }

  header p {
    color: #b8c2d4;
    font-size: 0.78rem;
    text-transform: uppercase;
  }

  header h2 {
    margin-top: 4px;
    font-size: 1.3rem;
    font-weight: 700;
  }

  header span {
    color: #dce3ee;
    font-size: 0.9rem;
  }

  .list {
    display: grid;
  }

  article {
    padding: 16px 20px;
    border-top: 1px solid #e6e9ef;
  }

  .agent-line {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }

  strong {
    font-size: 0.96rem;
  }

  article p {
    color: #5d687a;
    font-size: 0.82rem;
  }

  .metrics {
    margin-top: 10px;
  }

  .good,
  .idle,
  .warn,
  .done {
    border-radius: 999px;
    padding: 4px 8px;
    font-size: 0.75rem;
    text-transform: capitalize;
    white-space: nowrap;
  }

  .good {
    background: #dff8ea;
    color: #126735;
  }

  .idle {
    background: #eef1f5;
    color: #536071;
  }

  .warn {
    background: #fff1cc;
    color: #805500;
  }

  .done {
    background: #e6edf7;
    color: #344d75;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 12px;
  }

  button {
    border: 1px solid #cbd2dd;
    border-radius: 6px;
    background: #ffffff;
    color: #172033;
    cursor: pointer;
    font: inherit;
    font-size: 0.78rem;
    min-height: 30px;
    padding: 5px 8px;
  }

  button:hover:not(:disabled) {
    background: #f4f7fb;
  }

  button:disabled {
    color: #9aa3af;
    cursor: not-allowed;
  }

  button.danger {
    border-color: #efb6b6;
    color: #a62626;
  }
`;
