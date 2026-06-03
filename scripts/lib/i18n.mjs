export const SUPPORTED_LOCALES = ["en", "zh-CN"];

export const DICTIONARIES = {
  en: {
    "app.title": "Legax Relay",
    "common.back": "Back",
    "common.cancel": "Cancel",
    "common.close": "Close",
    "common.deny": "Deny",
    "common.done": "Done",
    "common.loading": "Loading...",
    "common.logout": "Logout",
    "common.offline": "Offline",
    "common.online": "Online",
    "common.open": "Open",
    "common.refresh": "Refresh",
    "common.retry": "Retry",
    "common.send": "Send",
    "common.sending": "Sending...",
    "language.english": "English",
    "language.label": "Language",
    "language.zh": "简体中文",
    "machine.none": "No daemon connected",
    "machine.offline": "Machine is offline",
    "machine.picker": "Machines",
    "machine.refresh": "Refresh machines",
    "machine.selected": "Current machine",
    "machine.unselected": "Choose machine",
    "pair.button": "Pair browser",
    "pair.code": "Pairing code",
    "pair.error": "Pairing failed. Check the code and try again.",
    "pair.help": "Run npm run daemon:pair on the desktop, then enter the one-time pairing code shown there.",
    "pair.status": "Pairing...",
    "pair.title": "Pair this browser",
    "relay.actionFailed": "Action failed",
    "relay.actionSent": "Action sent",
    "relay.approval": "Approval",
    "relay.approved": "Approved",
    "relay.authRequired": "Auth required",
    "relay.chooseCliFirst": "Choose CLI first",
    "relay.chooseMachineFirst": "Choose machine first",
    "relay.chooseTarget": "Choose target",
    "relay.connected": "Connected",
    "relay.connecting": "Connecting",
    "relay.currentConversation": "Current conversation",
    "relay.denied": "Denied",
    "relay.input": "Input",
    "relay.loadSessions": "Load sessions",
    "relay.message": "Message",
    "relay.newSession": "New session",
    "relay.noProject": "No project context yet",
    "relay.noSession": "No session context yet",
    "relay.noTarget": "No target",
    "relay.offlineHelp": "Start the local daemon, then confirm the relay settings in config.yaml point to this relay.",
    "relay.pending": "{count} pending",
    "relay.project": "Project",
    "relay.refreshCli": "Refresh CLI list",
    "relay.refreshSessions": "Refresh sessions",
    "relay.replyPlaceholder": "Reply to agent",
    "relay.session": "Session",
    "relay.sent": "Sent",
    "relay.showFull": "Show full message",
    "relay.status": "Status",
    "relay.updated": "Updated",
    "relay.waiting": "Waiting for events",
    "twa.empty": "No child folders",
    "twa.loading": "Loading folders...",
    "twa.open": "Open this folder",
    "twa.opened": "Project opened. You can return to Telegram.",
    "twa.opening": "Opening project...",
    "twa.timeout": "Daemon did not respond in time.",
    "twa.title": "Open project",
    "twa.unavailable": "Project picker unavailable"
  },
  "zh-CN": {
    "app.title": "Legax Relay",
    "common.back": "返回",
    "common.cancel": "取消",
    "common.close": "关闭",
    "common.deny": "拒绝",
    "common.done": "完成",
    "common.loading": "加载中...",
    "common.logout": "退出",
    "common.offline": "离线",
    "common.online": "在线",
    "common.open": "打开",
    "common.refresh": "刷新",
    "common.retry": "重试",
    "common.send": "发送",
    "common.sending": "发送中...",
    "language.english": "English",
    "language.label": "语言",
    "language.zh": "简体中文",
    "machine.none": "暂无 daemon 连接",
    "machine.offline": "机器离线",
    "machine.picker": "机器",
    "machine.refresh": "刷新机器",
    "machine.selected": "当前机器",
    "machine.unselected": "选择机器",
    "pair.button": "配对浏览器",
    "pair.code": "配对码",
    "pair.error": "配对失败。请检查配对码后重试。",
    "pair.help": "在桌面端运行 npm run daemon:pair，然后输入显示的一次性配对码。",
    "pair.status": "正在配对...",
    "pair.title": "配对此浏览器",
    "relay.actionFailed": "操作失败",
    "relay.actionSent": "操作已发送",
    "relay.approval": "审批",
    "relay.approved": "已批准",
    "relay.authRequired": "需要配对",
    "relay.chooseCliFirst": "请先选择 CLI",
    "relay.chooseMachineFirst": "请先选择机器",
    "relay.chooseTarget": "选择目标",
    "relay.connected": "已连接",
    "relay.connecting": "连接中",
    "relay.currentConversation": "当前对话",
    "relay.denied": "已拒绝",
    "relay.input": "输入",
    "relay.loadSessions": "加载 sessions",
    "relay.message": "消息",
    "relay.newSession": "新 session",
    "relay.noProject": "暂无项目上下文",
    "relay.noSession": "暂无 session 上下文",
    "relay.noTarget": "无目标",
    "relay.offlineHelp": "请启动本地 daemon，并确认 config.yaml 中的 relay 设置指向当前 relay。",
    "relay.pending": "{count} 项待处理",
    "relay.project": "项目",
    "relay.refreshCli": "刷新 CLI 列表",
    "relay.refreshSessions": "刷新 sessions",
    "relay.replyPlaceholder": "回复 Agent",
    "relay.session": "Session",
    "relay.sent": "已发送",
    "relay.showFull": "显示完整消息",
    "relay.status": "状态",
    "relay.updated": "已更新",
    "relay.waiting": "等待事件",
    "twa.empty": "没有子文件夹",
    "twa.loading": "正在加载文件夹...",
    "twa.open": "打开此文件夹",
    "twa.opened": "项目已打开。可以返回 Telegram。",
    "twa.opening": "正在打开项目...",
    "twa.timeout": "daemon 未及时响应。",
    "twa.title": "打开项目",
    "twa.unavailable": "项目选择器不可用"
  }
};

export function normalizeLocale(value, fallback = "en") {
  const text = String(value ?? "").trim();
  if (!text || text.toLowerCase() === "auto") return fallback;
  const lower = text.toLowerCase().replace("_", "-");
  if (lower === "zh" || lower.startsWith("zh-cn") || lower.startsWith("zh-hans")) return "zh-CN";
  if (lower.startsWith("en")) return "en";
  return fallback;
}

function localeFromLanguages(languages) {
  for (const value of languages ?? []) {
    const normalized = normalizeLocale(value, "");
    if (normalized) return normalized;
  }
  return "en";
}

export function resolveLocale(config = {}, options = {}) {
  const stored = normalizeLocale(options.storedLocale, "");
  if (stored) return stored;
  const transportLocale = normalizeLocale(options.transport?.locale, "");
  if (transportLocale) return transportLocale;
  const configured = String(config?.relay?.locale ?? config?.locale ?? "auto").trim();
  if (configured && configured.toLowerCase() !== "auto") return normalizeLocale(configured, "en");
  return localeFromLanguages(options.browserLanguages);
}

export function interpolate(template, values = {}) {
  return String(template ?? "").replace(/\{([A-Za-z0-9_.-]+)\}/g, (match, key) => (
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match
  ));
}

export function createTranslator(locale = "en", dictionaries = DICTIONARIES) {
  const normalized = normalizeLocale(locale, "en");
  return (key, values = {}) => {
    const template = dictionaries[normalized]?.[key] ?? dictionaries.en?.[key] ?? key;
    return interpolate(template, values);
  };
}

export function browserDictionaryPayload() {
  return {
    supportedLocales: SUPPORTED_LOCALES,
    dictionaries: DICTIONARIES
  };
}
