// Probe codex CLI feature flags so the daemon can detect when the upstream
// remote_control + enable_fanout features graduate to "stable". Once both are
// stable, we can plug in the planned `cliBackend: app-server-remote-controller`
// path that bidirectionally connects to the desktop app. Until then this
// module is purely informational — it never alters runtime behavior.
//
// `codex features list` output, one row per line:
//   feature_name                       stage              effective_state
// e.g.
//   remote_control                     under development  false
//   enable_fanout                      under development  false
//   apps                               stable             true
//
// Stages observed in the wild: "stable", "experimental", "under development",
// "removed". We treat "stable" as the green-light signal.

import { spawnSync } from "node:child_process";

const ROW_RE = /^(?<name>[A-Za-z0-9_]+)\s+(?<stage>under development|experimental|stable|removed)\s+(?<state>true|false)\s*$/;

export function probeCodexFeatures(command = "codex", { timeoutMs = 5000 } = {}) {
  // Returns { ok, version, features: { name: { stage, state } }, raw, error }
  const result = spawnSync(command, ["features", "list"], {
    timeout: timeoutMs,
    encoding: "utf8",
    shell: process.platform === "win32"
  });
  if (result.error) {
    return { ok: false, error: result.error.message, features: {}, raw: "" };
  }
  if (typeof result.status !== "number" || result.status !== 0) {
    return { ok: false, error: `codex features list exited with ${result.status}`, features: {}, raw: result.stdout ?? "" };
  }
  const features = {};
  for (const line of String(result.stdout ?? "").split(/\r?\n/)) {
    const match = line.match(ROW_RE);
    if (!match || !match.groups) continue;
    features[match.groups.name] = {
      stage: match.groups.stage,
      state: match.groups.state === "true"
    };
  }
  // codex --version is cheap and tells us the build for diagnostics.
  let version = "";
  const versionResult = spawnSync(command, ["--version"], { timeout: timeoutMs, encoding: "utf8", shell: process.platform === "win32" });
  if (versionResult.status === 0) version = String(versionResult.stdout ?? "").trim();
  return { ok: true, version, features, raw: result.stdout ?? "" };
}

// Returns a short list of human-readable hints to surface to the operator (and
// optionally the phone). Each entry: { level, name, message }.
//   level: "info" — feature is interesting but not actionable yet
//          "ready" — feature is stable; user should consider switching modes
export function hintsForFeatures(probe) {
  if (!probe.ok) return [];
  const out = [];
  const remote = probe.features?.remote_control;
  const fanout = probe.features?.enable_fanout;
  if (remote) {
    if (remote.stage === "stable") {
      out.push({
        level: "ready",
        name: "remote_control",
        message: `codex remote_control is now stable in ${probe.version || "this codex build"}. Consider enabling cliBackend: app-server-remote-controller to bridge the desktop app bidirectionally (see docs/EXTENDING.md).`
      });
    } else if (remote.stage === "experimental") {
      out.push({
        level: "info",
        name: "remote_control",
        message: `codex remote_control is experimental in ${probe.version || "this build"} — try at your own risk; protocol may change without notice.`
      });
    }
  }
  if (fanout && fanout.stage === "stable") {
    out.push({
      level: "ready",
      name: "enable_fanout",
      message: `codex enable_fanout is stable in ${probe.version || "this codex build"}; multi-client turn fanout is now first-class.`
    });
  }
  return out;
}
