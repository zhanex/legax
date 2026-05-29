import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const rootPackage = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const currentPackageVersion = rootPackage.version;

const excludedDirs = new Set([
  ".agents",
  ".codex",
  ".git",
  "data",
  "node_modules",
]);

const mojibakePattern = /[\uFFFD]|锛|涓|鐨|杩|绠|銆|乣|丆|丄|鈥|€|ä¸|å|æ/g;
const cjkPattern = /[\u3400-\u9FFF]/u;

const secretPatterns = [
  { name: "Telegram bot token", pattern: /\b\d{8,}:[A-Za-z0-9_-]{30,}\b/ },
  { name: "OpenAI-style API key", pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { name: "GitHub token", pattern: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/ },
];

const errors = [];

function isChangelog(relPath) {
  return relPath === "CHANGELOG.md" || relPath === "CHANGELOG.zh-CN.md";
}

function relative(filePath) {
  return path.relative(root, filePath).replaceAll(path.sep, "/");
}

function exists(relPath) {
  return fs.existsSync(path.join(root, relPath));
}

function stripMarkdownCode(text) {
  return text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`\n]*`/g, "");
}

function isExternalReference(target) {
  return /^[a-z][a-z0-9+.-]*:/i.test(target)
    || target.startsWith("#")
    || target.startsWith("/")
    || target.startsWith("//");
}

function localReferencePath(target) {
  const clean = String(target ?? "").trim().replace(/^<|>$/g, "");
  if (!clean || isExternalReference(clean)) return "";
  const withoutFragment = clean.split("#")[0].split("?")[0];
  return withoutFragment.trim();
}

function collectLocalReferences(text) {
  const body = stripMarkdownCode(text);
  const references = [];

  for (const match of body.matchAll(/!?\[[^\]\n]*\]\(([^)\s]+)(?:\s+["'][^)]*["'])?\)/g)) {
    const target = localReferencePath(match[1]);
    if (target) references.push(target);
  }

  for (const match of body.matchAll(/<(?:a|img)\b[^>]*\b(?:href|src)=["']([^"']+)["'][^>]*>/gi)) {
    const target = localReferencePath(match[1]);
    if (target) references.push(target);
  }

  return references;
}

function shouldCheckLocalReferences(relPath) {
  return relPath.endsWith(".md") && !/^packages\/[^/]+\/README(?:\.zh-CN)?\.md$/.test(relPath);
}

function localReferenceExists(fromRelPath, target) {
  const fromDir = path.dirname(path.join(root, fromRelPath));
  const resolved = path.resolve(fromDir, target);
  const relativeTarget = path.relative(root, resolved);
  if (relativeTarget.startsWith("..") || path.isAbsolute(relativeTarget)) return false;
  return fs.existsSync(resolved);
}

function walk(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (excludedDirs.has(entry.name)) {
        continue;
      }
      results.push(...walk(path.join(dir, entry.name)));
      continue;
    }

    if (entry.isFile()) {
      results.push(path.join(dir, entry.name));
    }
  }
  return results;
}

function readUtf8(filePath) {
  const bytes = fs.readFileSync(filePath);
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    errors.push(`${relative(filePath)} starts with a UTF-8 BOM`);
  }
  return bytes.toString("utf8");
}

const allFiles = walk(root);
const markdownFiles = allFiles.filter((filePath) => filePath.endsWith(".md"));
const configExampleFiles = allFiles.filter((filePath) => {
  const name = path.basename(filePath);
  return /^config\.example(?:\..+)?\.ya?ml$/.test(name);
});

const scannedFiles = [...markdownFiles, ...configExampleFiles];

for (const filePath of scannedFiles) {
  const relPath = relative(filePath);
  const text = readUtf8(filePath);

  mojibakePattern.lastIndex = 0;
  if (mojibakePattern.test(text)) {
    errors.push(`${relPath} contains mojibake or replacement characters`);
  }

  for (const { name, pattern } of secretPatterns) {
    if (pattern.test(text)) {
      errors.push(`${relPath} appears to contain a real ${name}`);
    }
  }

  if (currentPackageVersion && relPath.endsWith(".md") && !isChangelog(relPath) && text.includes(currentPackageVersion)) {
    errors.push(`${relPath} must not hard-code current package version ${currentPackageVersion}; read it from package metadata or use a placeholder`);
  }

  const isChineseFile = relPath.includes(".zh-CN.");
  const isEnglishDoc = relPath.endsWith(".md") && !isChineseFile;
  const isEnglishConfigExample = configExampleFiles.includes(filePath) && !isChineseFile;
  if ((isEnglishDoc || isEnglishConfigExample) && cjkPattern.test(text)) {
    errors.push(`${relPath} is an English file but contains CJK prose`);
  }

  if (shouldCheckLocalReferences(relPath)) {
    for (const target of collectLocalReferences(text)) {
      if (!localReferenceExists(relPath, target)) {
        errors.push(`${relPath} has a broken local reference to ${target}`);
      }
    }
  }
}

for (const filePath of markdownFiles) {
  const relPath = relative(filePath);
  if (relPath.endsWith(".zh-CN.md")) {
    const englishRel = relPath.replace(/\.zh-CN\.md$/, ".md");
    if (!exists(englishRel)) {
      errors.push(`${relPath} is missing English pair ${englishRel}`);
    }
    continue;
  }

  const parsed = path.parse(relPath);
  const chineseRel = path.join(parsed.dir, `${parsed.name}.zh-CN${parsed.ext}`).replaceAll(path.sep, "/");
  if (!exists(chineseRel)) {
    errors.push(`${relPath} is missing Simplified Chinese pair ${chineseRel}`);
  }
}

for (const filePath of configExampleFiles) {
  const relPath = relative(filePath);
  if (relPath.includes(".zh-CN.")) {
    const englishRel = relPath.replace(/\.zh-CN(?=\.ya?ml$)/, "");
    if (!exists(englishRel)) {
      errors.push(`${relPath} is missing English pair ${englishRel}`);
    }
    continue;
  }

  const parsed = path.parse(relPath);
  const chineseRel = path.join(parsed.dir, `${parsed.name}.zh-CN${parsed.ext}`).replaceAll(path.sep, "/");
  if (!exists(chineseRel)) {
    errors.push(`${relPath} is missing Simplified Chinese pair ${chineseRel}`);
  }
}

if (errors.length > 0) {
  console.error("Documentation checks failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(`Documentation checks passed (${scannedFiles.length} files).`);
