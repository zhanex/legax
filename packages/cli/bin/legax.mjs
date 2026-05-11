#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.env.LEGAX_PACKAGE_ROOT = path.join(packageRoot, "dist");
await import("../dist/scripts/legax-cli.mjs");
