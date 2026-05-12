import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { pluginRoot } from "./helpers.mjs";

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(pluginRoot, relativePath), "utf8"));
}

function assertPluginAsset(relativePath) {
  assert.match(relativePath, /^\.\/assets\//);
  assert.ok(fs.existsSync(path.join(pluginRoot, relativePath)), `${relativePath} must exist`);
}

test("Codex plugin manifest is ready for install surfaces", () => {
  const manifest = readJson(".codex-plugin/plugin.json");

  assert.equal(manifest.name, "legax");
  assert.equal(manifest.skills, "./skills/");
  assert.equal(manifest.mcpServers, "./.mcp.json");
  assert.equal(manifest.interface.displayName, "Legax");
  assert.equal(manifest.interface.category, "Productivity");
  assert.ok(manifest.interface.longDescription.length > manifest.interface.shortDescription.length);
  assertPluginAsset(manifest.interface.composerIcon);
  assertPluginAsset(manifest.interface.logo);
  assert.ok(Array.isArray(manifest.interface.screenshots));
  assert.ok(manifest.interface.screenshots.length >= 1);
  for (const screenshot of manifest.interface.screenshots) {
    assertPluginAsset(screenshot);
  }
});

test("Codex plugin MCP config uses operator config by default", () => {
  const mcp = readJson(".mcp.json");
  const server = mcp.mcpServers.legax;

  assert.equal(server.command, "node");
  assert.deepEqual(server.args, ["./scripts/mcp-server.mjs"]);
  assert.equal(server.env?.LEGAX_CONFIG, undefined);
  assert.match(server.note, /default Legax config/i);
});

test("repo marketplace exposes the root Legax plugin", () => {
  const marketplace = readJson(".agents/plugins/marketplace.json");
  const plugin = marketplace.plugins.find((entry) => entry.name === "legax");

  assert.equal(marketplace.name, "legax");
  assert.equal(marketplace.interface.displayName, "Legax Plugins");
  assert.ok(plugin);
  assert.deepEqual(plugin.source, {
    source: "local",
    path: "./"
  });
  assert.deepEqual(plugin.policy, {
    installation: "AVAILABLE",
    authentication: "ON_INSTALL"
  });
  assert.equal(plugin.category, "Productivity");
});
