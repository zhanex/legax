function trimOneLine(value, limit = 80) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 1))}...`;
}

function valueAtPath(object, key) {
  let current = object;
  for (const part of String(key).split(".")) {
    if (!current || typeof current !== "object") return undefined;
    current = current[part];
  }
  return current;
}

function firstString(object, keys) {
  for (const key of keys) {
    const value = valueAtPath(object, key);
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function sourceValue(item, options) {
  return firstString(item, options.chatSourceKeys ?? ["source", "sourceKind", "metadata.source", "metadata.sourceKind"]);
}

function matchesSourceValue(item, keys, values) {
  if (!Array.isArray(keys) || keys.length === 0) return false;
  if (values.size === 0) return false;
  const source = firstString(item, keys).toLowerCase();
  return source ? values.has(source) : false;
}

function matchesChatSource(item, options) {
  const values = new Set((options.chatSourceValues ?? []).map((value) => String(value).toLowerCase()));
  return matchesSourceValue(item, options.chatSourceKeys ?? ["source", "sourceKind", "metadata.source", "metadata.sourceKind"], values);
}

function explicitPathKeys(options) {
  const keys = options.explicitPathKeys ?? options.pathKeys ?? [
    "projectPath",
    "workspacePath",
    "cwd",
    "metadata.projectPath",
    "metadata.workspacePath",
    "metadata.cwd",
    "project",
    "metadata.project"
  ];
  return keys.filter((key) => !String(key).split(".").pop().toLowerCase().includes("cwd"));
}

function cwdKeys(options) {
  return options.cwdKeys ?? ["cwd", "metadata.cwd"];
}

function hasOnlyCwdProjectMetadata(item, options) {
  const key = firstString(item, options.keyKeys ?? ["projectId", "metadata.projectId"]);
  const label = firstString(item, options.labelKeys ?? ["projectName", "workspaceName", "metadata.projectName"]);
  const explicitRaw = firstString(item, explicitPathKeys(options));
  const cwd = firstString(item, cwdKeys(options));
  return Boolean(!key && !label && !explicitRaw && cwd);
}

function cwdOnlyIncludedInChat(item, options) {
  if (!hasOnlyCwdProjectMetadata(item, options)) return false;
  if (options.chatIncludesCwdOnly === true) return true;
  const source = sourceValue(item, options);
  const values = new Set((options.chatCwdSourceValues ?? []).map((value) => String(value).toLowerCase()));
  if (source && values.size > 0) return values.has(source.toLowerCase());
  return !source && options.chatIncludesUnknownCwdOnly === true;
}

function basename(value) {
  const text = String(value ?? "").replace(/[\\/]+$/g, "");
  const parts = text.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? text;
}

function projectInfo(item, options = {}) {
  const chatKey = options.chatKey ?? "chats";
  const chatLabel = options.chatLabel ?? "Chats";
  const key = firstString(item, options.keyKeys ?? ["projectId", "metadata.projectId"]);
  const raw = firstString(item, options.pathKeys ?? [
    "projectPath",
    "workspacePath",
    "cwd",
    "metadata.projectPath",
    "metadata.workspacePath",
    "metadata.cwd",
    "project",
    "metadata.project"
  ]);
  const label = firstString(item, options.labelKeys ?? ["projectName", "workspaceName", "metadata.projectName"]);
  const sourceIsChat = matchesChatSource(item, options);
  const hasProject = Boolean(key || label || (!sourceIsChat && raw));
  const groupKey = hasProject ? (key || raw || label) : chatKey;
  const groupLabel = hasProject ? (label || (raw ? basename(raw) : chatLabel)) : chatLabel;
  return {
    key: groupKey,
    label: trimOneLine(groupLabel, options.labelLimit ?? 38),
    detail: hasProject && raw && raw !== groupLabel ? raw : "",
    isChat: !hasProject
  };
}

export function isArchivedItem(item) {
  if (!item || typeof item !== "object") return false;
  const status = String(item.status ?? item.state ?? item.metadata?.status ?? item.metadata?.state ?? "").toLowerCase();
  return item.archived === true
    || item.isArchived === true
    || item.metadata?.archived === true
    || item.metadata?.isArchived === true
    || Boolean(item.archivedAt ?? item.archiveTime ?? item.metadata?.archivedAt ?? item.metadata?.archiveTime)
    || status === "archived";
}

export function filterActiveItems(items) {
  return (items ?? []).filter((item) => !isArchivedItem(item));
}

export function itemBelongsToChat(item, options = {}) {
  return projectInfo(item, options).isChat || cwdOnlyIncludedInChat(item, options);
}

export function buildProjectChoices(items, options = {}) {
  const groups = new Map();
  const chatKey = options.chatKey ?? "chats";
  const chatLabel = options.chatLabel ?? "Chats";
  const ensureChatGroup = () => {
    let group = groups.get(chatKey);
    if (!group) {
      group = {
        id: chatKey,
        key: chatKey,
        label: chatLabel,
        detail: "",
        count: 0,
        isChat: true
      };
      groups.set(chatKey, group);
    }
    return group;
  };
  for (const item of filterActiveItems(items)) {
    const info = projectInfo(item, options);
    let group = groups.get(info.key);
    if (!group) {
      group = {
        id: info.isChat ? chatKey : String(groups.size + 1),
        key: info.key,
        label: info.label,
        detail: info.detail,
        count: 0,
        isChat: info.isChat
      };
      groups.set(info.key, group);
    }
    group.count += 1;
    if (!info.isChat && itemBelongsToChat(item, options)) {
      ensureChatGroup().count += 1;
    }
  }
  ensureChatGroup();
  const values = [...groups.values()];
  return [
    ...values.filter((project) => project.isChat),
    ...values.filter((project) => !project.isChat)
  ];
}

export function resolveProjectChoice(projectRef, projects) {
  const value = String(projectRef ?? "").trim();
  if (!value) return null;
  return projects.find((project) => (
    project.id === value
      || project.key === value
      || project.label === value
      || encodeURIComponent(project.key) === value
  )) ?? null;
}

export function filterItemsByProject(items, project, options = {}) {
  const activeItems = filterActiveItems(items);
  if (!project) return activeItems;
  if (project.isChat) return activeItems.filter((item) => itemBelongsToChat(item, options));
  return activeItems.filter((item) => projectInfo(item, options).key === project.key);
}

export function normalizePage(value) {
  const page = Number(value);
  if (!Number.isFinite(page) || page < 1) return 1;
  return Math.floor(page);
}

export function paginateItems(items, { page = 1, pageSize = 10 } = {}) {
  const safePageSize = Math.max(1, Math.floor(Number(pageSize) || 10));
  const totalCount = items.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / safePageSize));
  const currentPage = Math.min(normalizePage(page), totalPages);
  const start = (currentPage - 1) * safePageSize;
  return {
    items: items.slice(start, start + safePageSize),
    page: currentPage,
    pageSize: safePageSize,
    totalCount,
    totalPages,
    hasPrevious: currentPage > 1,
    hasNext: currentPage < totalPages
  };
}

export function formatPageLine(pagination) {
  if (!pagination || pagination.totalPages <= 1) return "";
  return `Page ${pagination.page}/${pagination.totalPages} (${pagination.totalCount} total)`;
}

export function buttonRows(buttons, size = 2) {
  const rows = [];
  const width = Math.max(1, Math.floor(Number(size) || 2));
  for (let index = 0; index < buttons.length; index += width) {
    rows.push(buttons.slice(index, index + width));
  }
  return rows;
}

export function hierarchyRows(agentId, { level = "session", projectRef, sessionRef } = {}) {
  const encodedAgent = agentId ? encodeURIComponent(agentId) : "";
  const normalizedLevel = String(level ?? "session").toLowerCase();
  const row = [{ text: "CLI", callback_data: "legax:agents" }];
  if (normalizedLevel === "project" || normalizedLevel === "session") {
    row.push({
      text: "Prj",
      callback_data: encodedAgent ? `legax:projects:${encodedAgent}` : "legax:agents"
    });
  }
  if (normalizedLevel === "session") {
    row.push({
      text: "Session",
      callback_data: encodedAgent
        ? projectRef
          ? `legax:project:${encodedAgent}:${encodeURIComponent(projectRef)}`
          : sessionRef
            ? `legax:session:${encodedAgent}:${encodeURIComponent(sessionRef)}`
            : `legax:sessions:${encodedAgent}`
        : "legax:agents"
    });
  }
  return [row];
}

export function formatProjectList(label, projects, pagination) {
  if (!projects.length) return `No ${label} projects or chats were found.`;
  return [
    `Choose a ${label} project/chat:`,
    formatPageLine(pagination),
    ...projects.map((project, index) => {
      const detail = project.detail ? `\n   ${project.detail}` : "";
      return `${index + 1}. ${project.label} (${project.count})${detail}`;
    })
  ].filter(Boolean).join("\n");
}

export function projectsReplyMarkup(agentId, projects, { page = 1, pageSize = 10 } = {}) {
  const encodedAgent = encodeURIComponent(agentId);
  const pagination = paginateItems(projects, { page, pageSize });
  const rows = pagination.items.map((project, index) => [{
    text: `${index + 1}. ${trimOneLine(project.label, 28)} (${project.count})`,
    callback_data: `legax:project:${encodedAgent}:${encodeURIComponent(project.id)}`
  }]);
  if (pagination.hasPrevious || pagination.hasNext) {
    const nav = [];
    if (pagination.hasPrevious) nav.push({ text: "Previous", callback_data: `legax:projects:${encodedAgent}:${pagination.page - 1}` });
    if (pagination.hasNext) nav.push({ text: "Next", callback_data: `legax:projects:${encodedAgent}:${pagination.page + 1}` });
    rows.push(nav);
  }
  rows.push([{ text: "New project", callback_data: `legax:new-project:${encodedAgent}` }]);
  rows.push(...hierarchyRows(agentId, { level: "project" }));
  return { inline_keyboard: rows };
}
