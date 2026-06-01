import fs from "node:fs";
import path from "node:path";

const DEFAULT_HIDDEN_NAMES = new Set([".git", "node_modules", "dist", "build"]);

function trimString(value) {
  return String(value ?? "").trim();
}

function resolveFromCwd(value) {
  return path.isAbsolute(value) ? path.resolve(value) : path.resolve(process.cwd(), value);
}

function sameOrChildPath(child, parent) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function rootLabel(rootPath) {
  const clean = rootPath.replace(/[\\/]+$/g, "");
  return path.basename(clean) || clean;
}

function configuredRootValues(config) {
  const values = config.daemon?.projectRoots;
  if (Array.isArray(values)) return values;
  if (typeof values === "string" && values.trim()) return [values];
  return [];
}

function hiddenNameSet(config) {
  const values = Array.isArray(config.daemon?.projectRootHiddenNames)
    ? config.daemon.projectRootHiddenNames
    : [];
  return new Set([...DEFAULT_HIDDEN_NAMES, ...values.map((value) => trimString(value)).filter(Boolean)]);
}

export function projectRoots(config) {
  return configuredRootValues(config)
    .map((value, index) => {
      const configuredPath = trimString(value);
      if (!configuredPath) return null;
      const absolutePath = resolveFromCwd(configuredPath);
      let realPath = "";
      let readable = false;
      try {
        realPath = fs.realpathSync(absolutePath);
        readable = fs.statSync(realPath).isDirectory();
      } catch {
        realPath = absolutePath;
      }
      return {
        id: `root-${index + 1}`,
        label: rootLabel(absolutePath),
        path: absolutePath,
        realPath,
        readable
      };
    })
    .filter((root) => root?.readable);
}

export function resolveProjectDirectory(config, { rootId, relativePath = "", projectPath = "" } = {}) {
  const roots = projectRoots(config);
  if (roots.length === 0) {
    throw new Error("No daemon.projectRoots are configured.");
  }
  const requestedRootId = trimString(rootId);
  const root = requestedRootId
    ? roots.find((item) => item.id === requestedRootId)
    : roots[0];
  if (!root) {
    throw new Error(`Unknown project root: ${requestedRootId}`);
  }
  if (!root.readable) {
    throw new Error(`Project root is not readable: ${root.path}`);
  }

  const requested = trimString(projectPath)
    ? resolveFromCwd(projectPath)
    : path.resolve(root.path, trimString(relativePath || "."));
  let realRequested;
  try {
    realRequested = fs.realpathSync(requested);
  } catch {
    throw new Error(`Project directory does not exist: ${requested}`);
  }
  if (!sameOrChildPath(realRequested, root.realPath)) {
    throw new Error("Project directory is outside the configured project root.");
  }
  if (!fs.statSync(realRequested).isDirectory()) {
    throw new Error(`Project path is not a directory: ${requested}`);
  }
  return {
    root,
    path: realRequested,
    relativePath: path.relative(root.realPath, realRequested).replaceAll("\\", "/")
  };
}

export function listProjectChildren(config, { rootId, relativePath = "" } = {}) {
  const { root, path: currentPath, relativePath: normalizedRelativePath } = resolveProjectDirectory(config, {
    rootId,
    relativePath
  });
  const hidden = hiddenNameSet(config);
  const maxEntries = Math.max(1, Math.floor(Number(config.daemon?.projectRootMaxEntries ?? 200) || 200));
  const entries = [];
  for (const entry of fs.readdirSync(currentPath, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (hidden.has(entry.name)) continue;
    const childPath = path.join(currentPath, entry.name);
    let realChildPath;
    try {
      realChildPath = fs.realpathSync(childPath);
    } catch {
      continue;
    }
    if (!sameOrChildPath(realChildPath, root.realPath)) continue;
    entries.push({
      name: entry.name,
      kind: "directory",
      path: path.relative(root.realPath, realChildPath).replaceAll("\\", "/")
    });
  }
  entries.sort((left, right) => left.name.localeCompare(right.name));
  return {
    roots: projectRoots(config).map((item) => ({
      id: item.id,
      label: item.label,
      path: item.path
    })),
    root: {
      id: root.id,
      label: root.label,
      path: root.path
    },
    relativePath: normalizedRelativePath,
    entries: entries.slice(0, maxEntries),
    truncated: entries.length > maxEntries
  };
}
