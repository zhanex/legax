import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const errors = [];

const byteBudgets = new Map([
  ["AGENTS.md", 4096],
  ["AGENTS.zh-CN.md", 4096],
  ["docs/context_for_llms.md", 3072],
  ["docs/context_for_llms.zh-CN.md", 3072],
  ["docs/README.md", 6144],
  ["docs/README.zh-CN.md", 6144]
]);

const summaryDocs = [
  "docs/ARCHITECTURE.md",
  "docs/ARCHITECTURE.zh-CN.md",
  "docs/FUNCTIONAL_BOUNDARIES.md",
  "docs/FUNCTIONAL_BOUNDARIES.zh-CN.md",
  "docs/RELAY_API.md",
  "docs/RELAY_API.zh-CN.md",
  "docs/RELAY_STORE.md",
  "docs/RELAY_STORE.zh-CN.md",
  "docs/LEGAX_PROTOCOL.md",
  "docs/LEGAX_PROTOCOL.zh-CN.md",
  "docs/ENGINEERING_GUIDE.md",
  "docs/ENGINEERING_GUIDE.zh-CN.md",
  "docs/CONFIGURATION.md",
  "docs/CONFIGURATION.zh-CN.md",
  "docs/RUNTIME_STATE.md",
  "docs/RUNTIME_STATE.zh-CN.md",
  "docs/STATE_MACHINES.md",
  "docs/STATE_MACHINES.zh-CN.md"
];

function rel(filePath) {
  return path.relative(root, filePath).replaceAll(path.sep, "/");
}

function exists(relPath) {
  return fs.existsSync(path.join(root, relPath));
}

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), "utf8");
}

function trackedAndVisibleFiles() {
  const result = spawnSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], {
    cwd: root,
    encoding: "buffer"
  });
  if (result.status !== 0) return [];
  return result.stdout.toString("utf8").split("\0").filter(Boolean);
}

function summaryBody(text) {
  const match = text.match(/^## Agent Summary\s*\n([\s\S]*?)(?=\n## |\n# |$)/m);
  return match ? match[1].trim() : "";
}

for (const [relPath, maxBytes] of byteBudgets) {
  if (!exists(relPath)) {
    errors.push(`${relPath} is missing`);
    continue;
  }
  const bytes = fs.statSync(path.join(root, relPath)).size;
  if (bytes > maxBytes) {
    errors.push(`${relPath} is ${bytes} bytes, over the ${maxBytes} byte agent-context budget`);
  }
}

for (const relPath of summaryDocs) {
  if (!exists(relPath)) {
    errors.push(`${relPath} is missing`);
    continue;
  }
  const body = summaryBody(read(relPath));
  if (!body) {
    errors.push(`${relPath} is missing a ## Agent Summary section`);
    continue;
  }
  if (body.length > 900) {
    errors.push(`${relPath} Agent Summary is ${body.length} characters, over the 900 character budget`);
  }
}

if (exists("AGENTS.md")) {
  const agents = read("AGENTS.md");
  if (/Required Document Routing/i.test(agents)) {
    errors.push("AGENTS.md must not carry the full Required Document Routing table; use docs/context_for_llms.md");
  }
}

if (exists("docs/context_for_llms.md")) {
  const context = read("docs/context_for_llms.md");
  if (!/^## Read Budget/m.test(context)) {
    errors.push("docs/context_for_llms.md must include a ## Read Budget section");
  }
  const withoutLanguageSwitch = context
    .split("\n")
    .filter((line) => !/Simplified Chinese|English \|/.test(line))
    .join("\n");
  if (/\.zh-CN\.md\b/.test(withoutLanguageSwitch)) {
    errors.push("docs/context_for_llms.md must not route default agent work to .zh-CN.md files");
  }
}

const visibleDocs = trackedAndVisibleFiles()
  .filter((file) => /\.(md|ya?ml)$/i.test(file))
  .filter((file) => !file.includes("/superpowers/") && !file.startsWith("docs/superpowers/"));

const largest = visibleDocs
  .map((file) => {
    const filePath = path.join(root, file);
    return { file, bytes: fs.existsSync(filePath) ? fs.statSync(filePath).size : 0 };
  })
  .sort((left, right) => right.bytes - left.bytes)
  .slice(0, 10);

if (errors.length > 0) {
  console.error("Documentation context budget checks failed:");
  for (const error of errors) console.error(`- ${error}`);
  if (largest.length) {
    console.error("\nLargest visible docs:");
    for (const item of largest) console.error(`- ${item.file}: ${item.bytes} bytes`);
  }
  process.exit(1);
}

console.log(`Documentation context budget checks passed (${visibleDocs.length} visible docs/config files).`);
for (const item of largest.slice(0, 5)) {
  console.log(`- ${rel(path.join(root, item.file))}: ${item.bytes} bytes`);
}
