# Trial Guide

Use this guide to trial qdcli on a new project.

1. Enter the Nix shell with `nix develop`.
2. Run `just install && just build`.
3. Run `qd setup`.
4. Configure the real green command with `qd config set ci-command --value "nix develop -c just ci"`.
5. Ask the orchestrator agent to read `skills/qd-dag/SKILL.md`.
6. Build the initial DAG conversationally.
7. Run `qd validate`.
8. Work one ready node end to end.
9. Use `qd ci run <node>` for the check gate.
10. Run `qd stats`, `qd critical-path`, and `qd eta` to inspect planning signal.
11. Start `qd view` to inspect topology, readiness, velocity, critical path, and ETA.

The first trial is successful when the orchestrator moves one node from ready to done through delegation, claim, complete, audit, gate, CI pass, and merge while keeping main green.
