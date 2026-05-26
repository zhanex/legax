#!/usr/bin/env node
import { startRelayServer } from "./lib/relay-server-core.mjs";

startRelayServer({
  args: process.argv.slice(2),
  env: process.env,
  mode: "managed"
});
