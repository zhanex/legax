# ADR 0001: Core Architecture Constraints

English | [Simplified Chinese](0001-core-architecture-constraints.zh-CN.md)

Status: Accepted

## Context

Legax connects local agent CLIs to remote surfaces that can send text, approvals, input responses, and workflow actions. The project runs on operator machines and must stay easy to inspect, package, and run without a build system.

Several implementation choices are repeated across the repository: no runtime dependencies, YAML-only config, daemon-owned process lifecycle, MCP as a capability plane, relay-owned transport ingress, strict state ownership, and native approval mirroring. They need one durable decision record so future changes do not weaken the model by accident.

## Decision

Legax keeps these constraints:

1. Runtime scripts use Node.js standard library only.
2. Operator config is YAML only and parsed through the shared minimal parser.
3. CLI adapters are independent long-lived processes supervised by the daemon.
4. MCP tools expose capabilities and never own process lifecycle.
5. Relay-owned Telegram and Feishu/Lark ingress feed the same relay message queue used by browser messages.
6. `runtime-state.json` owns local cross-process coordination only.
7. `legax.relay/1` owns portable task/session truth.
8. Approval decisions must return through native structured callbacks when supported.
9. PTY/TUI control is fallback-only and must be documented as high-trust remote terminal control.
10. Remote workflow execution is restricted to allowlisted command refs, not arbitrary shell.

## Consequences

- Contributors must update shared helpers instead of adding parallel parsers, state files, or transport-specific routing paths.
- Adding a dependency requires an explicit architecture discussion, not just a local convenience argument.
- New adapters must fit the daemon supervision model and adapter conformance checklist.
- New relay APIs must document auth class, request/response shape, error behavior, and state ownership.
- Some integrations require more upfront protocol work because UI automation is not an acceptable shortcut for approvals.

## Reopen When

Revisit this ADR only if one of these becomes true:

- Node standard library cannot provide a security-critical primitive required by a supported feature.
- A stable config schema outgrows the hand-rolled YAML subset and migration cost is justified.
- A major supported CLI exposes only a terminal interface and no structured protocol, and the project accepts the risk of a documented high-trust backend.
- The relay store gains a formal multi-version migration system that changes state ownership rules.
