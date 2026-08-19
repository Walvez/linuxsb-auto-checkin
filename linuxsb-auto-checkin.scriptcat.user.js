// ==UserScript==
// @name         linux.sb 自动签到
// @namespace    https://github.com/Walvez/linuxsb-auto-checkin
// @version      1.0.1
// @description  在脚本猫后台为 linux.sb 执行每日签到；复用浏览器登录态，无需复制 Cookie，也无需保持网页打开。
// @author       Walvez
// @homepageURL  https://github.com/Walvez/linuxsb-auto-checkin
// @supportURL   https://github.com/Walvez/linuxsb-auto-checkin/issues
// @source       https://github.com/Walvez/linuxsb-auto-checkin
// @updateURL    https://raw.githubusercontent.com/Walvez/linuxsb-auto-checkin/main/linuxsb-auto-checkin.scriptcat.user.js
// @downloadURL  https://raw.githubusercontent.com/Walvez/linuxsb-auto-checkin/main/linuxsb-auto-checkin.scriptcat.user.js
// @icon         https://linux.sb/app/assets/index.svg
// @tag          linux.sb
// @tag          自动签到
// @tag          后台脚本
// @crontab      5-55/5 * once * *
// @grant        GM_xmlhttpRequest
// @grant        GM_notification
// @grant        GM_openInTab
// @grant        GM_log
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @connect      linux.sb
// @connect      www.linux.bi
// @license      MIT
// ==/UserScript==

const SITE = "https://linux.sb";
const CHECKIN_URL = SITE + "/daily_checkin";
const REQUEST_TIMEOUT = 20000;
const LOG_PREFIX = "[linux.sb]";
const RETRY_HINT =
  "定时会在下一个候选时刻自动再试；也可通过菜单“立即签到”手动重试。";

// 今日已签到时，记录到本地，避免同一天重复请求
const DONE_KEY = "lsb_last_sign_date";

const OUTCOME = {
  SUCCESS: "success",
  ALREADY_CHECKED: "already_checked",
  LOGIN_REQUIRED: "login_required",
  RETRYABLE_FAILURE: "retryable_failure",
  NON_RETRYABLE_FAILURE: "non_retryable_failure",
};

function log(message, level = "info") {
  GM_log(`${LOG_PREFIX} ${message}`, level);
}

function todayKey() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function openSignPage() {
  GM_openInTab(CHECKIN_URL, true);
}

function notify(title, text, options = {}) {
  const payload = { title, text: String(text || title) };
  if (typeof options.onclick === "function") payload.onclick = options.onclick;
  GM_notification(payload);
}

function httpRequest(options) {
  return new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      method: options.method || "GET",
      url: options.url,
      headers: options.headers || {},
      data: options.data,
      timeout: options.timeout || REQUEST_TIMEOUT,
      responseType: options.responseType || "text",
      onload(response) {
        resolve(response);
      },
      onerror() {
        reject(Object.assign(new Error("网络请求失败"), { kind: OUTCOME.RETRYABLE_FAILURE }));
      },
      ontimeout() {
        reject(Object.assign(new Error("网络请求超时"), { kind: OUTCOME.RETRYABLE_FAILURE }));
      },
      onabort() {
        reject(Object.assign(new Error("网络请求被终止"), { kind: OUTCOME.RETRYABLE_FAILURE }));
      },
    });
  });
}

// —— 解析 /daily_checkin 页面：状态 + _csrf（复刻自开源 linux-sb-pro 的 checkin-parse）
const STATUS_ZH = {
  "今天待签到": "not-signed-in",
  "今天已签到": "signed-in",
  "今日已签到": "signed-in",
  "已连续签到": "signed-in",
  "已签到": "signed-in",
  "未签到": "not-signed-in",
  "立即签到": "not-signed-in",
  "签到": "not-signed-in",
  "请先登录": "guest",
};

function detectStatus(text) {
  if (!text) return "unknown";
  for (const [zh, en] of Object.entries(STATUS_ZH)) {
    if (text.includes(zh)) return en;
  }
  return "unknown";
}

function findText(html, patterns) {
  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1]) return m[1];
  }
  return null;
}

function parseCheckinPage(html) {
  const result = { status: "unknown", csrf: null, hasForm: false };
  if (typeof html !== "string" || !html) return result;

  const statusText = findText(html, [
    /<[^>]*class\s*=\s*["'][^"']*\badmin-plugin-summary\b[^"']*["'][\s\S]*?<span[^>]*>([\s\S]*?)<\//i,
    /<[^>]*class\s*=\s*["'][^"']*\bdaily-checkin-sub\b[^"']*["'][^>]*>([\s\S]*?)<\//i,
    /<button\b[^>]*>([\s\S]*?)<\/button>/i,
  ]);
  result.status = detectStatus(statusText ? statusText.trim() : "");

  const csrfMatch = html.match(
    /<form\b[^>]*action\s*=\s*["']\/daily_checkin["'][^>]*>[\s\S]*?<input\b[^>]*name\s*=\s*["']_csrf["'][^>]*value\s*=\s*["']([^"']+)["']/i
  );
  if (csrfMatch) result.csrf = csrfMatch[1];
  result.hasForm = /<form\b[^>]*action\s*=\s*["']\/daily_checkin["']/i.test(html);
  return result;
}

// 判断响应是否为“未登录”页面 / 被重定向到登录
function looksLikeLoginHtml(text) {
  const sample = String(text || "").slice(0, 4000).toLowerCase();
  if (!sample) return false;
  return (
    sample.includes("/login") ||
    sample.includes("请先登录") ||
    sample.includes("name=\"password\"") ||
    (sample.includes("登录") && sample.includes("password"))
  );
}

function bodyText(response) {
  if (response.responseText != null) return String(response.responseText);
  if (response.response != null) return String(response.response);
  return "";
}

// 执行签到：GET 状态 + _csrf -> 未签到则 POST
async function doSign() {
  // 1) 读状态页
  let getRes;
  try {
    getRes = await httpRequest({ url: CHECKIN_URL });
  } catch (e) {
    throw Object.assign(new Error(`获取签到页失败：${e.message}`), {
      kind: OUTCOME.RETRYABLE_FAILURE,
    });
  }

  const raw = bodyText(getRes);
  const statusCode = Number(getRes.status);

  // 未登录：登录跳转 / 登录页特征
  if (
    !Number.isFinite(statusCode) ||
    statusCode === 302 ||
    statusCode === 401 ||
    statusCode === 403 ||
    looksLikeLoginHtml(raw)
  ) {
    throw Object.assign(new Error("登录状态已失效，请在当前浏览器重新登录 linux.sb。"), {
      kind: OUTCOME.LOGIN_REQUIRED,
    });
  }

  if (statusCode !== 200) {
    throw Object.assign(new Error(`请求失败（HTTP ${statusCode}）。`), {
      kind: statusCode >= 500 ? OUTCOME.RETRYABLE_FAILURE : OUTCOME.NON_RETRYABLE_FAILURE,
    });
  }

  const page = parseCheckinPage(raw);

  // 今天已签到
  if (page.status === "signed-in") {
    GM_setValue(DONE_KEY, todayKey());
    throw Object.assign(new Error("今日已签到。"), { kind: OUTCOME.ALREADY_CHECKED });
  }

  // 请先登录
  if (page.status === "guest") {
    throw Object.assign(new Error("登录状态已失效，请在当前浏览器重新登录 linux.sb。"), {
      kind: OUTCOME.LOGIN_REQUIRED,
    });
  }

  // 解析不出 _csrf 则无法提交
  if (!page.csrf) {
    throw Object.assign(new Error("未提取到 _csrf 令牌，续传页面结构可能已变化。"), {
      kind: OUTCOME.RETRYABLE_FAILURE,
    });
  }

  // 2) POST 提交签到
  const body = new URLSearchParams({ _csrf: page.csrf }).toString();
  let postRes;
  try {
    postRes = await httpRequest({
      url: CHECKIN_URL,
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      data: body,
    });
  } catch (e) {
    throw Object.assign(new Error(`提交签到失败：${e.message}`), {
      kind: OUTCOME.RETRYABLE_FAILURE,
    });
  }

  const postRaw = bodyText(postRes);
  const postStatus = Number(postRes.status);

  // 提交后复核
  if (postStatus >= 500) {
    throw Object.assign(new Error(`服务暂时异常（HTTP ${postStatus}），稍后会自动重试。`), {
      kind: OUTCOME.RETRYABLE_FAILURE,
    });
  }
  if (looksLikeLoginHtml(postRaw) || postStatus === 302) {
    throw Object.assign(new Error("提交后检测到未登录，请在当前浏览器重新登录 linux.sb。"), {
      kind: OUTCOME.LOGIN_REQUIRED,
    });
  }

  const after = parseCheckinPage(postRaw);
  const success =
    (postStatus >= 200 && postStatus < 300) &&
    (after.status === "signed-in" || /签到成功|今日已签到|今天已签到/.test(postRaw));

  if (!success) {
    throw Object.assign(new Error(`签到可能未生效（HTTP ${postStatus}），稍后会自动重试。`), {
      kind: OUTCOME.RETRYABLE_FAILURE,
    });
  }

  GM_setValue(DONE_KEY, todayKey());
  return { status: "signed-in" };
}

function notifyOutcome(kind, message) {
  if (kind === OUTCOME.SUCCESS) {
    notify("linux.sb 签到成功", message);
  } else if (kind === OUTCOME.ALREADY_CHECKED) {
    notify("linux.sb 今日已签到", message);
  } else if (kind === OUTCOME.LOGIN_REQUIRED) {
    notify("linux.sb 需要重新登录", `${message} ${RETRY_HINT}`, { onclick: openSignPage });
  } else {
    notify("linux.sb 签到失败", `${message} ${RETRY_HINT}`);
  }
}

function buildOutcomeForError(error) {
  const kind = error && error.kind ? error.kind : OUTCOME.RETRYABLE_FAILURE;
  const message = (error && error.message) || "签到失败";
  return { kind, message };
}

async function runCheckin() {
  // 今日已完成则不再请求（本地去重的冗余保险）
  if (GM_getValue(DONE_KEY, "") === todayKey()) {
    log("今日已完成，跳过。");
    return { kind: OUTCOME.ALREADY_CHECKED, message: "今日已签到。" };
  }

  try {
    await doSign();
    const message = "已完成每日签到。";
    log("签到成功");
    notifyOutcome(OUTCOME.SUCCESS, message);
    return { kind: OUTCOME.SUCCESS, message };
  } catch (error) {
    const outcome = buildOutcomeForError(error);
    log(`分类：${outcome.kind}；${outcome.message}`, "error");
    notifyOutcome(outcome.kind, outcome.message);
    throw error; // 让脚本猫定时触发时识别为失败，下一个候选时刻重试
  }
}

if (typeof GM_registerMenuCommand === "function") {
  GM_registerMenuCommand("立即签到", () => runCheckin());
  GM_registerMenuCommand("打开签到页", () => openSignPage());
}

runCheckin();
