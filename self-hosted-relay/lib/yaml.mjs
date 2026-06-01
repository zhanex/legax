// Shared minimal YAML parser used by every Legax entry script.
//
// This is intentionally NOT a full YAML implementation. It supports the subset
// the project's example configs use:
//
//   - Top-level scalars: `key: value`
//   - Indentation-based nested objects used by the example configs
//   - Lists introduced by `- `, including lists of scalars and objects
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
  const lines = source.replace(/\r\n/g, "\n").split("\n")
    .map((rawLine) => {
      const withoutComment = stripYamlComment(rawLine);
      if (!withoutComment.trim()) return null;
      return {
        indent: withoutComment.match(/^\s*/)[0].length,
        content: withoutComment.trim()
      };
    })
    .filter(Boolean);
  const stack = [{ indent: -1, value: root }];

  for (let index = 0; index < lines.length; index += 1) {
    const { indent, content } = lines[index];
    while (stack.length > 1 && stack.at(-1).indent >= indent) stack.pop();
    const parent = stack.at(-1).value;

    if (content.startsWith("- ")) {
      if (!Array.isArray(parent)) continue;
      const remainder = content.slice(2).trim();
      if (!remainder) {
        parent.push(null);
        continue;
      }
      const entry = parseYamlKeyValue(remainder);
      if (entry) {
        const item = {};
        parent.push(item);
        assignYamlEntryWithLookahead(item, entry, lines, index, indent);
        stack.push({ indent, value: item });
      } else {
        parent.push(parseYamlScalar(remainder));
      }
      continue;
    }

    if (!parent || typeof parent !== "object" || Array.isArray(parent)) continue;
    const entry = parseYamlKeyValue(content);
    if (!entry) continue;
    const assigned = assignYamlEntryWithLookahead(parent, entry, lines, index, indent);
    if (assigned && typeof assigned === "object") {
      stack.push({ indent, value: assigned });
    }
  }
  return root;
}

function assignYamlEntryWithLookahead(target, entry, lines, index, indent) {
  if (entry.value !== "") {
    target[entry.key] = parseYamlScalar(entry.value);
    return null;
  }
  const next = nextNestedLine(lines, index, indent);
  const value = next?.content.startsWith("- ") ? [] : {};
  target[entry.key] = value;
  return value;
}

function nextNestedLine(lines, index, indent) {
  for (let scan = index + 1; scan < lines.length; scan += 1) {
    if (lines[scan].indent <= indent) return null;
    return lines[scan];
  }
  return null;
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
  let index = -1;
  for (let scan = 0; scan < content.length; scan += 1) {
    if (content[scan] !== ":") continue;
    const next = content[scan + 1] ?? "";
    if (next === "" || /\s/.test(next)) {
      index = scan;
      break;
    }
  }
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
