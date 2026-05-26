import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envPackageRoot = process.env.LEGAX_PACKAGE_ROOT;
export const packageRoot = envPackageRoot ? path.resolve(envPackageRoot) : path.resolve(__dirname, "..", "..");

export function legaxHome(env = process.env) {
  if (env.LEGAX_HOME) return path.resolve(env.LEGAX_HOME);
  if (process.platform === "win32" && env.APPDATA) return path.join(env.APPDATA, "Legax");
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "Legax");
  return path.join(env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "legax");
}

export function defaultConfigPath(env = process.env) {
  return path.join(legaxHome(env), "config.yaml");
}

export function defaultDataDir(env = process.env) {
  return path.join(legaxHome(env), "data");
}

export function packageAssetPath(...parts) {
  return path.join(packageRoot, ...parts);
}

export function configDirFromConfigPath(configPath) {
  return path.dirname(path.resolve(configPath));
}

export function resolveConfigPath(value = "", env = process.env) {
  const configured = value || env.LEGAX_CONFIG || defaultConfigPath(env);
  return path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured);
}

export function resolveConfigRelative(value, configPath) {
  if (!value) return "";
  return path.isAbsolute(value) ? value : path.resolve(configDirFromConfigPath(configPath), value);
}

export function resolveRuntimeFile(value, configPath, fallbackName, env = process.env) {
  if (value) return resolveConfigRelative(value, configPath);
  return path.join(defaultDataDir(env), fallbackName);
}
