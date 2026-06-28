const ALL_CHAPTER = "全部";
const EXAM_SIZE = 100;
const PASS_SCORE = 90;

const state = {
  bank: null,
  user: null,
  token: localStorage.getItem("uavQuizToken") || "",
  syncStatus: "未登录",
  syncTimer: null,
  chapter: ALL_CHAPTER,
  wrongBook: false,
  wrongChapter: ALL_CHAPTER,
  studyFocus: false,
  mode: "review",
  index: 0,
  selected: "",
  revealed: true,
  stats: JSON.parse(localStorage.getItem("uavQuizStats") || "{}"),
  search: "",
  aiLoading: false,
  aiContent: "",
  aiQuestionId: "",
  examAnalysisLoading: false,
  examAnalysis: "",
  exam: null
};

const el = (id) => document.getElementById(id);

function authHeaders() {
  return state.token ? { Authorization: `Bearer ${state.token}` } : {};
}

function setAuthMessage(message, type = "") {
  const target = el("authMessage");
  if (!target) return;
  target.textContent = message || "";
  target.className = `auth-message ${type}`;
}

function mergeStats(localStats, remoteStats) {
  const merged = { ...(remoteStats || {}) };
  for (const [id, item] of Object.entries(localStats || {})) {
    const remoteItem = merged[id];
    if (!remoteItem || Number(item.updated_at || 0) >= Number(remoteItem.updated_at || 0)) {
      merged[id] = item;
    }
  }
  return merged;
}

function renderAccount() {
  const signedIn = Boolean(state.user && state.token);
  el("accountLabel").textContent = signedIn ? state.user.username : "本机练习";
  el("syncLabel").textContent = signedIn ? state.syncStatus : "未登录";
  el("authForm").classList.toggle("hidden", signedIn);
  el("accountActions").classList.toggle("hidden", !signedIn);
}

function baseQuestions() {
  if (!state.bank) return [];
  let list = state.chapter === ALL_CHAPTER
    ? state.bank.questions
    : state.bank.questions.filter((item) => item.chapter === state.chapter);
  if (state.wrongBook) {
    const wrongIds = new Set(Object.entries(state.stats).filter(([, item]) => !item.correct).map(([id]) => id));
    list = list.filter((item) => wrongIds.has(item.id));
    if (state.wrongChapter !== ALL_CHAPTER) {
      list = list.filter((item) => item.chapter === state.wrongChapter);
    }
  }
  const keyword = state.search.trim().toLowerCase();
  if (keyword) {
    list = list.filter((item) => {
      const options = (item.options || []).map((option) => option.text).join(" ");
      return `${item.chapter} ${item.stem} ${options}`.toLowerCase().includes(keyword);
    });
  }
  return list;
}

function filteredQuestions() {
  if (state.mode === "exam" && state.exam) return state.exam.questions;
  return baseQuestions();
}

function activeQuestion() {
  const list = filteredQuestions();
  return list[Math.min(state.index, Math.max(list.length - 1, 0))] || null;
}

function saveStats() {
  localStorage.setItem("uavQuizStats", JSON.stringify(state.stats));
  queueSync();
}

function queueSync() {
  if (!state.token) return;
  state.syncStatus = "待同步";
  renderAccount();
  window.clearTimeout(state.syncTimer);
  state.syncTimer = window.setTimeout(() => syncProgress(), 600);
}

async function syncProgress({ silent = true } = {}) {
  if (!state.token) return;
  state.syncStatus = "同步中";
  renderAccount();
  try {
    const response = await fetch("/api/progress", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ stats: state.stats })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || `同步失败：${response.status}`);
    state.syncStatus = "已同步";
    if (!silent) setAuthMessage("进度已同步。", "success");
  } catch (error) {
    state.syncStatus = "同步失败";
    if (!silent) setAuthMessage(error.message, "error");
  } finally {
    renderAccount();
  }
}

function progress() {
  const entries = Object.values(state.stats);
  const wrong = entries.filter((item) => !item.correct).length;
  return { answered: entries.length, wrong, correct: entries.length - wrong };
}

function wrongGroups() {
  if (!state.bank) return [];
  const groups = new Map();
  for (const question of state.bank.questions || []) {
    const item = state.stats[question.id];
    if (!item || item.correct) continue;
    const name = question.chapter || "未标注";
    groups.set(name, (groups.get(name) || 0) + 1);
  }
  return [...groups.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh-CN"));
}

function wrongQuestions() {
  if (!state.bank) return [];
  return (state.bank.questions || []).filter((question) => {
    const item = state.stats[question.id];
    if (!item || item.correct) return false;
    return state.wrongChapter === ALL_CHAPTER || question.chapter === state.wrongChapter;
  });
}

function shuffle(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function buildExamQuestions() {
  const preferred = baseQuestions();
  const seen = new Set();
  const picked = [];
  for (const question of shuffle(preferred)) {
    if (!seen.has(question.id)) {
      picked.push(question);
      seen.add(question.id);
    }
    if (picked.length >= EXAM_SIZE) return picked;
  }
  for (const question of shuffle(state.bank.questions || [])) {
    if (!seen.has(question.id)) {
      picked.push(question);
      seen.add(question.id);
    }
    if (picked.length >= EXAM_SIZE) break;
  }
  return picked;
}

function startExam() {
  state.exam = {
    questions: buildExamQuestions(),
    answers: {},
    submitted: false
  };
  state.index = 0;
  state.selected = "";
  state.revealed = false;
  state.aiContent = "";
  state.aiQuestionId = "";
  state.examAnalysis = "";
  state.examAnalysisLoading = false;
  render();
}

function examScore() {
  if (!state.exam) return { answered: 0, correct: 0, total: 0, passed: false };
  const total = state.exam.questions.length;
  let correct = 0;
  for (const question of state.exam.questions) {
    if (state.exam.answers[question.id] === question.answer) correct += 1;
  }
  return {
    answered: Object.keys(state.exam.answers).length,
    correct,
    total,
    passed: correct >= PASS_SCORE
  };
}

function setQuestion(index) {
  const list = filteredQuestions();
  state.index = Math.min(Math.max(index, 0), Math.max(list.length - 1, 0));
  const question = activeQuestion();
  if (state.mode === "exam" && state.exam) {
    state.selected = question ? state.exam.answers[question.id] || "" : "";
    state.revealed = state.exam.submitted;
  } else {
    const saved = question ? state.stats[question.id] : null;
    state.selected = saved?.answer || "";
    state.revealed = state.mode === "review" || Boolean(saved);
  }
  state.aiContent = "";
  state.aiQuestionId = "";
  render();
}

function chooseAnswer(answer) {
  const question = activeQuestion();
  if (!question) return;
  state.selected = answer;
  if (state.mode === "exam" && state.exam) {
    if (state.exam.submitted) return;
    state.exam.answers[question.id] = answer;
    state.revealed = false;
  } else {
    state.revealed = true;
    state.stats[question.id] = { answer, correct: answer === question.answer, updated_at: Date.now() };
    saveStats();
  }
  render();
}

function saveExamProgress() {
  if (!state.exam) return;
  let changed = false;
  const now = Date.now();
  for (const question of state.exam.questions) {
    const answer = state.exam.answers[question.id];
    if (!answer) continue;
    const correct = answer === question.answer;
    state.stats[question.id] = { answer, correct, updated_at: now };
    changed = true;
  }
  if (changed) saveStats();
}

function renderChapters() {
  const list = el("chapterList");
  list.innerHTML = "";
  const all = [{ name: ALL_CHAPTER, count: state.bank.total }, ...state.bank.chapters];
  for (const chapter of all) {
    const button = document.createElement("button");
    button.className = `chapter-btn ${state.chapter === chapter.name ? "active" : ""}`;
    button.innerHTML = `<span>${chapter.name}</span><b>${chapter.count}</b>`;
    button.onclick = () => {
      state.chapter = chapter.name;
      state.wrongBook = false;
      state.wrongChapter = ALL_CHAPTER;
      state.index = 0;
      state.selected = "";
      state.revealed = state.mode === "review";
      if (state.mode === "exam") startExam();
      else render();
    };
    list.appendChild(button);
  }
}

function renderExamPanel() {
  const panel = el("examPanel");
  if (state.mode !== "exam" || !state.exam) {
    panel.className = "exam-panel hidden";
    panel.innerHTML = "";
    renderExamAnalysisPanel();
    return;
  }
  const score = examScore();
  panel.className = `exam-panel ${state.exam.submitted ? (score.passed ? "passed" : "failed") : ""}`;
  if (state.exam.submitted) {
    panel.innerHTML = `
      <div>
        <strong>模拟考试已交卷</strong>
        <span>${score.correct} 分 / ${score.total} 分，${score.passed ? "已及格" : "未及格"}，及格线 ${PASS_SCORE} 分。</span>
      </div>
      <div class="exam-actions">
        <button id="analyzeExamBtn" type="button">AI 分析答卷</button>
        <button id="restartExamBtn" type="button" class="ghost">重新抽题</button>
      </div>
    `;
  } else {
    panel.innerHTML = `
      <div>
        <strong>模拟考试</strong>
        <span>共 ${score.total} 道题，每题 1 分，90 分及格。已作答 ${score.answered} / ${score.total}。</span>
      </div>
      <button id="submitExamBtn" type="button">交卷</button>
    `;
  }
  const analyze = el("analyzeExamBtn");
  if (analyze) {
    analyze.disabled = state.examAnalysisLoading;
    analyze.textContent = state.examAnalysisLoading ? "分析中..." : "AI 分析答卷";
    analyze.onclick = analyzeExam;
  }
  const submit = el("submitExamBtn");
  if (submit) {
    submit.onclick = () => {
      state.exam.submitted = true;
      state.revealed = true;
      state.examAnalysis = "";
      saveExamProgress();
      render();
    };
  }
  const restart = el("restartExamBtn");
  if (restart) restart.onclick = startExam;
  renderExamAnalysisPanel();
}

function examAnalysisPayload() {
  const score = examScore();
  const chapterStats = {};
  const wrongItems = [];
  for (const question of state.exam.questions) {
    const chapter = question.chapter || "未标注";
    const userAnswer = state.exam.answers[question.id] || "";
    const wrong = userAnswer !== question.answer;
    if (!chapterStats[chapter]) chapterStats[chapter] = { total: 0, wrong: 0 };
    chapterStats[chapter].total += 1;
    if (wrong) {
      chapterStats[chapter].wrong += 1;
      wrongItems.push({
        chapter,
        question: question.stem,
        user_answer: userAnswer,
        correct_answer: question.answer
      });
    }
  }
  return {
    total: score.total,
    answered: score.answered,
    correct: score.correct,
    pass_score: PASS_SCORE,
    chapter_stats: chapterStats,
    wrong_items: wrongItems
  };
}

function renderExamAnalysisPanel() {
  const panel = el("examAnalysisPanel");
  if (state.mode !== "exam" || !state.exam?.submitted) {
    panel.className = "exam-analysis-panel hidden";
    panel.innerHTML = "";
    return;
  }
  if (state.examAnalysisLoading) {
    panel.className = "exam-analysis-panel";
    panel.innerHTML = "<strong>AI 正在分析答卷...</strong><p>正在整理错题章节和后续复习建议。</p>";
    return;
  }
  if (!state.examAnalysis) {
    panel.className = "exam-analysis-panel muted";
    panel.innerHTML = "<strong>考后分析</strong><p>点击上方“AI 分析答卷”，生成薄弱章节和后续复习建议。</p>";
    return;
  }
  const isError = state.examAnalysis.startsWith("AI 分析失败");
  panel.className = `exam-analysis-panel ${isError ? "error" : ""}`;
  panel.innerHTML = `<strong>AI 答卷分析</strong><div class="ai-content">${renderMarkdown(state.examAnalysis)}</div>`;
}

function renderWrongBookPanel() {
  const panel = el("wrongBookPanel");
  if (!state.wrongBook) {
    panel.className = "wrong-book-panel hidden";
    panel.innerHTML = "";
    return;
  }
  const groups = wrongGroups();
  const total = groups.reduce((sum, item) => sum + item.count, 0);
  panel.className = "wrong-book-panel";
  if (!total) {
    panel.innerHTML = `
      <div class="wrong-book-head">
        <div><strong>错题本</strong><span>当前还没有错题。</span></div>
        <button id="exitWrongBookBtn" type="button" class="ghost">返回全部题</button>
      </div>
    `;
  } else {
    const activeLabel = state.wrongChapter === ALL_CHAPTER ? `全部错题 ${total}` : `${state.wrongChapter} ${filteredQuestions().length}`;
    const wrongItems = wrongQuestions().slice(0, 8);
    panel.innerHTML = `
      <div class="wrong-book-head">
        <div><strong>错题本</strong><span>${activeLabel} 道，按章节整理复习。</span></div>
        <button id="exitWrongBookBtn" type="button" class="ghost">返回全部题</button>
      </div>
      <div class="wrong-chips">
        <button type="button" class="${state.wrongChapter === ALL_CHAPTER ? "active" : ""}" data-index="-1">全部 <b>${total}</b></button>
        ${groups.map((group, index) => `<button type="button" class="${state.wrongChapter === group.name ? "active" : ""}" data-index="${index}">${escapeHtml(group.name)} <b>${group.count}</b></button>`).join("")}
      </div>
      <div class="wrong-list">
        ${wrongItems.map((question) => `
          <button type="button" data-id="${escapeHtml(question.id)}">
            <b>${escapeHtml(question.chapter || "未标注")}</b>
            <span>${escapeHtml(question.stem)}</span>
          </button>
        `).join("")}
      </div>
    `;
  }
  el("exitWrongBookBtn").onclick = () => {
    state.wrongBook = false;
    state.wrongChapter = ALL_CHAPTER;
    state.index = 0;
    setQuestion(0);
  };
  panel.querySelectorAll(".wrong-chips button").forEach((button) => {
    button.onclick = () => {
      const index = Number(button.dataset.index);
      state.wrongChapter = index >= 0 ? groups[index]?.name || ALL_CHAPTER : ALL_CHAPTER;
      setQuestion(0);
    };
  });
  panel.querySelectorAll(".wrong-list button").forEach((button) => {
    button.onclick = () => {
      const list = filteredQuestions();
      const targetIndex = list.findIndex((question) => question.id === button.dataset.id);
      if (targetIndex >= 0) setQuestion(targetIndex);
    };
  });
}

function render() {
  if (!state.bank) return;
  const list = filteredQuestions();
  const question = activeQuestion();
  const prog = progress();
  const rate = prog.answered ? Math.round((prog.correct / prog.answered) * 100) : 0;
  const examMode = state.mode === "exam";
  const score = examScore();

  renderChapters();
  renderExamPanel();
  renderWrongBookPanel();
  document.body.classList.toggle("study-focus", state.studyFocus);

  el("title").textContent = state.bank.title;
  el("subtitle").textContent = `${state.bank.subtitle} · ${state.bank.generatedAt} · ${state.bank.total} 道题`;
  if (state.wrongBook) {
    el("subtitle").textContent = `错题本复习 · ${state.wrongChapter === ALL_CHAPTER ? "全部章节" : state.wrongChapter} · ${list.length} 道错题`;
  }
  el("totalCount").textContent = String(examMode ? score.total : list.length);
  el("answeredCount").textContent = String(examMode ? score.answered : prog.answered);
  el("wrongCount").textContent = String(examMode && state.exam?.submitted ? score.total - score.correct : prog.wrong);
  el("correctRate").textContent = examMode
    ? `${score.correct}分`
    : `${rate}%`;
  el("questionPosition").textContent = list.length ? `${state.index + 1} / ${list.length}` : "0 / 0";
  el("mobileStudyPosition").textContent = list.length ? `${state.index + 1} / ${list.length}` : "0 / 0";

  if (!question) {
    el("questionChapter").textContent = "没有匹配题目";
    el("mobileStudyChapter").textContent = "没有匹配题目";
    el("questionType").textContent = "-";
    el("questionStem").textContent = "当前筛选没有题目";
    el("options").innerHTML = "";
    el("answerPanel").className = "answer-panel hidden";
    el("aiPanel").className = "ai-panel hidden";
    return;
  }

  const saved = examMode && state.exam
    ? { answer: state.exam.answers[question.id] || "", correct: state.exam.answers[question.id] === question.answer }
    : state.stats[question.id];

  state.selected = examMode && state.exam ? state.exam.answers[question.id] || "" : state.selected;
  state.revealed = examMode ? Boolean(state.exam?.submitted) : state.revealed;

  el("questionChapter").textContent = question.chapter;
  el("mobileStudyChapter").textContent = question.chapter;
  el("questionType").textContent = question.type || "单选";
  el("questionStem").textContent = question.stem;
  el("prevBtn").disabled = state.index <= 0;
  el("nextBtn").disabled = state.index >= list.length - 1;
  el("showBtn").style.display = state.revealed || examMode ? "none" : "inline-flex";
  el("aiBtn").disabled = state.aiLoading;
  el("aiBtn").textContent = state.aiLoading ? "AI 讲解中..." : "AI 讲解这题";
  el("randomBtn").disabled = examMode;
  el("wrongBtn").disabled = examMode;
  el("wrongBtn").textContent = state.wrongBook ? "错题本中" : "整理错题";
  el("resetBtn").textContent = examMode ? "重新抽题" : "重置进度";

  el("options").innerHTML = "";
  for (const option of question.options) {
    const selected = state.selected === option.key;
    const correct = state.revealed && option.key === question.answer;
    const wrong = state.revealed && selected && option.key !== question.answer;
    const button = document.createElement("button");
    button.className = `option-btn ${selected ? "selected" : ""} ${correct ? "correct" : ""} ${wrong ? "wrong" : ""}`;
    button.innerHTML = `<b>${option.key}</b><span>${option.text}</span>`;
    button.disabled = examMode && Boolean(state.exam?.submitted);
    button.onclick = () => chooseAnswer(option.key);
    el("options").appendChild(button);
  }

  const panel = el("answerPanel");
  if (state.revealed) {
    panel.className = `answer-panel ${saved?.answer ? (saved.correct ? "correct" : "wrong") : ""}`;
    panel.innerHTML = `<strong>正确答案：${question.answer}</strong>${saved?.answer ? `<span>你的答案：${saved.answer} · ${saved.correct ? "答对了" : "答错了"}</span>` : ""}${question.explanation ? `<p>${question.explanation}</p>` : ""}`;
  } else {
    panel.className = "answer-panel hidden";
    panel.innerHTML = "";
  }

  const aiPanel = el("aiPanel");
  if (state.aiLoading) {
    aiPanel.className = "ai-panel";
    aiPanel.innerHTML = "<strong>AI 正在讲解...</strong>稍等一下，正在把这题拆开讲。";
  } else if (state.aiContent && state.aiQuestionId === question.id) {
    aiPanel.className = state.aiContent.startsWith("AI 接口失败") ? "ai-panel error" : "ai-panel";
    aiPanel.innerHTML = `<strong>AI 辅助讲解</strong><div class="ai-content">${renderMarkdown(state.aiContent)}</div>`;
  } else {
    aiPanel.className = "ai-panel hidden";
    aiPanel.innerHTML = "";
  }
}

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function inlineMarkdown(text) {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

function renderMarkdown(text) {
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let paragraph = [];
  let list = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push(`<p>${inlineMarkdown(paragraph.join(" "))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!list.length) return;
    blocks.push(`<ul>${list.map((item) => `<li>${inlineMarkdown(item)}</li>`).join("")}</ul>`);
    list = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }
    if (/^-{3,}$/.test(line)) {
      flushParagraph();
      flushList();
      blocks.push("<hr />");
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = Math.min(heading[1].length + 2, 5);
      blocks.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }
    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      list.push(bullet[1]);
      continue;
    }
    flushList();
    paragraph.push(line);
  }
  flushParagraph();
  flushList();
  return blocks.join("");
}

async function explainWithAi() {
  const question = activeQuestion();
  if (!question || state.aiLoading) return;
  state.aiLoading = true;
  state.aiContent = "";
  state.aiQuestionId = question.id;
  render();
  try {
    const response = await fetch("/api/ai/explain", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question: question.stem,
        options: question.options,
        answer: question.answer,
        chapter: question.chapter
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || `AI 接口失败：${response.status}`);
    state.aiContent = data.content || "AI 没有返回内容。";
  } catch (error) {
    state.aiContent = `AI 接口失败：${error.message}`;
  } finally {
    state.aiLoading = false;
    render();
  }
}

async function analyzeExam() {
  if (!state.exam || !state.exam.submitted || state.examAnalysisLoading) return;
  state.examAnalysisLoading = true;
  state.examAnalysis = "";
  render();
  try {
    const response = await fetch("/api/ai/exam-analysis", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(examAnalysisPayload())
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || `AI 分析失败：${response.status}`);
    state.examAnalysis = data.content || "AI 没有返回分析内容。";
  } catch (error) {
    state.examAnalysis = `AI 分析失败：${error.message}`;
  } finally {
    state.examAnalysisLoading = false;
    render();
  }
}

async function authRequest(path) {
  const username = el("usernameInput").value.trim();
  const password = el("passwordInput").value;
  if (!username || !password) {
    setAuthMessage("请输入用户名和密码。", "error");
    return;
  }
  setAuthMessage(path.includes("register") ? "正在注册..." : "正在登录...");
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || `请求失败：${response.status}`);
    applyLogin(data);
    setAuthMessage("已登录，进度会自动同步。", "success");
  } catch (error) {
    setAuthMessage(error.message, "error");
  }
}

function applyLogin(data) {
  state.token = data.token || state.token;
  state.user = data.user || state.user;
  localStorage.setItem("uavQuizToken", state.token);
  const remoteStats = data.stats || {};
  state.stats = mergeStats(state.stats, remoteStats);
  localStorage.setItem("uavQuizStats", JSON.stringify(state.stats));
  state.syncStatus = "已登录";
  renderAccount();
  syncProgress();
  setQuestion(state.index);
}

async function restoreSession() {
  if (!state.token) {
    renderAccount();
    return;
  }
  state.syncStatus = "恢复中";
  renderAccount();
  try {
    const response = await fetch("/api/auth/me", { headers: authHeaders() });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || "登录已过期");
    applyLogin(data);
  } catch {
    state.token = "";
    state.user = null;
    state.syncStatus = "未登录";
    localStorage.removeItem("uavQuizToken");
    renderAccount();
  }
}

async function logout() {
  if (state.token) {
    await fetch("/api/auth/logout", { method: "POST", headers: authHeaders() }).catch(() => {});
  }
  state.token = "";
  state.user = null;
  state.syncStatus = "未登录";
  localStorage.removeItem("uavQuizToken");
  setAuthMessage("已退出，当前设备仍保留本地进度。");
  renderAccount();
}

async function init() {
  const response = await fetch("./question-bank.json");
  state.bank = await response.json();
  renderAccount();
  restoreSession();
  const chapterSelect = el("chapterSelect");
  if (chapterSelect) {
    chapterSelect.onchange = (event) => {
      state.chapter = event.target.value;
      setQuestion(0);
    };
  }
  el("modeSelect").onchange = (event) => {
    state.mode = event.target.value;
    state.wrongBook = false;
    state.wrongChapter = ALL_CHAPTER;
    if (state.mode === "exam") startExam();
    else {
      state.exam = null;
      state.revealed = state.mode === "review";
      setQuestion(0);
    }
  };
  el("searchInput").oninput = (event) => {
    state.search = event.target.value;
    if (state.mode === "exam") startExam();
    else setQuestion(0);
  };
  el("prevBtn").onclick = () => setQuestion(state.index - 1);
  el("nextBtn").onclick = () => setQuestion(state.index + 1);
  el("showBtn").onclick = () => {
    state.revealed = true;
    render();
  };
  el("aiBtn").onclick = explainWithAi;
  el("loginBtn").onclick = () => authRequest("/api/auth/login");
  el("registerBtn").onclick = () => authRequest("/api/auth/register");
  el("syncBtn").onclick = () => syncProgress({ silent: false });
  el("logoutBtn").onclick = logout;
  el("enterStudyBtn").onclick = () => {
    state.studyFocus = true;
    document.body.classList.add("study-focus");
    window.scrollTo({ top: 0, behavior: "smooth" });
    render();
  };
  el("exitStudyBtn").onclick = () => {
    state.studyFocus = false;
    document.body.classList.remove("study-focus");
    window.scrollTo({ top: 0, behavior: "smooth" });
    render();
  };
  el("authForm").onsubmit = (event) => {
    event.preventDefault();
    authRequest("/api/auth/login");
  };
  el("randomBtn").onclick = () => {
    const list = filteredQuestions();
    if (!list.length) return;
    setQuestion(Math.floor(Math.random() * list.length));
  };
  el("wrongBtn").onclick = () => {
    const groups = wrongGroups();
    if (!groups.length) {
      setAuthMessage("当前还没有错题。");
      return;
    }
    state.mode = state.mode === "exam" ? "practice" : state.mode;
    el("modeSelect").value = state.mode;
    state.wrongBook = true;
    state.wrongChapter = ALL_CHAPTER;
    state.index = 0;
    state.selected = "";
    state.revealed = true;
    setQuestion(0);
  };
  el("resetBtn").onclick = () => {
    if (state.mode === "exam") {
      startExam();
      return;
    }
    state.stats = {};
    state.selected = "";
    state.revealed = state.mode === "review";
    state.wrongBook = false;
    state.wrongChapter = ALL_CHAPTER;
    saveStats();
    render();
  };
  render();
}

init().catch((error) => {
  el("questionStem").textContent = `题库加载失败：${error.message}`;
});
