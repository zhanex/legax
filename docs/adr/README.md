# Architecture Decision Records

English | [Simplified Chinese](README.zh-CN.md)

This directory records durable technical decisions that should be understood before changing Legax architecture. ADRs are not setup guides; they explain why the project has a particular shape and what would need to be revisited to change it.

## Records

| ADR | Decision |
| --- | --- |
| [0001 Core Architecture Constraints](0001-core-architecture-constraints.md) | Dependency-free Node runtime, YAML-only config, three-plane architecture, relay-owned transport ingress, runtime-state and relay-store separation, and permission-boundary rules. |

## Writing New ADRs

- Use a short numbered filename: `NNNN-short-topic.md`.
- Add the Simplified Chinese pair in the same change.
- State status, context, decision, consequences, and what would reopen the decision.
- Link to the relevant code and docs instead of duplicating full implementation details.
