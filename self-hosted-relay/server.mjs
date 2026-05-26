#!/usr/bin/env node
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const installedCoreUrl = new URL("./lib/relay-server-core.mjs", import.meta.url);
const sourceCoreUrl = new URL("../scripts/lib/relay-server-core.mjs", import.meta.url);
const coreUrl = fs.existsSync(fileURLToPath(installedCoreUrl))
  ? installedCoreUrl
  : sourceCoreUrl;
const { startRelayServer } = await import(coreUrl.href);

startRelayServer({
  args: process.argv.slice(2),
  env: process.env,
  mode: "standalone"
});
