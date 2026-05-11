import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const pluginRoot = path.resolve(__dirname, "..", "..");

const WORKTREE_NAME_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

function runGit(args, { cwd = pluginRoot, allowFailure = false } = {}) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    windowsHide: true
  });
  if (!allowFailure && result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `git ${args.join(" ")} failed`).trim());
  }
  return result;
}

export function worktreeRoot(cwd = pluginRoot) {
  return path.resolve(cwd, "data", "worktrees");
}

export function validateWorktreeName(name) {
  const value = String(name ?? "").trim();
  if (!WORKTREE_NAME_PATTERN.test(value)) {
    throw new Error("worktree name must be 1-64 characters of letters, numbers, dot, underscore, or dash");
  }
  return value;
}

export function listWorktrees({ cwd = pluginRoot } = {}) {
  const result = runGit(["worktree", "list", "--porcelain"], { cwd });
  const entries = [];
  let current = null;
  for (const line of result.stdout.split(/\r?\n/)) {
    if (!line.trim()) {
      if (current) entries.push(finalizeWorktree(current, cwd));
      current = null;
      continue;
    }
    const [key, ...rest] = line.split(" ");
    const value = rest.join(" ");
    if (key === "worktree") current = { path: value };
    else if (current) current[key] = value || true;
  }
  if (current) entries.push(finalizeWorktree(current, cwd));
  return entries;
}

function finalizeWorktree(entry, cwd) {
  const root = worktreeRoot(cwd);
  const resolvedPath = path.resolve(entry.path);
  const underManagedRoot = pathRelativeInside(root, resolvedPath);
  const branch = String(entry.branch ?? "").replace(/^refs\/heads\//, "");
  return {
    path: resolvedPath,
    name: underManagedRoot ? path.basename(resolvedPath) : path.basename(resolvedPath),
    managed: underManagedRoot,
    head: entry.HEAD ?? "",
    branch,
    detached: Boolean(entry.detached),
    bare: Boolean(entry.bare)
  };
}

function pathRelativeInside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function createWorktree({ cwd = pluginRoot, name, base = "HEAD" } = {}) {
  const safeName = validateWorktreeName(name);
  const root = worktreeRoot(cwd);
  const target = path.join(root, safeName);
  if (fs.existsSync(target)) throw new Error(`worktree already exists: ${target}`);
  fs.mkdirSync(root, { recursive: true });
  const branch = `legax/${safeName}`;
  runGit(["worktree", "add", "-b", branch, target, base], { cwd });
  return {
    ok: true,
    worktree: {
      name: safeName,
      path: target,
      branch,
      base
    }
  };
}

export function findWorktree({ cwd = pluginRoot, name, worktreePath } = {}) {
  const entries = listWorktrees({ cwd });
  if (worktreePath) {
    const wanted = path.resolve(worktreePath);
    return entries.find((entry) => path.resolve(entry.path) === wanted) ?? null;
  }
  const safeName = validateWorktreeName(name);
  return entries.find((entry) => entry.name === safeName) ?? null;
}

export function archiveWorktree({ cwd = pluginRoot, name, worktreePath, deleteBranch = false } = {}) {
  const entry = findWorktree({ cwd, name, worktreePath });
  if (!entry) throw new Error("worktree not found");
  if (!entry.managed) throw new Error("refusing to archive a worktree outside data/worktrees");
  runGit(["worktree", "remove", "--force", entry.path], { cwd });
  if (deleteBranch && entry.branch) {
    runGit(["branch", "-D", entry.branch], { cwd, allowFailure: true });
  }
  return { ok: true, archived: { name: entry.name, path: entry.path, branch: entry.branch } };
}

export function runWorktreeCheck({ cwd = pluginRoot, name, worktreePath, command = [] } = {}) {
  const entry = findWorktree({ cwd, name, worktreePath });
  if (!entry) throw new Error("worktree not found");
  if (!Array.isArray(command) || command.length === 0) {
    throw new Error("worktree check requires a command after --");
  }
  const result = spawnSync(command[0], command.slice(1), {
    cwd: entry.path,
    encoding: "utf8",
    windowsHide: true
  });
  return {
    ok: result.status === 0,
    worktree: entry,
    command,
    exitCode: result.status,
    stdout: result.stdout,
    stderr: result.stderr
  };
}
