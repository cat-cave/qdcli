# Trial Guide

Use this guide to trial qdcli on a new project.

1. Make sure `qd` is installed and available on PATH.
2. Run `qd setup`.
3. Configure preflight and green gates with the target repo's real commands.
4. Run `qd agent install skills-sh`.
5. Ask the orchestrator agent to read the installed qd DAG skill.
6. Build the initial DAG conversationally.
7. Run `qd validate`.
8. Work one ready node end to end.
9. Use `qd snapshot --json` and `qd finding list --open --json` for orchestration state.
10. Use `qd check run <node>` for fast preflight and `qd ci run <node>` for the merge gate.
11. Run `qd stats`, `qd critical-path`, and `qd eta` to inspect planning signal.
12. If using a qdcli source checkout, start `qd view` to inspect topology, readiness, velocity, critical path, and ETA.

The first trial is successful when the orchestrator moves one node from ready to done through delegation, claim, complete, audit, gate, CI pass, and merge while keeping main green.
