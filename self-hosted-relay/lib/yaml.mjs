// Shared minimal YAML parser used by every Legax entry script.
//
// This is intentionally NOT a full YAML implementation. It supports the subset
// the project's example configs use:
//
//   - Top-level scalars: `key: value`
//   - Two-level nested objects: `parent:` followed by indented `key: value`
//   - The `transports:` list: items introduced by `- ` with indented sub-keys
//   - Per-key list values: `key:` followed by indented `- value` lines
//   - Inline comments stripped on `#` outside quoted strings
//   - Scalars: true / false / null / numbers / single-quoted / double-quoted /
//     unquoted strings. Double-quoted strings process common escape sequences
//     (\n, \r, \t, \\, \", \/). Single-quoted strings are literal except that
//     `''` represents a single quote.
//
// We deliberately do not support anchors (&, *), tags (!!), multi-line scalars
// (|, >), flow style ({}, []), or any of YAML's deeper corners. Configurations
// that need those should switch to a real parser; do not extend this module.

import fs from "node:fs";

const NUMBER_PATTERN = /^-?\d+(?:\.\d+)?$/;

export function readYaml(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return parseSimpleYaml(fs.readFileSync(filePath, "utf8"));
}

export function parseSimpleYaml(text) {
  const source = String(text).replace(/^\uFEFF/, "");
  const root = {};
  let currentTop = null;
  let currentTransport = null;
  let currentListKey = null;

  for (const rawLine of source.replace(/\r\n/g, "\n").split("\n")) {
    const withoutComment = stripYamlComment(rawLine);
    if (!withoutComment.trim()) continue;
    const indent = withoutComment.match(/^\s*/)[0].length;
    const content = withoutComment.trim();

    if (indent === 0) {
      const entry = parseYamlKeyValue(content);
      if (!entry) continue;
      currentTop = entry.key;
      currentTransport = null;
      currentListKey = null;
      if (entry.value === "") root[entry.key] = entry.key === "transports" ? [] : {};
      else {
        root[entry.key] = parseYamlScalar(entry.value);
        currentTop = null;
      }
      continue;
    }

    if (currentTop === "transports") {
      if (content.startsWith("- ")) {
        currentTransport = {};
        root.transports.push(currentTransport);
        currentListKey = null;
        const remainder = content.slice(2).trim();
        if (remainder) assignYamlEntry(currentTransport, remainder);
        continue;
      }
      if (currentTransport) {
        const entry = parseYamlKeyValue(content);
        if (entry) {
          if (entry.value === "") {
            currentTransport[entry.key] = [];
            currentListKey = entry.key;
          } else {
            currentTransport[entry.key] = parseYamlScalar(entry.value);
            currentListKey = null;
          }
          continue;
        }
        if (currentListKey && content.startsWith("- ")) {
          currentTransport[currentListKey].push(parseYamlScalar(content.slice(2).trim()));
        }
      }
      continue;
    }

    if (currentTop && root[currentTop] && typeof root[currentTop] === "object") {
      if (currentListKey && content.startsWith("- ")) {
        root[currentTop][currentListKey].push(parseYamlScalar(content.slice(2).trim()));
        continue;
      }
      const entry = parseYamlKeyValue(content);
      if (!entry) continue;
      if (entry.value === "") {
        root[currentTop][entry.key] = [];
        currentListKey = entry.key;
      } else {
        root[currentTop][entry.key] = parseYamlScalar(entry.value);
        currentListKey = null;
      }
    }
  }
  return root;
}

export function stripYamlComment(line) {
  let single = false;
  let double = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === "'" && !double) {
      single = !single;
      continue;
    }
    if (char === '"' && !single) {
      // Count trailing backslashes; only an even count (i.e., not a real escape)
      // means we are at a string boundary.
      let backslashes = 0;
      for (let scan = index - 1; scan >= 0 && line[scan] === "\\"; scan -= 1) backslashes += 1;
      if (backslashes % 2 === 0) double = !double;
      continue;
    }
    if (char === "#" && !single && !double) return line.slice(0, index);
  }
  return line;
}

export function parseYamlKeyValue(content) {
  const index = content.indexOf(":");
  if (index < 0) return null;
  return { key: content.slice(0, index).trim(), value: content.slice(index + 1).trim() };
}

export function assignYamlEntry(target, content) {
  const entry = parseYamlKeyValue(content);
  if (!entry) return;
  target[entry.key] = entry.value === "" ? {} : parseYamlScalar(entry.value);
}

export function parseYamlScalar(value) {
  const trimmed = value.trim();
  if (trimmed === "") return "";
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;
  if (NUMBER_PATTERN.test(trimmed)) return Number(trimmed);
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return decodeDoubleQuoted(trimmed.slice(1, -1));
  }
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  return trimmed;
}

function decodeDoubleQuoted(body) {
  let output = "";
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (char !== "\\" || index + 1 >= body.length) {
      output += char;
      continue;
    }
    const next = body[index + 1];
    index += 1;
    switch (next) {
      case "n": output += "\n"; break;
      case "r": output += "\r"; break;
      case "t": output += "\t"; break;
      case "\\": output += "\\"; break;
      case '"': output += '"'; break;
      case "/": output += "/"; break;
      case "0": output += "\0"; break;
      default:
        // Unknown escape: keep both characters so the user sees the typo
        // instead of silently dropping data.
        output += "\\" + next;
        break;
    }
  }
  return output;
}
