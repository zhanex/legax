#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pluginRoot = path.resolve(__dirname, "..");

function resolveFromRoot(value) {
  if (!value) return value;
  return path.isAbsolute(value) ? value : path.resolve(pluginRoot, value);
}

function unquote(value) {
  const trimmed = String(value ?? "").trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function findTelegramBlock(lines) {
  const start = lines.findIndex((line) => /^\s*-\s+name:\s*telegram\s*$/.test(line));
  if (start < 0) throw new Error("No telegram transport found in config.yaml.");
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^\s*-\s+name:\s+\S+/.test(lines[index])) {
      end = index;
      break;
    }
  }
  return { start, end };
}

function fieldValue(lines, block, field) {
  const line = lines.slice(block.start, block.end).find((candidate) => candidate.trim().startsWith(`${field}:`));
  if (!line) return "";
  return unquote(line.split(":").slice(1).join(":"));
}

function setField(lines, block, field, value) {
  const relative = lines.slice(block.start, block.end).findIndex((line) => line.trim().startsWith(`${field}:`));
  const nextLine = `    ${field}: ${value}`;
  if (relative >= 0) {
    lines[block.start + relative] = nextLine;
    return;
  }
  const botTokenRelative = lines.slice(block.start, block.end).findIndex((line) => line.trim().startsWith("botToken:"));
  lines.splice(block.start + (botTokenRelative >= 0 ? botTokenRelative + 1 : 1), 0, nextLine);
}

function chatFromUpdate(update) {
  return update.message?.chat
    ?? update.edited_message?.chat
    ?? update.channel_post?.chat
    ?? update.my_chat_member?.chat
    ?? update.chat_member?.chat;
}

function telegramApiUrl(block, lines, token, method) {
  const baseUrl = String(fieldValue(lines, block, "apiBaseUrl") || "https://api.telegram.org/bot").replace(/\/+$/, "");
  return `${baseUrl}${token}/${method}`;
}

async function main() {
  const configPath = resolveFromRoot(process.env.LEGAX_CONFIG ?? "./config.yaml");
  const text = fs.readFileSync(configPath, "utf8");
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const block = findTelegramBlock(lines);
  const token = fieldValue(lines, block, "botToken");
  if (!token) throw new Error("telegram.botToken is empty. Put your bot token in config.yaml first.");

  const response = await fetch(telegramApiUrl(block, lines, token, "getUpdates"));
  const body = await response.json();
  if (!response.ok || body.ok !== true) {
    throw new Error(`Telegram getUpdates failed: ${JSON.stringify(body)}`);
  }

  const candidates = (body.result ?? [])
    .map((update) => ({ updateId: update.update_id, chat: chatFromUpdate(update), text: update.message?.text }))
    .filter((item) => item.chat?.id !== undefined);
  if (candidates.length === 0) {
    const meResponse = await fetch(telegramApiUrl(block, lines, token, "getMe"));
    const me = await meResponse.json();
    const username = me.result?.username ? `@${me.result.username}` : "this bot";
    throw new Error(`No Telegram chat found. Open ${username}, send /start or any message, then rerun this script.`);
  }

  const latest = candidates.at(-1);
  setField(lines, block, "chatId", String(latest.chat.id));
  fs.writeFileSync(configPath, `${lines.join("\n").replace(/\n*$/, "")}\n`, "utf8");

  process.stdout.write(`${JSON.stringify({
    ok: true,
    configPath,
    chat: {
      id: latest.chat.id,
      type: latest.chat.type,
      username: latest.chat.username,
      firstName: latest.chat.first_name,
      lastName: latest.chat.last_name,
      title: latest.chat.title
    },
    updateId: latest.updateId,
    messageText: latest.text
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`[legax] ${error.message}\n`);
  process.exitCode = 1;
});
