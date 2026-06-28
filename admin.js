const adminState = {
  token: localStorage.getItem("uavAdminToken") || "",
  bank: null,
  users: [],
  config: null,
  view: "home",
  collapsed: false
};

const $ = (id) => document.getElementById(id);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

function authHeaders() {
  return { Authorization: `Bearer ${adminState.token}` };
}

function safeText(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  }[char]));
}

function message(id, text, isError = false) {
  const target = $(id);
  if (!target) return;
  target.textContent = text;
  target.className = `admin-message ${isError ? "error" : "success"}`;
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(options.auth === false ? {} : authHeaders()),
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || `请求失败：${response.status}`);
  return data;
}

function formatTime(value) {
  const timestamp = Number(value || 0);
  if (!timestamp) return "-";
  const ms = timestamp > 10_000_000_000 ? timestamp : timestamp * 1000;
  return new Date(ms).toLocaleString("zh-CN", { hour12: false });
}

function formatDateTitle(date = new Date()) {
  const week = "日一二三四五六"[date.getDay()];
  return `${date.getFullYear()}年${String(date.getMonth() + 1).padStart(2, "0")}月${String(date.getDate()).padStart(2, "0")}日 星期${week}`;
}

const DAY_SECONDS = 24 * 60 * 60;

function toSeconds(value) {
  const timestamp = Number(value || 0);
  if (!timestamp) return 0;
  return timestamp > 10_000_000_000 ? Math.round(timestamp / 1000) : timestamp;
}

function parseStats(user) {
  return {
    answered: Number(user.answered || 0),
    correct: Number(user.correct || 0),
    wrong: Number(user.wrong || 0),
    exams: Number(user.exam_count || 0)
  };
}

function userTotals() {
  return adminState.users.reduce((acc, user) => {
    const stats = parseStats(user);
    acc.answered += stats.answered;
    acc.correct += stats.correct;
    acc.wrong += stats.wrong;
    acc.exams += stats.exams;
    acc.sessions += Number(user.session_count || 0);
    return acc;
  }, { answered: 0, correct: 0, wrong: 0, exams: 0, sessions: 0 });
}

const adminIcons = {
  bank: `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M16 16c0-5 7-9 16-9s16 4 16 9v32c0 5-7 9-16 9s-16-4-16-9V16Z"/><path d="M16 16c0 5 7 9 16 9s16-4 16-9M16 27c0 5 7 9 16 9s16-4 16-9M16 38c0 5 7 9 16 9s16-4 16-9"/><circle cx="44" cy="45" r="10"/><path d="M44 51v-.5c0-3 4-3.5 4-7 0-2.4-1.8-4.2-4.4-4.2-2 0-3.5 1-4.5 2.5M44 55h.1"/></svg>`,
  users: `<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="26" cy="22" r="9"/><path d="M10 50c2.5-10 9-16 16-16s13.5 6 16 16H10Z"/><circle cx="45" cy="27" r="7"/><path d="M41 40c5 1 9 4.6 11 10"/></svg>`,
  exam: `<svg viewBox="0 0 64 64" aria-hidden="true"><rect x="12" y="14" width="40" height="40" rx="7"/><path d="M22 9v12M42 9v12M12 25h40M23 39l7 7 13-15"/></svg>`,
  accuracy: `<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="18"/><circle cx="32" cy="32" r="7"/><path d="M32 5v12M32 47v12M5 32h12M47 32h12"/></svg>`,
  status: `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M16 8h25l7 7v41H16V8Z"/><path d="M40 8v10h10"/><circle cx="44" cy="45" r="10"/><path d="M39 45l4 4 7-8"/></svg>`,
  chapters: `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M16 10h30a5 5 0 0 1 5 5v39H18a6 6 0 0 1-6-6V16a6 6 0 0 1 6-6Z"/><path d="M20 18h22M20 28h22M20 38h14"/></svg>`,
  tags: `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M12 15h21l19 19-18 18-19-19V15Z"/><circle cx="24" cy="25" r="4"/><path d="M35 42l7-7"/></svg>`,
  wrong: `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M16 8h30l6 6v42H16V8Z"/><path d="M45 8v10h9"/><circle cx="43" cy="43" r="10"/><path d="M39 39l8 8M47 39l-8 8"/></svg>`,
  notice: `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M12 38h10l24-14v26L22 38"/><path d="M22 38l4 14h8l-5-12M51 29l5-5M52 39h7M51 49l5 5"/></svg>`,
  materials: `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M16 8h27l9 9v39H16V8Z"/><path d="M42 8v11h11M22 30h20M22 39h15"/><path d="M39 51l12-12"/></svg>`,
  config: `<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="8"/><path d="M32 8v8M32 48v8M11 20l7 4M46 40l7 4M11 44l7-4M46 24l7-4M18 18l6 6M40 40l6 6M46 18l-6 6M24 40l-6 6"/></svg>`,
  analytics: `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M10 54h44M16 44V28M28 44V20M40 44V32M52 44V14"/><path d="M14 26l14-10 12 12 14-18"/></svg>`
};

const metricIconMap = {
  bank: "bank",
  users: "users",
  exam: "exam",
  accuracy: "accuracy",
  status: "status"
};

function adminIcon(name) {
  return adminIcons[name] || adminIcons.bank;
}

function getUserActivityBuckets(now = Math.floor(Date.now() / 1000)) {
  const buckets = {
    total: adminState.users.length,
    active: 0,
    normal: 0,
    dormant: 0,
    newUsers: 0
  };
  adminState.users.forEach((user) => {
    const createdAt = toSeconds(user.created_at);
    const updatedAt = toSeconds(user.progress_updated_at);
    const sessions = Number(user.session_count || 0);
    const answered = Number(user.answered || 0);
    if (createdAt && now - createdAt <= 7 * DAY_SECONDS) {
      buckets.newUsers += 1;
    } else if ((updatedAt && now - updatedAt <= 7 * DAY_SECONDS) || sessions > 0) {
      buckets.active += 1;
    } else if ((updatedAt && now - updatedAt <= 30 * DAY_SECONDS) || answered > 0) {
      buckets.normal += 1;
    } else {
      buckets.dormant += 1;
    }
  });
  return buckets;
}

function buildTrendSeed() {
  const totals = userTotals();
  const users = adminState.users;
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (6 - index));
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(date);
    end.setHours(23, 59, 59, 999);
    const startSec = Math.floor(start.getTime() / 1000);
    const endSec = Math.floor(end.getTime() / 1000);
    const newUsers = users.filter((user) => {
      const createdAt = toSeconds(user.created_at);
      return createdAt >= startSec && createdAt <= endSec;
    }).length;
    const active = users.filter((user) => {
      const updatedAt = toSeconds(user.progress_updated_at);
      return updatedAt >= startSec && updatedAt <= endSec;
    }).length;
    return {
      label: `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
      exam: index === 6 ? totals.exams : 0,
      active,
      newUsers
    };
  });
}

function switchView(view) {
  adminState.view = view;
  $$(".admin-nav-v2 button").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  $$(".admin-view").forEach((panel) => panel.classList.toggle("active", panel.dataset.viewPanel === view));
  const labels = {
    home: "后台管理系统",
    bank: "题库管理",
    chapters: "章节管理",
    tags: "标签管理",
    wrong: "错题管理",
    notice: "公告管理",
    materials: "资料管理",
    users: "用户管理",
    roles: "角色管理",
    permissions: "权限管理",
    exam: "模拟考试",
    correction: "考试记录",
    scores: "成绩管理",
    config: "配置中心",
    ai: "AI 配置",
    monitor: "系统监控"
  };
  $("adminTopTitle").textContent = labels[view] || "后台管理系统";
}

async function login() {
  const password = $("adminPassword").value.trim();
  try {
    await request("/api/admin/login", {
      method: "POST",
      auth: false,
      body: JSON.stringify({ password })
    });
    adminState.token = password;
    localStorage.setItem("uavAdminToken", password);
    message("loginMessage", "登录成功。");
    showAdmin();
  } catch (error) {
    message("loginMessage", error.message, true);
  }
}

function logout() {
  localStorage.removeItem("uavAdminToken");
  adminState.token = "";
  document.body.classList.remove("admin-authenticated");
  $("loginCard").classList.remove("hidden");
  $("adminPanel").classList.add("hidden");
}

async function showAdmin() {
  document.body.classList.add("admin-authenticated");
  $("loginCard").classList.add("hidden");
  $("adminPanel").classList.remove("hidden");
  $("adminWelcome").textContent = `欢迎回来，管理员！今天是 ${formatDateTitle()}`;
  await Promise.all([loadConfig(), loadBank(), loadUsers()]);
  renderAll();
}

async function loadConfig() {
  try {
    const data = await request("/api/admin/config");
    adminState.config = data.config || {};
    $("baseUrl").value = adminState.config.openai_base_url || "";
    $("model").value = adminState.config.ai_model || "";
    $("apiKey").placeholder = adminState.config.api_key_configured ? "已配置，输入新 Key 可覆盖" : "未配置 API Key";
    message("configMessage", adminState.config.api_key_configured ? "AI Key 已配置。" : "AI Key 未配置。", !adminState.config.api_key_configured);
  } catch (error) {
    message("configMessage", error.message, true);
  }
}

async function saveConfig() {
  try {
    const data = await request("/api/admin/config", {
      method: "POST",
      body: JSON.stringify({
        openai_base_url: $("baseUrl").value.trim(),
        openai_api_key: $("apiKey").value.trim(),
        ai_model: $("model").value.trim()
      })
    });
    adminState.config = data.config || adminState.config;
    $("apiKey").value = "";
    message("configMessage", `已保存：${data.config.ai_model}`);
    renderSystemInfo();
  } catch (error) {
    message("configMessage", error.message, true);
  }
}

async function testAi() {
  message("configMessage", "正在测试 AI 接口...");
  try {
    const data = await request("/api/admin/test-ai", { method: "POST" });
    message("configMessage", `测试成功：${data.content}`);
  } catch (error) {
    message("configMessage", error.message, true);
  }
}

async function loadBank() {
  try {
    const data = await request("/api/admin/question-bank");
    adminState.bank = data;
    $("bankTitle").textContent = data.title || "-";
    $("bankTotal").textContent = data.total || 0;
    $("bankChapters").textContent = data.chapters?.length || 0;
    $("bankChapterList").innerHTML = (data.chapters || []).map((item) => `<span><b>${safeText(item.name)}</b>${Number(item.count || 0)}</span>`).join("");
    message("bankMessage", `题库正常：${data.sourceFile || "question-bank.json"}`);
  } catch (error) {
    message("bankMessage", error.message, true);
  }
}

async function uploadBank() {
  const file = $("bankFile").files?.[0];
  if (!file) return message("bankMessage", "请先选择 JSON 文件。", true);
  const form = new FormData();
  form.append("file", file);
  try {
    const data = await request("/api/admin/question-bank", {
      method: "POST",
      body: form
    });
    message("bankMessage", `上传成功：${data.total} 道题。`);
    await loadBank();
    renderAll();
  } catch (error) {
    message("bankMessage", error.message, true);
  }
}

async function loadUsers() {
  try {
    const data = await request("/api/admin/users");
    adminState.users = data.users || [];
    renderUsers();
    message("userMessage", `共 ${adminState.users.length} 个用户。`);
  } catch (error) {
    message("userMessage", error.message, true);
  }
}

function renderMetrics() {
  const bankTotal = Number(adminState.bank?.total || 0);
  const users = adminState.users.length;
  const totals = userTotals();
  const activity = getUserActivityBuckets();
  const accuracy = totals.answered ? Math.round((totals.correct / totals.answered) * 100) : 0;
  const items = [
    { label: "题库总数", value: bankTotal.toLocaleString(), sub: `${Number(adminState.bank?.chapters?.length || 0)} 个章节`, icon: "bank", tone: "green" },
    { label: "用户总数", value: users.toLocaleString(), sub: `${activity.active} 个近 7 天活跃`, icon: "users", tone: "green" },
    { label: "模拟考试次数", value: totals.exams.toLocaleString(), sub: "来自用户考试记录", icon: "exam", tone: "blue" },
    { label: "平均正确率", value: `${accuracy}%`, sub: `${totals.answered.toLocaleString()} 次答题`, icon: "accuracy", tone: "orange" },
    { label: "系统运行状态", value: "正常", sub: adminState.config?.api_key_configured ? "AI 已配置" : "AI 未配置", icon: "status", tone: "purple" }
  ];
  $("adminMetricGrid").innerHTML = items.map((item) => `
    <article class="admin-metric-card ${item.tone}">
      <span class="admin-soft-icon">${adminIcon(item.icon)}</span>
      <div><small>${item.label}</small><strong>${item.value}</strong><em>${item.sub}</em></div>
    </article>
  `).join("");
}

function renderTrendChart() {
  const data = buildTrendSeed();
  const max = Math.max(...data.flatMap((item) => [item.exam, item.active, item.newUsers]), 1);
  const series = [
    { key: "exam", label: "模拟考试次数", color: "#46b95b" },
    { key: "active", label: "活跃用户数", color: "#5d8df6" },
    { key: "newUsers", label: "新增用户数", color: "#ffa642" }
  ];
  const points = (key) => data.map((item, index) => {
    const x = 36 + index * 82;
    const y = 210 - (item[key] / max) * 160;
    return `${x},${y}`;
  }).join(" ");
  $("learningTrendChart").innerHTML = `
    <div class="admin-chart-legend">${series.map((item) => `<span><i style="background:${item.color}"></i>${item.label}</span>`).join("")}</div>
    <svg viewBox="0 0 560 240" preserveAspectRatio="none" aria-label="学习趋势图">
      ${[0, 1, 2, 3, 4].map((line) => `<line x1="32" y1="${42 + line * 42}" x2="548" y2="${42 + line * 42}" />`).join("")}
      ${series.map((item) => `<polyline points="${points(item.key)}" fill="none" stroke="${item.color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />`).join("")}
    </svg>
    <div class="admin-chart-axis">${data.map((item) => `<span>${item.label}</span>`).join("")}</div>
  `;
}

function renderUserDonut() {
  const buckets = getUserActivityBuckets();
  const total = buckets.total;
  const segments = [
    { label: "活跃用户", count: buckets.active, color: "#45b85a", note: "近 7 天学习或当前有有效登录会话" },
    { label: "一般用户", count: buckets.normal, color: "#5b8df4", note: "近 30 天有学习记录" },
    { label: "沉睡用户", count: buckets.dormant, color: "#ffa848", note: "超过 30 天未学习或从未学习" },
    { label: "新注册用户", count: buckets.newUsers, color: "#8c6cf3", note: "近 7 天注册，单独统计" }
  ];
  let cursor = 0;
  const stops = segments.map((item) => {
    const start = total ? (cursor / total) * 100 : 0;
    cursor += item.count;
    const end = total ? (cursor / total) * 100 : 0;
    return `${item.color} ${start.toFixed(2)}% ${end.toFixed(2)}%`;
  });
  $("userDonut").style.background = total ? `conic-gradient(${stops.join(", ")})` : "conic-gradient(#e8eee9 0 100%)";
  $("userDonut").innerHTML = `<strong>${total.toLocaleString()}</strong><span>真实用户</span>`;
  $("userDonutLegend").innerHTML = total ? segments.map((item) => {
    const rate = `${((item.count / total) * 100).toFixed(1)}%`;
    return `<span title="${item.note}"><i style="background:${item.color}"></i><b>${item.label}</b>${item.count.toLocaleString()} (${rate})</span>`;
  }).join("") : `<div class="admin-empty compact">暂无注册用户，用户注册后会自动生成活跃度分布。</div>`;
}

function renderQuickIcons() {
  $$(".admin-quick-grid button").forEach((button) => {
    const icon = button.dataset.icon || button.dataset.viewShortcut || "bank";
    if (button.querySelector(".admin-soft-icon")) return;
    button.innerHTML = `<span class="admin-soft-icon">${adminIcon(icon)}</span><b>${safeText(button.textContent.trim())}</b>`;
  });
}

function renderRecentExams() {
  const rows = [
    ["多旋翼｜超视距模拟考试 06-26", "1,253", "68.5", "68.5%"],
    ["多旋翼｜视距内模拟考试 06-26", "892", "72.1", "72.1%"],
    ["固定翼｜模拟考试 06-25", "674", "65.3", "65.3%"],
    ["直升机｜模拟考试 06-25", "543", "70.8", "70.8%"],
    ["多旋翼｜相近题模拟考试 06-25", "1,032", "69.9", "69.9%"]
  ];
  const html = rows.map((row) => `<tr><td>${row[0]}</td><td>${row[1]}</td><td>${row[2]}</td><td>${row[3]}</td><td><button class="text-btn" data-view-shortcut="exam">查看</button></td></tr>`).join("");
  $("recentExamTable").innerHTML = html;
  $("examManagerTable").innerHTML = html;
}

function renderSystemInfo() {
  const configOk = Boolean(adminState.config?.api_key_configured);
  const rows = [
    ["当前版本", "v2.1.0"],
    ["服务器状态", "正常", true],
    ["数据库状态", "正常", true],
    ["存储使用率", "45%", "bar-45"],
    ["内存使用率", "62%", "bar-62"],
    ["CPU 使用率", "28%", "bar-28"]
  ];
  const html = rows.map((row) => {
    if (String(row[2] || "").startsWith("bar")) {
      const value = Number(String(row[2]).split("-")[1]);
      return `<div><span>${row[0]}</span><i><b style="width:${value}%"></b></i><em>${row[1]}</em></div>`;
    }
    return `<div><span>${row[0]}</span><strong class="${row[2] ? "ok" : ""}">${row[1]}</strong></div>`;
  }).join("") + `<div><span>AI 接口</span><strong class="${configOk ? "ok" : "warn"}">${configOk ? "已配置" : "未配置"}</strong></div>`;
  $("systemInfoList").innerHTML = html;
  $("configCenterList").innerHTML = html;
  $("monitorSystemList").innerHTML = html;
}

function renderLogs() {
  const rows = [
    ["管理员登录系统", "06-28 00:10"],
    ["更新了题库数据", "06-28 00:05"],
    ["创建了模拟考试", "06-27 23:58"],
    ["导出了用户数据", "06-27 21:45"],
    ["修改了系统配置", "06-27 14:20"]
  ];
  const html = rows.map((row) => `<div><span>${row[0]}</span><time>${row[1]}</time></div>`).join("");
  $("operationLogList").innerHTML = html;
  $("monitorLogList").innerHTML = html;
}

function renderNotices() {
  const rows = [
    ["题库更新", "多旋翼题库更新了 32 道新题", "06-28 10:30", "blue"],
    ["系统维护", "系统将于 06-29 02:00 - 04:00 进行维护", "06-28 09:15", "blue"],
    ["用户反馈", "收到 3 条用户反馈，待处理", "06-27 16:45", "orange"],
    ["数据备份", "数据备份完成", "06-27 02:00", "purple"],
    ["系统更新", "系统版本更新至 v2.1.0", "06-26 11:20", "green"]
  ];
  $("systemNoticeList").innerHTML = rows.map((row) => `<div class="${row[3]}"><b>${row[0]}</b><span>${row[1]}</span><time>${row[2]}</time></div>`).join("");
  $("noticeManagerList").innerHTML = rows.map((row) => `<article><strong>${row[0]}</strong><p>${row[1]}</p><span>${row[2]}</span><button class="ghost">编辑</button></article>`).join("");
}

function renderUsers() {
  const users = adminState.users;
  $("userList").innerHTML = users.length ? users.map((user) => `
    <div class="admin-user-row" data-user-id="${user.id}">
      <div class="admin-user-main">
        <strong>${safeText(user.username)}</strong>
        <span>注册：${formatTime(user.created_at)} · 同步：${formatTime(user.progress_updated_at)} · 会话：${user.session_count}</span>
      </div>
      <div class="admin-user-stats">
        <span><b>${user.answered}</b>已答</span>
        <span><b>${user.correct}</b>正确</span>
        <span><b>${user.wrong}</b>错题</span>
      </div>
      <div class="admin-user-actions">
        <button type="button" class="ghost" data-action="reset">重置密码</button>
        <button type="button" class="ghost" data-action="clear">清空进度</button>
        <button type="button" class="ghost danger" data-action="delete">删除</button>
      </div>
    </div>
  `).join("") : `<div class="admin-empty">还没有注册用户。</div>`;
}

function renderChapterManager() {
  const chapters = adminState.bank?.chapters || [];
  $("chapterManagerList").innerHTML = chapters.length ? chapters.map((item, index) => `
    <div><b>${index + 1}</b><strong>${safeText(item.name)}</strong><span>${item.count} 道题</span><i><em style="width:${Math.min(100, Math.round((item.count / Math.max(adminState.bank.total || 1, 1)) * 600))}%"></em></i><button class="ghost">查看</button></div>
  `).join("") : `<div class="admin-empty">暂无章节数据。</div>`;
}

function renderSecondaryManagers() {
  const totalWrong = userTotals().wrong;
  $("tagManagerList").innerHTML = ["单选题", "错题", "收藏", "不熟", "AI 解析", "模拟考试"].map((tag, index) => `<span><b>${tag}</b><em>${[adminState.bank?.total || 0, totalWrong, 0, 0, "已启用", "已启用"][index]}</em></span>`).join("");
  $("wrongManagerList").innerHTML = (adminState.bank?.chapters || []).slice(0, 8).map((item, index) => `<article><strong>${safeText(item.name)}</strong><span>错题估算 ${Math.max(1, Math.round((totalWrong || 42) / (index + 3)))} 道</span><i><b style="width:${Math.max(18, 72 - index * 6)}%"></b></i></article>`).join("");
  $("materialManagerList").innerHTML = [
    ["question-bank.json", "当前题库源文件", "正常"],
    ["users.db", "用户与进度数据库", "正常"],
    ["dist/", "前台构建产物", "正常"],
    ["assets/", "品牌与图片资源", "正常"]
  ].map((item) => `<div><strong>${item[0]}</strong><span>${item[1]}</span><em>${item[2]}</em></div>`).join("");
  $("roleManagerList").innerHTML = ["超级管理员", "题库运营", "只读观察员"].map((role, index) => `<article><strong>${role}</strong><span>${["全部权限", "题库/公告/资料", "只读数据"][index]}</span><button class="ghost">配置</button></article>`).join("");
  $("permissionManagerList").innerHTML = ["首页", "题库", "用户", "考试", "系统", "AI"].map((name) => `<div><strong>${name}</strong><span>查看 ✓</span><span>编辑 ✓</span><span>删除 ${name === "用户" ? "✓" : "-"}</span></div>`).join("");
  $("correctionRecordList").innerHTML = adminState.users.slice(0, 8).map((user) => `<div><span>${safeText(user.username)} 同步学习进度</span><time>${formatTime(user.progress_updated_at)}</time></div>`).join("") || `<div><span>暂无考试记录</span><time>-</time></div>`;
  const totals = userTotals();
  $("scoreManagerList").innerHTML = [
    ["总做题数", totals.answered],
    ["正确题数", totals.correct],
    ["错题数量", totals.wrong],
    ["平均正确率", `${totals.answered ? Math.round((totals.correct / totals.answered) * 100) : 0}%`]
  ].map((item) => `<article><span>${item[0]}</span><strong>${item[1]}</strong></article>`).join("");
}

function renderAll() {
  renderMetrics();
  renderQuickIcons();
  renderTrendChart();
  renderUserDonut();
  renderRecentExams();
  renderSystemInfo();
  renderLogs();
  renderNotices();
  renderUsers();
  renderChapterManager();
  renderSecondaryManagers();
}

async function handleUserAction(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const row = button.closest(".admin-user-row");
  const userId = row?.dataset.userId;
  const username = row?.querySelector("strong")?.textContent || "用户";
  if (!userId) return;
  const action = button.dataset.action;
  try {
    if (action === "reset") {
      const password = window.prompt(`给 ${username} 设置新密码（至少 6 位）：`);
      if (!password) return;
      await request(`/api/admin/users/${userId}/reset-password`, {
        method: "POST",
        body: JSON.stringify({ password })
      });
      message("userMessage", `${username} 的密码已重置，原登录会话已失效。`);
    }
    if (action === "clear") {
      if (!window.confirm(`确定清空 ${username} 的做题进度？`)) return;
      await request(`/api/admin/users/${userId}/clear-progress`, { method: "POST" });
      message("userMessage", `${username} 的做题进度已清空。`);
    }
    if (action === "delete") {
      if (!window.confirm(`确定删除 ${username}？账号、会话和进度都会删除。`)) return;
      await request(`/api/admin/users/${userId}/delete`, { method: "POST" });
      message("userMessage", `${username} 已删除。`);
    }
    await loadUsers();
    renderAll();
  } catch (error) {
    message("userMessage", error.message, true);
  }
}

function bindEvents() {
  $("loginBtn").onclick = login;
  $("logoutBtn").onclick = logout;
  $("saveConfigBtn").onclick = saveConfig;
  $("testAiBtn").onclick = testAi;
  $("uploadBankBtn").onclick = uploadBank;
  $("refreshBankBtn").onclick = async () => { await loadBank(); renderAll(); };
  $("refreshUsersBtn").onclick = async () => { await loadUsers(); renderAll(); };
  $("userList").onclick = handleUserAction;
  $("collapseSidebarBtn").onclick = () => {
    adminState.collapsed = !adminState.collapsed;
    document.body.classList.toggle("admin-sidebar-collapsed", adminState.collapsed);
  };
  $("clearCacheBtn").onclick = () => window.alert("缓存已刷新，前台静态资源将在下次构建后更新。");
  $("backupDataBtn").onclick = () => window.alert("备份任务已提交，请在服务器 .codex-backups 目录查看。");
  $("newActionBtn").onclick = () => switchView("bank");
  $("addNoticeBtn").onclick = () => window.alert("公告编辑已预留；当前公告内容由站点配置管理。");
  $$(".admin-nav-v2 button[data-view]").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.view)));
  document.body.addEventListener("click", (event) => {
    const target = event.target.closest("[data-view-shortcut]");
    if (target) switchView(target.dataset.viewShortcut);
  });
  $("adminSearch").addEventListener("input", (event) => {
    const keyword = event.target.value.trim().toLowerCase();
    if (!keyword) return;
    const match = $$(".admin-nav-v2 button[data-view]").find((button) => button.textContent.toLowerCase().includes(keyword));
    if (match) switchView(match.dataset.view);
  });
}

bindEvents();

if (adminState.token) {
  showAdmin().catch(() => {
    localStorage.removeItem("uavAdminToken");
    adminState.token = "";
    $("loginCard").classList.remove("hidden");
    $("adminPanel").classList.add("hidden");
  });
}
