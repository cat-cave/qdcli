---
"@cat-cave/qdcli": patch
"@cat-cave/qdcli-core": patch
---

Polish the strict evidence-first workflow before wider trialing.

- Add `qd method show|status|acknowledge` with a stable method version/hash and a local acknowledgement gate for mutating roadmap and evidence commands.
- Add `qd template <name>` and `qd schema example <name>` so agents can start from valid structured report/spec/milestone JSON instead of inventing fields.
- Update README, package README, setup docs, LLM bootstrap docs, and installed skills to show method acknowledgement and valid completion/audit report flows.
- Fix stale quickstart examples that still used summary-only completion or underspecified clean audit reports.
- Keep notification language explicitly future-facing until notifier adapters exist.
