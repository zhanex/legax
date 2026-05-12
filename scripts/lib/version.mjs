import fs from "node:fs";
import { packageAssetPath } from "./paths.mjs";

let cachedVersion = "";

export function packageVersion() {
  if (cachedVersion) return cachedVersion;
  try {
    const rootPackage = JSON.parse(fs.readFileSync(packageAssetPath("package.json"), "utf8"));
    cachedVersion = typeof rootPackage.version === "string" && rootPackage.version
      ? rootPackage.version
      : "0.0.0";
  } catch {
    cachedVersion = "0.0.0";
  }
  return cachedVersion;
}

export function serverInfo(name) {
  return {
    name,
    version: packageVersion()
  };
}
