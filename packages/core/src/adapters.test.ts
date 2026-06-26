import { describe, expect, it } from "vite-plus/test";
import { adaptImportSource } from "./index.js";

describe("import adapters", () => {
  it("normalizes roadmap html cards", () => {
    const output = adaptImportSource(
      "roadmap-html",
      `
      <section class="card done ph-baseline">
        <h3>Bootstrap Runtime</h3>
        <span class="ph">baseline</span>
        <p class="goal">Create the runtime shell.</p>
        <ul><li>Runtime starts</li></ul>
      </section>
      <section class="card active">
        <h3>Wire Agent</h3>
        <span class="dep">Bootstrap Runtime</span>
        <p class="goal">Connect the agent.</p>
        <ul><li>Agent responds</li></ul>
      </section>
    `,
    );

    expect(output.nodes.map((node) => [node.id, node.status, node.milestone])).toEqual([
      ["bootstrap-runtime", "done", "baseline"],
      ["wire-agent", "working", undefined],
    ]);
    expect(output.edges).toEqual([
      { from_node: "bootstrap-runtime", to_node: "wire-agent", type: "requires" },
    ]);
  });

  it("normalizes markdown checklists", () => {
    const output = adaptImportSource(
      "markdown-checklist",
      `
      - [x] Bootstrap Runtime
        - acceptance: Runtime starts
      - [ ] Wire Agent
        - Connect the agent
        - depends on: Bootstrap Runtime
    `,
    );

    expect(output.nodes.map((node) => [node.id, node.status, node.spec])).toEqual([
      ["bootstrap-runtime", "done", "Bootstrap Runtime"],
      ["wire-agent", "ready", "Connect the agent"],
    ]);
    expect(output.edges).toEqual([
      { from_node: "bootstrap-runtime", to_node: "wire-agent", type: "requires" },
    ]);
  });
});
