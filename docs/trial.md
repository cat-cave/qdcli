# Trial Guide

Use this guide to trial qdcli on a new project.

1. Enter the Nix shell with `nix develop`.
2. Run `just install && just build`.
3. Run `qd setup`.
4. Ask an agent to read `skills/qd-dag/SKILL.md`.
5. Build the initial DAG conversationally.
6. Run `qd validate`.
7. Work one ready node end to end.
8. Start `qd view` to inspect topology and readiness.

The first trial is successful when one node moves from ready to done through claim, complete, audit, gate, CI pass, and merge.

