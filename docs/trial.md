# Trial Guide

Use this guide to trial qdcli on a new project.

1. Enter the Nix shell with `nix develop`.
2. Run `just install && just build`.
3. Run `qd setup`.
4. Configure the real green command with `qd config set ci-command --value "nix develop -c just ci"`.
5. Ask an agent to read `skills/qd-dag/SKILL.md`.
6. Build the initial DAG conversationally.
7. Run `qd validate`.
8. Work one ready node end to end.
9. Use `qd ci run <node>` for the check gate.
10. Start `qd view` to inspect topology and readiness.

The first trial is successful when one node moves from ready to done through claim, complete, audit, gate, CI pass, and merge.
