import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BarChart3,
  BookOpen,
  Brain,
  Bookmark,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ClipboardList,
  Clock,
  EyeOff,
  Gauge,
  Globe2,
  Grid2X2,
  HelpCircle,
  Info,
  ListChecks,
  LayoutDashboard,
  Loader2,
  LogOut,
  Menu,
  Bell,
  FileText,
  RotateCcw,
  Search,
  Shuffle,
  Sparkles,
  Star,
  Target,
  Timer,
  UserRound,
  XCircle
} from "lucide-react";
import {
  ALL_CHAPTER,
  ChapterSummary,
  PracticeMode,
  ProgressState,
  Question,
  QuestionBank,
  QuestionFilter,
  User
} from "./types";
import {
  analyzeExam,
  explainQuestion,
  fetchQuestionBank,
  login,
  logout,
  me,
  register,
  saveRemoteProgress
} from "./services/apiClient";
import { buildDashboardStats } from "./services/analyticsService";
import { buildExamQuestions, createExamRecord, ExamConfig, ExamResult, gradeExam } from "./services/examEngine";
import { answerQuestion, getPracticeQuestions, toggleFavorite, toggleWeak } from "./services/practiceEngine";
import { createQuestionProgress, loadProgress, mergeProgress, migrateProgress, saveProgress, serializeForRemote } from "./services/progressStore";
import "./styles.css";

type Route = "practice" | "dashboard" | "exam" | "wrongbook" | "login";
type SyncState = "未登录" | "待同步" | "同步中" | "已同步" | "同步失败";
type ToastTone = "success" | "danger" | "info";
type PracticeToast = { id: number; tone: ToastTone; text: string } | null;
type AnswerNotice = { questionId: string; tone: ToastTone; text: string } | null;
type WrongbookPlanFilter = "全部计划" | "今日待复习" | "明日待复习" | "已完成";
type PracticeMetrics = {
  chapterLabel: string;
  chapterAnswered: number;
  chapterTotal: number;
  chapterAccuracy: number;
  totalAnswered: number;
  totalQuestions: number;
  totalAccuracy: number;
  todayCount: number;
  streak: number;
};
type ExamPhase = "setup" | "running" | "finished";
type ActiveExam = {
  config: ExamConfig;
  questions: Question[];
  answers: Record<string, string>;
  marked: Record<string, boolean>;
  index: number;
  startedAt: number;
  remainingSeconds: number;
  started: boolean;
  result: ExamResult | null;
};

const DEFAULT_EXAM_QUESTION_COUNT = 100;
const DEFAULT_EXAM_DURATION_MINUTES = 120;
const DEFAULT_EXAM_TARGET_ACCURACY = 80;
const EXAM_PASS_SCORE = 80;
const EXAM_UI_VERSION = "exam-workstation-20260627-02";

const modeLabels: Record<PracticeMode, string> = {
  sequence: "背题模式",
  random: "做题模式",
  wrong: "只练错题",
  favorite: "只练收藏",
  unanswered: "未答优先",
  frequentWrong: "高频错题"
};

const filterLabels: Record<QuestionFilter, string> = {
  all: "全部题目",
  answered: "已答",
  unanswered: "未答",
  wrong: "答错",
  favorite: "收藏",
  weak: "不熟"
};

function readRoute(): Route {
  if (window.location.pathname.includes("login")) return "login";
  if (window.location.pathname.includes("exam")) return "exam";
  if (window.location.pathname.includes("wrongbook")) return "wrongbook";
  return window.location.pathname.includes("dashboard") ? "dashboard" : "practice";
}

function routePath(route: Route) {
  return route === "dashboard" ? "/dashboard" : route === "exam" ? "/exam" : route === "wrongbook" ? "/wrongbook" : route === "login" ? "/login" : "/practice";
}

function readQuery() {
  const params = new URLSearchParams(window.location.search);
  return {
    chapter: params.get("chapter") || ALL_CHAPTER,
    mode: (params.get("mode") as PracticeMode) || "sequence",
    filter: (params.get("filter") as QuestionFilter) || "all",
    search: params.get("q") || ""
  };
}

function writeQuery(route: Route, state: { chapter: string; mode: PracticeMode; filter: QuestionFilter; search: string }) {
  if (route === "exam") {
    window.history.replaceState(null, "", "/exam");
    return;
  }
  if (route === "dashboard") {
    window.history.replaceState(null, "", "/dashboard");
    return;
  }
  if (route === "wrongbook") {
    window.history.replaceState(null, "", "/wrongbook");
    return;
  }
  if (route === "login") {
    window.history.replaceState(null, "", "/login");
    return;
  }
  const params = new URLSearchParams();
  if (state.chapter !== ALL_CHAPTER) params.set("chapter", state.chapter);
  if (state.mode !== "sequence") params.set("mode", state.mode);
  if (state.filter !== "all") params.set("filter", state.filter);
  if (state.search.trim()) params.set("q", state.search.trim());
  const url = `/practice${params.toString() ? `?${params}` : ""}`;
  window.history.replaceState(null, "", url);
}

function countTodayAnswers(progress: ProgressState, now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const end = start + 86400_000;
  return Object.values(progress.questions).reduce((count, item) => (
    count + item.answerHistory.filter((record) => record.answeredAt >= start && record.answeredAt < end).length
  ), 0);
}

function buildPracticeMetrics(bank: QuestionBank, progress: ProgressState, chapter: string, stats: ReturnType<typeof buildDashboardStats>, streak: number): PracticeMetrics {
  const scope = chapter === ALL_CHAPTER ? bank.questions : bank.questions.filter((question) => question.chapter === chapter);
  const answered = scope.filter((question) => progress.questions[question.id]?.attempts).length;
  const correct = scope.filter((question) => progress.questions[question.id]?.lastCorrect).length;
  return {
    chapterLabel: chapter === ALL_CHAPTER ? "全部章节" : chapter,
    chapterAnswered: answered,
    chapterTotal: scope.length,
    chapterAccuracy: answered ? Math.round((correct / answered) * 100) : 0,
    totalAnswered: stats.answered,
    totalQuestions: stats.total,
    totalAccuracy: stats.accuracy,
    todayCount: countTodayAnswers(progress),
    streak
  };
}

function startOfLocalDay(value = Date.now()) {
  const date = new Date(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function getWrongbookDueOffset(item: ProgressState["questions"][string], now = Date.now()) {
  const wrongWeight = Math.max(0, item.wrongCount || 0);
  const lastDay = startOfLocalDay(item.lastAnsweredAt || now);
  const today = startOfLocalDay(now);
  const daysSince = Math.floor((today - lastDay) / 86400_000);
  if (item.weak || wrongWeight >= 3 || daysSince >= 2 || item.lastCorrect === false) return 0;
  if (wrongWeight >= 2 || daysSince >= 1) return 1;
  return 2;
}

function tokenizeQuestion(text: string) {
  return Array.from(new Set(
    text
      .replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, " ")
      .split(/\s+/)
      .flatMap((part) => {
        if (!part) return [];
        if (/^[\u4e00-\u9fa5]+$/.test(part)) {
          return Array.from({ length: Math.max(0, part.length - 1) }, (_, index) => part.slice(index, index + 2));
        }
        return [part.toLowerCase()];
      })
      .filter((part) => part.length >= 2)
  ));
}

function getQuestionSimilarity(source: Question, target: Question) {
  const sourceTokens = tokenizeQuestion(`${source.chapter} ${source.stem} ${source.options.map((option) => option.text).join(" ")}`);
  const targetTokens = new Set(tokenizeQuestion(`${target.chapter} ${target.stem} ${target.options.map((option) => option.text).join(" ")}`));
  if (!sourceTokens.length || !targetTokens.size) return source.chapter === target.chapter ? 48 : 0;
  const overlap = sourceTokens.filter((token) => targetTokens.has(token)).length;
  const lexicalScore = Math.round((overlap / Math.max(sourceTokens.length, 1)) * 70);
  const chapterScore = source.chapter === target.chapter ? 22 : 0;
  const answerScore = source.answer === target.answer ? 6 : 0;
  return Math.min(98, lexicalScore + chapterScore + answerScore);
}

function createActiveExam(bank: QuestionBank, progress: ProgressState, config?: Partial<ExamConfig>, seed = Date.now()): ActiveExam {
  const nextConfig: ExamConfig = {
    questionCount: Math.min(config?.questionCount ?? DEFAULT_EXAM_QUESTION_COUNT, bank.total),
    durationMinutes: config?.durationMinutes ?? DEFAULT_EXAM_DURATION_MINUTES,
    targetAccuracy: Math.min(Math.max(config?.targetAccuracy ?? DEFAULT_EXAM_TARGET_ACCURACY, 1), 100),
    random: config?.random ?? true,
    chapterScope: config?.chapterScope?.length ? config.chapterScope : [ALL_CHAPTER]
  };
  return {
    config: nextConfig,
    questions: buildExamQuestions(bank.questions, nextConfig, `${seed}:${progress.examRecords.length}`),
    answers: {},
    marked: {},
    index: 0,
    startedAt: Date.now(),
    remainingSeconds: Math.max(60, nextConfig.durationMinutes * 60),
    started: true,
    result: null
  };
}

function App() {
  const initial = readQuery();
  const initialRoute = readRoute();
  const initialToken = localStorage.getItem("uavQuizToken") || "";
  const [route, setRoute] = useState<Route>(initialToken || initialRoute === "login" ? initialRoute : "login");
  const [returnRoute, setReturnRoute] = useState<Route>(initialRoute === "login" ? "practice" : initialRoute);
  const [bank, setBank] = useState<QuestionBank | null>(null);
  const [bankError, setBankError] = useState("");
  const [progress, setProgress] = useState<ProgressState>(() => loadProgress(window.localStorage));
  const [chapter, setChapter] = useState(initial.chapter);
  const [mode, setMode] = useState<PracticeMode>(initial.mode);
  const [filter, setFilter] = useState<QuestionFilter>(initial.filter);
  const [search, setSearch] = useState(initial.search);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState("");
  const [revealed, setRevealed] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [token, setToken] = useState(initialToken);
  const [user, setUser] = useState<User | null>(null);
  const [syncState, setSyncState] = useState<SyncState>(token ? "待同步" : "未登录");
  const [authChecked, setAuthChecked] = useState(!initialToken);
  const [authMessage, setAuthMessage] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiQuestionId, setAiQuestionId] = useState("");
  const [aiContent, setAiContent] = useState("");
  const [streak, setStreak] = useState(0);
  const [toast, setToast] = useState<PracticeToast>(null);
  const [answerNotice, setAnswerNotice] = useState<AnswerNotice>(null);
  const [exam, setExam] = useState<ActiveExam | null>(null);
  const [examAiLoading, setExamAiLoading] = useState(false);
  const [examAiContent, setExamAiContent] = useState("");
  const [wrongbookIndex, setWrongbookIndex] = useState(0);
  const [wrongbookSearch, setWrongbookSearch] = useState("");
  const [wrongbookChapter, setWrongbookChapter] = useState(ALL_CHAPTER);
  const [wrongbookDifficulty, setWrongbookDifficulty] = useState("全部难度");
  const [wrongbookStatus, setWrongbookStatus] = useState("全部状态");
  const [wrongbookSelected, setWrongbookSelected] = useState("");
  const [wrongbookAiLoading, setWrongbookAiLoading] = useState(false);
  const [wrongbookAiQuestionId, setWrongbookAiQuestionId] = useState("");
  const [wrongbookAiContent, setWrongbookAiContent] = useState("");
  const [wrongbookAiCollapsed, setWrongbookAiCollapsed] = useState(false);
  const [wrongbookExpanded, setWrongbookExpanded] = useState(false);
  const [wrongbookSimilarPage, setWrongbookSimilarPage] = useState(0);
  const [wrongbookPlanFilter, setWrongbookPlanFilter] = useState<WrongbookPlanFilter>("全部计划");

  useEffect(() => {
    fetchQuestionBank().then(setBank).catch((error) => setBankError(error.message));
  }, []);

  useEffect(() => {
    writeQuery(route, { chapter, mode, filter, search });
  }, [route, chapter, mode, filter, search]);

  useEffect(() => {
    saveProgress(window.localStorage, progress);
    if (!token) return;
    setSyncState("待同步");
    const timer = window.setTimeout(async () => {
      try {
        setSyncState("同步中");
        await saveRemoteProgress(token, serializeForRemote(progress));
        setSyncState("已同步");
      } catch {
        setSyncState("同步失败");
      }
    }, 700);
    return () => window.clearTimeout(timer);
  }, [progress, token]);

  useEffect(() => {
    if (!token) return;
    me(token).then((payload) => {
      setUser(payload.user);
      setProgress((current) => mergeProgress(current, payload.stats));
      setSyncState("已同步");
    }).catch(() => {
      localStorage.removeItem("uavQuizToken");
      setToken("");
      setUser(null);
      setSyncState("未登录");
      if (route !== "login") setReturnRoute(route);
      setRoute("login");
      window.history.replaceState(null, "", "/login");
    }).finally(() => {
      setAuthChecked(true);
    });
  }, []);

  const questions = useMemo(() => {
    if (!bank) return [];
    return getPracticeQuestions({ questions: bank.questions, progress, chapter, mode, filter, search, randomSeed: String(progress.examRecords.length) });
  }, [bank, progress, chapter, mode, filter, search]);

  const activeQuestion = questions[Math.min(index, Math.max(questions.length - 1, 0))] || null;
  const activeProgress = activeQuestion ? progress.questions[activeQuestion.id] : undefined;
  const stats = useMemo(() => bank ? buildDashboardStats(bank, progress) : null, [bank, progress]);
  const practiceMetrics = useMemo(() => bank && stats ? buildPracticeMetrics(bank, progress, chapter, stats, streak) : null, [bank, chapter, progress, stats, streak]);
  const wrongbookQuestions = useMemo(() => {
    if (!bank) return [];
    const now = Date.now();
    const keyword = wrongbookSearch.trim().toLowerCase();
    return bank.questions
      .filter((question) => Boolean(progress.questions[question.id]?.wrongCount))
      .filter((question) => wrongbookChapter === ALL_CHAPTER || question.chapter === wrongbookChapter)
      .filter((question) => {
        if (!keyword) return true;
        const options = question.options.map((option) => `${option.key} ${option.text}`).join(" ");
        return `${question.chapter} ${question.type} ${question.stem} ${options}`.toLowerCase().includes(keyword);
      })
      .filter((question) => {
        const item = progress.questions[question.id];
        if (wrongbookDifficulty === "高频错题") return (item?.wrongCount || 0) >= 2;
        if (wrongbookDifficulty === "普通错题") return (item?.wrongCount || 0) < 2;
        return true;
      })
      .filter((question) => {
        const item = progress.questions[question.id];
        if (wrongbookStatus === "已收藏") return Boolean(item?.favorite);
        if (wrongbookStatus === "复习计划") return Boolean(item?.weak);
        if (wrongbookStatus === "待复习") return !item?.lastCorrect || (item?.wrongCount || 0) > 0;
        return true;
      })
      .filter((question) => {
        const item = progress.questions[question.id];
        if (!item || wrongbookPlanFilter === "全部计划") return true;
        if (wrongbookPlanFilter === "已完成") {
          return item.lastCorrect === true && item.lastAnsweredAt >= startOfLocalDay(now);
        }
        const dueOffset = getWrongbookDueOffset(item, now);
        if (wrongbookPlanFilter === "今日待复习") return dueOffset <= 0;
        if (wrongbookPlanFilter === "明日待复习") return dueOffset === 1;
        return true;
      })
      .sort((a, b) => {
        const pa = progress.questions[a.id];
        const pb = progress.questions[b.id];
        return (pb?.wrongCount || 0) - (pa?.wrongCount || 0) || (pb?.lastAnsweredAt || 0) - (pa?.lastAnsweredAt || 0);
      });
  }, [bank, progress, wrongbookSearch, wrongbookChapter, wrongbookDifficulty, wrongbookStatus, wrongbookPlanFilter]);

  useEffect(() => {
    setIndex(0);
    setSelected("");
    setRevealed(mode !== "random" ? true : false);
  }, [chapter, mode, filter, search]);

  useEffect(() => {
    setWrongbookIndex(0);
    setWrongbookSelected("");
    setWrongbookAiContent("");
    setWrongbookAiQuestionId("");
    setWrongbookAiCollapsed(false);
    setWrongbookExpanded(false);
    setWrongbookSimilarPage(0);
  }, [wrongbookSearch, wrongbookChapter, wrongbookDifficulty, wrongbookStatus]);

  useEffect(() => {
    setWrongbookIndex((current) => Math.min(current, Math.max(wrongbookQuestions.length - 1, 0)));
  }, [wrongbookQuestions.length]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!exam || !exam.started || exam.result || exam.remainingSeconds <= 0) return;
    const timer = window.setInterval(() => {
      setExam((current) => {
        if (!current || !current.started || current.result) return current;
        const remainingSeconds = Math.max(0, current.remainingSeconds - 1);
        if (remainingSeconds > 0) return { ...current, remainingSeconds };
        const finished = finishExam(current, 0);
        setExamAiLoading(false);
        setExamAiContent("");
        return finished;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [exam?.started, exam?.result, exam?.remainingSeconds]);

  function navigate(nextRoute: Route) {
    const hasSession = Boolean(token || localStorage.getItem("uavQuizToken"));
    if (nextRoute !== "login" && !hasSession) {
      setReturnRoute(nextRoute);
      setRoute("login");
      window.history.pushState(null, "", "/login");
      return;
    }
    setRoute(nextRoute);
    window.history.pushState(null, "", routePath(nextRoute));
  }

  function updateProgress(next: ProgressState) {
    setProgress(next);
  }

  function finishExam(current: ActiveExam, remainingSeconds = current.remainingSeconds): ActiveExam {
    const result = gradeExam(current.questions, current.answers);
    const durationSeconds = Math.max(0, current.config.durationMinutes * 60 - remainingSeconds);
    const record = createExamRecord(result, current.config.chapterScope, durationSeconds);
    setProgress((previous) => ({
      ...previous,
      examRecords: [record, ...previous.examRecords.filter((item) => item.id !== record.id)].slice(0, 20)
    }));
    return { ...current, remainingSeconds, result };
  }

  async function generateExamAnalysis(targetExam = exam) {
    if (!targetExam?.result || examAiLoading) return;
    const result = targetExam.result;
    const chapterStats: Record<string, { total: number; wrong: number }> = {};
    for (const question of targetExam.questions) {
      const row = chapterStats[question.chapter] || { total: 0, wrong: 0 };
      row.total += 1;
      if (targetExam.answers[question.id] !== question.answer) row.wrong += 1;
      chapterStats[question.chapter] = row;
    }
    const wrongItems = targetExam.questions
      .filter((question) => result.wrongQuestionIds.includes(question.id))
      .slice(0, 20)
      .map((question) => ({
        chapter: question.chapter,
        question: question.stem,
        user_answer: targetExam.answers[question.id] || "未答",
        correct_answer: question.answer
      }));

    setExamAiLoading(true);
    setExamAiContent("");
    try {
      const payload = await analyzeExam({
        total: result.total,
        answered: Object.keys(targetExam.answers).filter((id) => targetExam.questions.some((question) => question.id === id)).length,
        correct: result.correct,
        pass_score: EXAM_PASS_SCORE,
        chapter_stats: chapterStats,
        wrong_items: wrongItems
      });
      setExamAiContent(payload.content || "AI 没有返回考试分析。");
    } catch (error) {
      setExamAiContent(error instanceof Error ? `AI 考试分析失败：${error.message}` : "AI 考试分析失败");
    } finally {
      setExamAiLoading(false);
    }
  }

  function startExam(config: ExamConfig) {
    if (!bank) return;
    setExamAiLoading(false);
    setExamAiContent("");
    setExam(createActiveExam(bank, progress, config));
  }

  useEffect(() => {
    if (route !== "exam" || exam) return;
    setExamAiLoading(false);
    setExamAiContent("");
  }, [route, exam]);

  function answerExamQuestion(questionId: string, answer: string) {
    setExam((current) => current ? { ...current, answers: { ...current.answers, [questionId]: answer } } : current);
  }

  function moveExamQuestion(nextIndex: number) {
    setExam((current) => current ? { ...current, index: Math.min(Math.max(nextIndex, 0), Math.max(current.questions.length - 1, 0)) } : current);
  }

  function toggleExamMark(questionId: string) {
    setExam((current) => current ? {
      ...current,
      marked: {
        ...current.marked,
        [questionId]: !current.marked[questionId]
      }
    } : current);
  }

  function submitExam() {
    let finished: ActiveExam | null = null;
    setExam((current) => {
      if (!current || current.result) return current;
      const unanswered = current.questions.length - Object.keys(current.answers).filter((id) => current.questions.some((question) => question.id === id)).length;
      if (unanswered > 0 && !window.confirm(`还有 ${unanswered} 道题未答，确定交卷吗？`)) return current;
      finished = finishExam(current);
      return finished;
    });
    if (finished) {
      setExamAiLoading(false);
      setExamAiContent("");
    }
  }

  function resetExam() {
    if (bank) {
      setExam(createActiveExam(bank, progress));
    } else {
      setExam(null);
    }
    setExamAiLoading(false);
    setExamAiContent("");
  }

  function chooseAnswer(answer: string) {
    if (!activeQuestion) return;
    const before = progress.questions[activeQuestion.id];
    const wasWrong = Boolean(before?.wrongCount);
    const isCorrect = answer === activeQuestion.answer;
    const nextProgress = answerQuestion(progress, activeQuestion, answer);
    const after = nextProgress.questions[activeQuestion.id];
    const nextStreak = isCorrect ? streak + 1 : 0;
    let nextNotice: AnswerNotice = null;

    setSelected(answer);
    setRevealed(true);
    setStreak(nextStreak);

    if (wasWrong && isCorrect && after.wrongCount === 0) {
      nextNotice = { questionId: activeQuestion.id, tone: "success", text: "错题已清除，掌握度回来了。" };
      setToast({ id: Date.now(), tone: "success", text: "错题已清除" });
    } else if (wasWrong && isCorrect) {
      nextNotice = { questionId: activeQuestion.id, tone: "success", text: "错题已巩固，再答对一次就能移出错题本。" };
      setToast({ id: Date.now(), tone: "success", text: "错题已巩固" });
    } else if (!isCorrect && after.wrongCount >= 2) {
      nextNotice = { questionId: activeQuestion.id, tone: "danger", text: "这题已进入高频错题，建议看解析后再重做。" };
      setToast({ id: Date.now(), tone: "danger", text: "已标记为高频错题" });
    } else if ([3, 5, 10].includes(nextStreak)) {
      setToast({ id: Date.now(), tone: "success", text: `连续答对 ${nextStreak} 题` });
    } else if (!isCorrect) {
      setToast({ id: Date.now(), tone: "danger", text: "答错了，正确答案已高亮" });
    }

    setAnswerNotice(nextNotice);
    updateProgress(nextProgress);
  }

  function updateSingleQuestionProgress(questionId: string, updater: (item: ProgressState["questions"][string]) => ProgressState["questions"][string]) {
    setProgress((current) => {
      const existing = current.questions[questionId] || createQuestionProgress();
      return {
        ...current,
        questions: {
          ...current.questions,
          [questionId]: updater(existing)
        }
      };
    });
  }

  function answerWrongbookQuestion(question: Question, answer: string) {
    setWrongbookSelected(answer);
    setProgress((current) => answerQuestion(current, question, answer));
    setToast({
      id: Date.now(),
      tone: answer === question.answer ? "success" : "danger",
      text: answer === question.answer ? "这道错题已巩固" : "正确答案已高亮，建议看解析"
    });
  }

  function clearWrongbookQuestion(questionId: string) {
    updateSingleQuestionProgress(questionId, (item) => ({
      ...item,
      wrongCount: 0,
      correctStreak: Math.max(item.correctStreak, progress.settings.wrongClearStreak),
      lastCorrect: true,
      lastAnsweredAt: Date.now()
    }));
    setWrongbookSelected("");
    setToast({ id: Date.now(), tone: "success", text: "已移出错题本" });
  }

  function markWrongbookMastered(questionId: string) {
    updateSingleQuestionProgress(questionId, (item) => ({
      ...item,
      wrongCount: 0,
      correctStreak: Math.max(item.correctStreak, progress.settings.wrongClearStreak),
      weak: false,
      lastCorrect: true,
      lastAnsweredAt: Date.now()
    }));
    setWrongbookSelected("");
    setToast({ id: Date.now(), tone: "success", text: "已标记掌握，并移出待复习" });
  }

  function moveWrongbook(delta: number) {
    setWrongbookIndex((current) => Math.min(Math.max(current + delta, 0), Math.max(wrongbookQuestions.length - 1, 0)));
    setWrongbookSelected("");
    setWrongbookAiContent("");
    setWrongbookAiQuestionId("");
    setWrongbookAiCollapsed(false);
    setWrongbookExpanded(false);
  }

  function jumpWrongbookQuestion(questionId: string) {
    const targetIndex = wrongbookQuestions.findIndex((question) => question.id === questionId);
    if (targetIndex < 0) return;
    setWrongbookIndex(targetIndex);
    setWrongbookSelected("");
    setWrongbookAiContent("");
    setWrongbookAiQuestionId("");
    setWrongbookAiCollapsed(false);
    setWrongbookExpanded(false);
  }

  function focusWrongbookChapter(nextChapter: string) {
    setWrongbookChapter(nextChapter);
    setWrongbookStatus("全部状态");
  }

  function practiceRelatedQuestion(question: Question) {
    setChapter(question.chapter);
    setMode("sequence");
    setFilter("all");
    setSearch(question.stem.slice(0, 10));
    navigate("practice");
  }

  function moveQuestion(delta: number) {
    const nextIndex = Math.min(Math.max(index + delta, 0), Math.max(questions.length - 1, 0));
    setIndex(nextIndex);
    const nextQuestion = questions[nextIndex];
    const nextProgress = nextQuestion ? progress.questions[nextQuestion.id] : undefined;
    setSelected(nextProgress?.lastAnswer || "");
    setRevealed(Boolean(nextProgress?.attempts) || mode === "sequence");
    setAiContent("");
    setAiQuestionId("");
    setAnswerNotice(null);
  }

  async function handleAuth(kind: "login" | "register"): Promise<boolean> {
    setAuthMessage(kind === "login" ? "正在登录..." : "正在注册...");
    try {
      const payload = kind === "login" ? await login(username.trim(), password) : await register(username.trim(), password);
      localStorage.setItem("uavQuizToken", payload.token);
      setToken(payload.token);
      setUser(payload.user);
      setProgress((current) => mergeProgress(current, payload.stats));
      setSyncState("已同步");
      setAuthMessage("已登录，学习进度会自动同步。");
      setPassword("");
      return true;
    } catch (error) {
      setAuthMessage(error instanceof Error ? error.message : "登录失败");
      return false;
    }
  }

  async function handleLogout() {
    if (token) await logout(token).catch(() => {});
    if (route !== "login") setReturnRoute(route);
    localStorage.removeItem("uavQuizToken");
    setToken("");
    setUser(null);
    setSyncState("未登录");
    setAuthMessage("已退出，当前设备仍保留本地进度。");
    setRoute("login");
    window.history.pushState(null, "", "/login");
  }

  async function handleAiExplain() {
    if (!activeQuestion || aiLoading) return;
    setAiLoading(true);
    setAiQuestionId(activeQuestion.id);
    setAiContent("");
    try {
      const result = await explainQuestion({
        question: activeQuestion.stem,
        options: activeQuestion.options,
        answer: activeQuestion.answer,
        chapter: activeQuestion.chapter
      });
      setAiContent(result.content || "AI 没有返回内容。");
    } catch (error) {
      setAiContent(error instanceof Error ? `AI 讲解失败：${error.message}` : "AI 讲解失败");
    } finally {
      setAiLoading(false);
    }
  }

  async function handleWrongbookAi(question: Question) {
    if (wrongbookAiLoading) return;
    setWrongbookAiLoading(true);
    setWrongbookAiQuestionId(question.id);
    setWrongbookAiContent("");
    setWrongbookAiCollapsed(false);
    try {
      const result = await explainQuestion({
        question: question.stem,
        options: question.options,
        answer: question.answer,
        chapter: question.chapter
      });
      setWrongbookAiContent(result.content || "AI 没有返回内容。");
    } catch (error) {
      setWrongbookAiContent(error instanceof Error ? `AI 讲解失败：${error.message}` : "AI 讲解失败");
    } finally {
      setWrongbookAiLoading(false);
    }
  }

  if (bankError) {
    return <StateScreen title="题库加载失败" text={bankError} />;
  }
  if (!bank || !stats) {
    return <StateScreen title="正在加载题库" text="正在准备章节、进度和学习面板..." loading />;
  }

  if (route === "login") {
    return (
      <LoginPage
        username={username}
        password={password}
        authMessage={authMessage}
        onUsername={setUsername}
        onPassword={setPassword}
        onAuth={async (kind) => {
          const ok = await handleAuth(kind);
          if (ok) navigate(returnRoute === "login" ? "practice" : returnRoute);
          return ok;
        }}
        onBack={() => navigate(returnRoute === "login" ? "practice" : returnRoute)}
      />
    );
  }

  if (!authChecked) {
    return <StateScreen loading title="正在验证登录状态" text="请稍候，正在恢复您的学习账号。" />;
  }

  return (
    <div className={`app-shell ${focusMode ? "focus-mode" : ""}`}>
      <AppHeader
        route={route}
        user={user}
        username={username}
        password={password}
        authMessage={authMessage}
        onNavigate={navigate}
        onUsername={setUsername}
        onPassword={setPassword}
        onAuth={handleAuth}
        onLogout={handleLogout}
      />
      <MobileTopBar route={route} onMenu={() => setDrawerOpen(true)} onFocus={() => setFocusMode(true)} onNavigate={navigate} />
      <div className={`workspace-shell ${route === "exam" ? `exam-shell ${exam?.result ? "exam-report-shell" : ""}` : route === "dashboard" ? "dashboard-shell" : route === "wrongbook" ? "wrongbook-shell" : ""}`}>
        {route === "practice" && (
          <aside className={`sidebar ${drawerOpen ? "open" : ""}`}>
            <div className="sidebar-account">
              <AccountCard
                user={user}
                syncState={syncState}
                username={username}
                password={password}
                authMessage={authMessage}
                onUsername={setUsername}
                onPassword={setPassword}
                onAuth={handleAuth}
                onLogout={handleLogout}
              />
            </div>
            <ProgressStats stats={stats} />
            <PracticeToolbar
              mode={mode}
              filter={filter}
              search={search}
              onMode={setMode}
              onFilter={setFilter}
              onSearch={setSearch}
            />
            <ChapterSidebar
              chapters={bank.chapters}
              total={bank.total}
              active={chapter}
              progress={progress}
              questions={bank.questions}
              onSelect={(next) => {
                setChapter(next);
                setDrawerOpen(false);
                navigate("practice");
              }}
            />
          </aside>
        )}
        <main className="main-area">
          {route === "exam" ? (
            <ExamPage
              bank={bank}
              exam={exam}
              progress={progress}
              onStart={startExam}
              onAnswer={answerExamQuestion}
              onJump={moveExamQuestion}
              onMark={toggleExamMark}
              onFavorite={(questionId) => updateProgress(toggleFavorite(progress, questionId))}
              onWeak={(questionId) => updateProgress(toggleWeak(progress, questionId))}
              onSubmit={submitExam}
              onReset={resetExam}
              aiLoading={examAiLoading}
              aiContent={examAiContent}
              onAiAnalysis={() => generateExamAnalysis()}
            />
          ) : route === "wrongbook" ? (
            <WrongbookPage
              bank={bank}
              stats={stats}
              progress={progress}
              questions={wrongbookQuestions}
              index={wrongbookIndex}
              search={wrongbookSearch}
              chapter={wrongbookChapter}
              difficulty={wrongbookDifficulty}
              status={wrongbookStatus}
              planFilter={wrongbookPlanFilter}
              selected={wrongbookSelected}
              expanded={wrongbookExpanded}
              similarPage={wrongbookSimilarPage}
              aiLoading={wrongbookAiLoading && wrongbookAiQuestionId === wrongbookQuestions[wrongbookIndex]?.id}
              aiContent={wrongbookAiQuestionId === wrongbookQuestions[wrongbookIndex]?.id ? wrongbookAiContent : ""}
              aiCollapsed={wrongbookAiCollapsed}
              toast={toast}
              onSearch={setWrongbookSearch}
              onChapter={setWrongbookChapter}
              onDifficulty={setWrongbookDifficulty}
              onStatus={setWrongbookStatus}
              onPlanFilter={setWrongbookPlanFilter}
              onAnswer={answerWrongbookQuestion}
              onPrev={() => moveWrongbook(-1)}
              onNext={() => moveWrongbook(1)}
              onJump={jumpWrongbookQuestion}
              onFocusChapter={focusWrongbookChapter}
              onPracticeQuestion={practiceRelatedQuestion}
              onFavorite={(questionId) => updateProgress(toggleFavorite(progress, questionId))}
              onWeak={(questionId) => updateProgress(toggleWeak(progress, questionId))}
              onAi={handleWrongbookAi}
              onAiCollapsed={setWrongbookAiCollapsed}
              onClear={clearWrongbookQuestion}
              onMastered={markWrongbookMastered}
              onExpanded={setWrongbookExpanded}
              onSimilarPage={() => setWrongbookSimilarPage((current) => current + 1)}
              onPractice={() => navigate("practice")}
            />
          ) : route === "dashboard" ? (
            <DashboardPage bank={bank} stats={stats} progress={progress} onPractice={() => navigate("practice")} onExam={() => navigate("exam")} />
          ) : (
            <PracticePage
              bank={bank}
              questions={questions}
              question={activeQuestion}
              questionProgress={activeProgress}
              index={index}
              selected={selected || activeProgress?.lastAnswer || ""}
              revealed={revealed || Boolean(activeProgress?.attempts)}
              aiLoading={aiLoading && aiQuestionId === activeQuestion?.id}
              aiContent={aiQuestionId === activeQuestion?.id ? aiContent : ""}
              modeLabel={modeLabels[mode]}
              mode={mode}
              filter={filter}
              search={search}
              metrics={practiceMetrics}
              toast={toast}
              answerNotice={answerNotice?.questionId === activeQuestion?.id ? answerNotice : null}
              onAnswer={chooseAnswer}
              onPrev={() => moveQuestion(-1)}
              onNext={() => moveQuestion(1)}
              onReveal={() => setRevealed(true)}
              onFavorite={() => activeQuestion && updateProgress(toggleFavorite(progress, activeQuestion.id))}
              onWeak={() => activeQuestion && updateProgress(toggleWeak(progress, activeQuestion.id))}
              onAi={handleAiExplain}
              onExitFocus={() => setFocusMode(false)}
            />
          )}
        </main>
      </div>
      {route === "practice" && drawerOpen && <button className="drawer-backdrop" aria-label="关闭菜单" onClick={() => setDrawerOpen(false)} />}
    </div>
  );
}

function StateScreen({ title, text, loading = false }: { title: string; text: string; loading?: boolean }) {
  return (
    <div className="state-screen">
      {loading ? <Loader2 className="spin" /> : <XCircle />}
      <h1>{title}</h1>
      <p>{text}</p>
    </div>
  );
}

function LoginPage(props: {
  username: string;
  password: string;
  authMessage: string;
  onUsername: (value: string) => void;
  onPassword: (value: string) => void;
  onAuth: (kind: "login" | "register") => boolean | Promise<boolean> | void | Promise<void>;
  onBack: () => void;
}) {
  const [tab, setTab] = useState<"login" | "register">("login");
  const [remember, setRemember] = useState(true);
  const [agreed, setAgreed] = useState(true);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!agreed) return;
    props.onAuth(tab);
  }

  return (
    <main className="login-page">
      <header className="login-topbar">
        <button className="login-brand" type="button" onClick={props.onBack}>
          <img src="/assets/enterprise-icon-full-transparent.png" alt="" />
          <span><strong>进取号</strong><small>CAAC 理论题库</small></span>
        </button>
        <div className="login-top-actions">
          <button type="button"><Globe2 size={18} />简体中文 <ChevronDown size={14} /></button>
          <i />
          <button type="button"><HelpCircle size={18} />帮助中心</button>
        </div>
      </header>

      <section className="login-hero">
        <div className="login-marketing">
          <p className="login-eyebrow">进取号</p>
          <h1>CAAC 理论题库</h1>
          <h2>航空理论考试学习平台<br />智能刷题训练</h2>
          <p className="login-subtitle">高效刷题、模拟考试、学习数据追踪</p>
          <div className="login-feature-row">
            <span><Target size={24} /><b>精准题库</b><small>权威题库实时更新</small></span>
            <span><BarChart3 size={24} /><b>智能训练</b><small>个性化学习推荐</small></span>
            <span><CheckCircle2 size={24} /><b>数据追踪</b><small>学习进度全掌握</small></span>
          </div>
          <img className="login-drone login-drone-center-v2" src="/assets/login-hero-drone-center.png" alt="" />
        </div>

        <form className="login-card" onSubmit={submit}>
          <div className="login-card-head">
            <h2>欢迎登录</h2>
            <p>登录您的账号，继续学习之旅</p>
          </div>
          <div className="login-tabs">
            <button type="button" className={tab === "login" ? "active" : ""} onClick={() => setTab("login")}>账号登录</button>
            <button type="button" className={tab === "register" ? "active" : ""} onClick={() => setTab("register")}>账号注册</button>
          </div>
          <label className="login-input">
            <UserRound size={20} />
            <input value={props.username} onChange={(event) => props.onUsername(event.target.value)} placeholder="手机号 / 用户名" autoComplete="username" />
          </label>
          <label className="login-input">
            <LockIcon />
            <input value={props.password} onChange={(event) => props.onPassword(event.target.value)} placeholder="密码" type="password" autoComplete={tab === "login" ? "current-password" : "new-password"} />
            <EyeOff size={18} />
          </label>
          <div className="login-options">
            <label><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />记住登录</label>
            <button type="button">忘记密码?</button>
          </div>
          <button className="login-primary" type="submit" disabled={!agreed}>{tab === "login" ? "立即登录" : "立即注册"}</button>
          <div className="login-divider"><span>其他登录方式</span></div>
          <div className="login-socials">
            <button type="button" disabled>微信登录</button>
            <button type="button" disabled>QQ 登录</button>
            <button type="button" disabled>手机一键登录</button>
          </div>
          <label className="login-agreement">
            <input type="checkbox" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} />
            <span>我已阅读并同意 <a>用户协议</a> 和 <a>隐私政策</a></span>
          </label>
          {props.authMessage && <p className="login-message">{props.authMessage}</p>}
        </form>
      </section>
    </main>
  );
}

function CelebrationOverlay() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const canvasNode = canvasRef.current;
    const context2d = canvasNode?.getContext("2d");
    if (!canvasNode || !context2d) return undefined;
    const canvas: HTMLCanvasElement = canvasNode;
    const context: CanvasRenderingContext2D = context2d;

    const colors = ["#52B788", "#4CAF50", "#4F7CF7", "#9B6BFF", "#FF6FAE", "#F2C94C", "#F2994A"];
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const mobile = window.innerWidth < 720;
    const duration = reducedMotion ? 2600 : 5600;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rockets: Array<{ x: number; y: number; tx: number; ty: number; vx: number; vy: number; color: string; exploded: boolean; age: number; trail: Array<{ x: number; y: number; a: number }> }> = [];
    const particles: Array<{ x: number; y: number; vx: number; vy: number; size: number; color: string; alpha: number; decay: number; gravity: number; spin: number; angle: number; shape: number }> = [];
    const confetti: Array<{ x: number; y: number; vx: number; vy: number; size: number; color: string; alpha: number; spin: number; angle: number; shape: number; sway: number; phase: number }> = [];
    const bursts = reducedMotion ? 0 : mobile ? 5 : 8;
    const confettiCount = reducedMotion ? 48 : mobile ? 110 : 185;
    let animationId = 0;
    let lastRocketAt = -999;
    let launched = 0;
    let start = performance.now();

    function resize() {
      canvas.width = Math.floor(window.innerWidth * dpr);
      canvas.height = Math.floor(window.innerHeight * dpr);
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function random(min: number, max: number) {
      return min + Math.random() * (max - min);
    }

    function pickColor(index = Math.floor(Math.random() * colors.length)) {
      return colors[index % colors.length];
    }

    function launchRocket(now: number) {
      const side = Math.random();
      const x = side < 0.32 ? random(0, window.innerWidth * 0.18) : side > 0.68 ? random(window.innerWidth * 0.82, window.innerWidth) : random(window.innerWidth * 0.25, window.innerWidth * 0.75);
      const y = window.innerHeight + random(20, 80);
      const tx = random(window.innerWidth * 0.14, window.innerWidth * 0.88);
      const ty = random(window.innerHeight * 0.12, window.innerHeight * 0.58);
      rockets.push({
        x,
        y,
        tx,
        ty,
        vx: (tx - x) / random(45, 62),
        vy: (ty - y) / random(45, 62),
        color: pickColor(launched),
        exploded: false,
        age: now,
        trail: []
      });
      launched += 1;
    }

    function explode(x: number, y: number, color: string) {
      const count = mobile ? Math.floor(random(34, 54)) : Math.floor(random(48, 82));
      for (let index = 0; index < count; index += 1) {
        const angle = (Math.PI * 2 * index) / count + random(-0.11, 0.11);
        const speed = random(1.7, mobile ? 5.1 : 6.8);
        particles.push({
          x,
          y,
          vx: Math.cos(angle) * speed + random(-0.32, 0.32),
          vy: Math.sin(angle) * speed + random(-0.72, 0.18),
          size: random(1.6, 4.4),
          color: Math.random() > 0.34 ? color : pickColor(),
          alpha: 1,
          decay: random(0.011, 0.022),
          gravity: random(0.035, 0.07),
          spin: random(-0.18, 0.18),
          angle: random(0, Math.PI * 2),
          shape: Math.floor(random(0, 4))
        });
      }
    }

    function seedConfetti() {
      for (let index = 0; index < confettiCount; index += 1) {
        confetti.push({
          x: random(-40, window.innerWidth + 40),
          y: random(-window.innerHeight * 0.85, window.innerHeight * 0.12),
          vx: random(-0.55, 0.55),
          vy: random(0.9, reducedMotion ? 1.8 : 3.3),
          size: random(4, 10),
          color: pickColor(index),
          alpha: random(0.48, 0.88),
          spin: random(-0.16, 0.16),
          angle: random(0, Math.PI * 2),
          shape: Math.floor(random(0, 4)),
          sway: random(0.35, 1.6),
          phase: random(0, Math.PI * 2)
        });
      }
    }

    function drawStar(x: number, y: number, size: number) {
      context.beginPath();
      for (let index = 0; index < 10; index += 1) {
        const radius = index % 2 === 0 ? size : size * 0.45;
        const angle = -Math.PI / 2 + (index * Math.PI) / 5;
        const px = x + Math.cos(angle) * radius;
        const py = y + Math.sin(angle) * radius;
        if (index === 0) context.moveTo(px, py);
        else context.lineTo(px, py);
      }
      context.closePath();
      context.fill();
    }

    function drawShape(shape: number, size: number) {
      if (shape === 1) {
        context.beginPath();
        context.arc(0, 0, size * 0.55, 0, Math.PI * 2);
        context.fill();
        return;
      }
      if (shape === 2) {
        drawStar(0, 0, size * 0.72);
        return;
      }
      if (shape === 3) {
        context.beginPath();
        context.moveTo(-size, -size * 0.25);
        context.bezierCurveTo(-size * 0.25, -size * 0.85, size * 0.25, size * 0.85, size, size * 0.25);
        context.lineTo(size * 0.72, size * 0.68);
        context.bezierCurveTo(size * 0.05, size * 0.08, -size * 0.45, -size * 0.68, -size, -size * 0.25);
        context.fill();
        return;
      }
      context.fillRect(-size * 0.45, -size * 0.85, size * 0.9, size * 1.7);
    }

    function frame(now: number) {
      const elapsed = now - start;
      const fade = elapsed > duration - 900 ? Math.max(0, (duration - elapsed) / 900) : 1;
      context.clearRect(0, 0, window.innerWidth, window.innerHeight);

      if (!reducedMotion && launched < bursts && now - lastRocketAt > random(360, 680)) {
        launchRocket(now);
        lastRocketAt = now;
      }

      if (!reducedMotion) {
        for (let index = rockets.length - 1; index >= 0; index -= 1) {
          const rocket = rockets[index];
          rocket.trail.unshift({ x: rocket.x, y: rocket.y, a: 0.45 });
          rocket.trail = rocket.trail.slice(0, 9);
          rocket.x += rocket.vx;
          rocket.y += rocket.vy;
          rocket.vx *= 0.986;
          rocket.vy *= 0.986;
          const distance = Math.hypot(rocket.tx - rocket.x, rocket.ty - rocket.y);
          context.save();
          context.strokeStyle = rocket.color;
          context.lineWidth = 2;
          rocket.trail.forEach((point, trailIndex) => {
            context.globalAlpha = point.a * (1 - trailIndex / rocket.trail.length) * fade;
            context.beginPath();
            context.arc(point.x, point.y, Math.max(1, 3 - trailIndex * 0.22), 0, Math.PI * 2);
            context.stroke();
          });
          context.restore();
          if (distance < 18 || now - rocket.age > 1300) {
            explode(rocket.x, rocket.y, rocket.color);
            rockets.splice(index, 1);
          }
        }
      }

      confetti.forEach((item) => {
        item.phase += 0.025;
        item.angle += item.spin;
        item.x += item.vx + Math.sin(item.phase) * item.sway * 0.32;
        item.y += item.vy;
        if (item.y > window.innerHeight + 40 && elapsed < duration - 1400) {
          item.y = random(-160, -20);
          item.x = random(-40, window.innerWidth + 40);
        }
        context.save();
        context.globalAlpha = item.alpha * fade;
        context.fillStyle = item.color;
        context.translate(item.x, item.y);
        context.rotate(item.angle);
        drawShape(item.shape, item.size);
        context.restore();
      });

      for (let index = particles.length - 1; index >= 0; index -= 1) {
        const item = particles[index];
        item.x += item.vx;
        item.y += item.vy;
        item.vx *= 0.985;
        item.vy = item.vy * 0.985 + item.gravity;
        item.angle += item.spin;
        item.alpha -= item.decay;
        item.size *= 0.993;
        if (item.alpha <= 0.02 || item.size <= 0.6) {
          particles.splice(index, 1);
          continue;
        }
        context.save();
        context.globalAlpha = item.alpha * fade;
        context.fillStyle = item.color;
        context.shadowColor = item.color;
        context.shadowBlur = 9;
        context.translate(item.x, item.y);
        context.rotate(item.angle);
        drawShape(item.shape, item.size);
        context.restore();
      }

      if (elapsed < duration) {
        animationId = window.requestAnimationFrame(frame);
      } else {
        context.clearRect(0, 0, window.innerWidth, window.innerHeight);
        setVisible(false);
      }
    }

    resize();
    seedConfetti();
    start = performance.now();
    animationId = window.requestAnimationFrame(frame);
    window.addEventListener("resize", resize);

    return () => {
      window.cancelAnimationFrame(animationId);
      window.removeEventListener("resize", resize);
    };
  }, []);

  if (!visible) return null;
  return (
    <div className="celebration-overlay" aria-hidden="true">
      <canvas ref={canvasRef} className="celebration-canvas" />
    </div>
  );
}

function LockIcon() {
  return <span className="login-lock-icon" aria-hidden="true" />;
}

function Brand() {
  return (
    <div className="brand">
      <img src="/assets/enterprise-icon.png" alt="" />
      <div>
        <strong>进取号</strong>
        <span>CAAC 理论题库</span>
      </div>
    </div>
  );
}

function AppHeader(props: {
  route: Route;
  user: User | null;
  username: string;
  password: string;
  authMessage: string;
  onNavigate: (route: Route) => void;
  onUsername: (value: string) => void;
  onPassword: (value: string) => void;
  onAuth: (kind: "login" | "register") => void;
  onLogout: () => void;
}) {
  const [accountOpen, setAccountOpen] = useState(false);

  function submitAuth(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    props.onAuth("login");
  }

  return (
    <header className="app-header">
      <div className="header-brand">
        <Brand />
        <div className="header-copy">
          <span>航空理论考试学习平台</span>
          <strong>{props.route === "dashboard" ? "学习总览" : props.route === "wrongbook" ? "错题强化训练" : "智能刷题训练"}</strong>
        </div>
      </div>
      <nav className="header-nav" aria-label="主导航">
        <button className={props.route === "practice" ? "nav-btn active" : "nav-btn"} onClick={() => props.onNavigate("practice")}><BookOpen size={16} />练习</button>
        <button className={props.route === "exam" ? "nav-btn active" : "nav-btn"} onClick={() => props.onNavigate("exam")}><Timer size={16} />模拟考试</button>
        <button className={props.route === "wrongbook" ? "nav-btn active" : "nav-btn"} onClick={() => props.onNavigate("wrongbook")}><ClipboardList size={16} />错题本</button>
        <button className={props.route === "dashboard" ? "nav-btn active" : "nav-btn"} onClick={() => props.onNavigate("dashboard")}><Grid2X2 size={16} />学习总览</button>
      </nav>
      <div className="header-account">
        <button
          className={`header-user ${accountOpen ? "open" : ""}`}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={accountOpen}
          onClick={() => props.user ? setAccountOpen((open) => !open) : props.onNavigate("login")}
        >
          <span className="avatar-ring"><UserRound size={21} /></span>
          <strong>{props.user?.username || "用户登录"}</strong>
          <ChevronDown size={14} />
        </button>
        {accountOpen && (
          <div className="header-auth-popover" role="dialog" aria-label="用户登录">
            {props.user ? (
              <>
                <div className="header-auth-profile">
                  <span className="avatar-ring"><UserRound size={20} /></span>
                  <div>
                    <strong>{props.user.username}</strong>
                    <small>学习进度已绑定账号</small>
                  </div>
                </div>
                <button className="ghost header-auth-logout" onClick={props.onLogout}><LogOut size={16} />退出登录</button>
              </>
            ) : (
              <form className="header-auth-form" onSubmit={submitAuth}>
                <strong>用户登录</strong>
                <input value={props.username} onChange={(e) => props.onUsername(e.target.value)} placeholder="用户名" autoComplete="username" />
                <input value={props.password} onChange={(e) => props.onPassword(e.target.value)} placeholder="密码" type="password" autoComplete="current-password" />
                <div className="header-auth-actions">
                  <button type="submit">登录</button>
                  <button type="button" className="ghost" onClick={() => props.onAuth("register")}>注册</button>
                </div>
              </form>
            )}
            {props.authMessage && <p className="header-auth-message">{props.authMessage}</p>}
          </div>
        )}
      </div>
    </header>
  );
}

function ActivityLine() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 12h4l2-6 4 12 2-6h6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MobileTopBar({ route, onMenu, onFocus, onNavigate }: { route: Route; onMenu: () => void; onFocus: () => void; onNavigate: (route: Route) => void }) {
  return (
    <header className="mobile-topbar">
      <button className="icon-btn" onClick={onMenu} aria-label="打开菜单"><Menu size={20} /></button>
      <strong>{route === "dashboard" ? "学习总览" : route === "exam" ? "模拟考试" : route === "wrongbook" ? "错题本" : "刷题练习"}</strong>
      <button onClick={route === "practice" ? onFocus : () => onNavigate("practice")}>{route === "practice" ? "专注" : "刷题"}</button>
    </header>
  );
}

function AccountCard(props: {
  user: User | null;
  syncState: SyncState;
  username: string;
  password: string;
  authMessage: string;
  onUsername: (value: string) => void;
  onPassword: (value: string) => void;
  onAuth: (kind: "login" | "register") => void;
  onLogout: () => void;
}) {
  return (
    <section className="sidebar-card account-panel">
      <div className="section-title"><UserRound size={16} /><span>账号同步</span></div>
      <div className="account-status">
        <span>{props.user ? props.user.username : "本机练习"}</span>
        <b>{props.syncState}</b>
      </div>
      {props.user ? (
        <button className="ghost" onClick={props.onLogout}><LogOut size={16} />退出登录</button>
      ) : (
        <div className="auth-grid">
          <input value={props.username} onChange={(e) => props.onUsername(e.target.value)} placeholder="用户名" autoComplete="username" />
          <input value={props.password} onChange={(e) => props.onPassword(e.target.value)} placeholder="密码" type="password" autoComplete="current-password" />
          <button onClick={() => props.onAuth("login")}>登录</button>
          <button className="ghost" onClick={() => props.onAuth("register")}>注册</button>
        </div>
      )}
      {props.authMessage && <p className="tiny-message">{props.authMessage}</p>}
    </section>
  );
}

function ProgressStats({ stats }: { stats: ReturnType<typeof buildDashboardStats> }) {
  return (
    <section className="sidebar-card stats-panel">
      <div className="section-title"><Gauge size={16} /><span>学习概览</span></div>
      <div className="stats-grid">
      <Stat label="总题量" value={stats.total} icon="doc" />
      <Stat label="已练" value={stats.answered} icon="check" />
      <Stat label="正确率" value={`${stats.accuracy}%`} icon="chart" />
      <Stat label="错题" value={stats.wrong} tone="danger" icon="tools" />
      <Stat label="收藏" value={stats.favorites} icon="star" />
      <Stat label="不熟" value={stats.weak} icon="clock" />
      </div>
    </section>
  );
}

function Stat({ label, value, tone = "", icon = "doc" }: { label: string; value: string | number; tone?: string; icon?: string }) {
  return <div className={`stat-card ${tone}`}><img src={`/assets/ui-icons/${icon}.png`} alt="" /><b>{value}</b><span>{label}</span></div>;
}

function PracticeToolbar(props: {
  mode: PracticeMode;
  filter: QuestionFilter;
  search: string;
  onMode: (value: PracticeMode) => void;
  onFilter: (value: QuestionFilter) => void;
  onSearch: (value: string) => void;
}) {
  return (
    <section className="sidebar-card toolbar-panel">
      <div className="section-title"><Shuffle size={16} /><span>训练控制</span></div>
      <label>
        <span>搜索题目</span>
        <div className="search-input"><Search size={16} /><input value={props.search} onChange={(e) => props.onSearch(e.target.value)} placeholder="题干 / 选项 / 章节" /></div>
      </label>
      <label>
        <span>练习模式</span>
        <select value={props.mode} onChange={(e) => props.onMode(e.target.value as PracticeMode)}>
          {Object.entries(modeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label>
        <span>筛选</span>
        <select value={props.filter} onChange={(e) => props.onFilter(e.target.value as QuestionFilter)}>
          {Object.entries(filterLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
    </section>
  );
}

function ChapterSidebar(props: {
  chapters: ChapterSummary[];
  total: number;
  active: string;
  progress: ProgressState;
  questions: Question[];
  onSelect: (chapter: string) => void;
}) {
  const rows = [{ name: ALL_CHAPTER, count: props.total }, ...props.chapters];
  return (
    <section className="sidebar-card chapter-panel">
      <div className="section-title"><BookOpen size={16} /><span>章节题库</span></div>
      <div className="chapter-list">
        {rows.map((chapter) => {
          const chapterQuestions = chapter.name === ALL_CHAPTER ? props.questions : props.questions.filter((q) => q.chapter === chapter.name);
          const answered = chapterQuestions.filter((q) => props.progress.questions[q.id]?.attempts).length;
          const percent = chapter.count ? Math.round((answered / chapter.count) * 100) : 0;
          return (
            <button key={chapter.name} className={props.active === chapter.name ? "active" : ""} onClick={() => props.onSelect(chapter.name)}>
              <span>{chapter.name}</span>
              <b>{answered}/{chapter.count}</b>
              <i style={{ width: `${percent}%` }} />
            </button>
          );
        })}
      </div>
    </section>
  );
}

function PracticePage(props: {
  bank: QuestionBank;
  questions: Question[];
  question: Question | null;
  questionProgress: ProgressState["questions"][string] | undefined;
  index: number;
  selected: string;
  revealed: boolean;
  aiLoading: boolean;
  aiContent: string;
  modeLabel: string;
  mode: PracticeMode;
  filter: QuestionFilter;
  search: string;
  metrics: PracticeMetrics | null;
  toast: PracticeToast;
  answerNotice: AnswerNotice;
  onAnswer: (answer: string) => void;
  onPrev: () => void;
  onNext: () => void;
  onReveal: () => void;
  onFavorite: () => void;
  onWeak: () => void;
  onAi: () => void;
  onExitFocus: () => void;
}) {
  if (!props.question) {
    if (props.search.trim()) {
      return <EmptyCard title="没有搜索结果" text="换个关键词，或清空搜索后从章节题库继续练习。" />;
    }
    if (props.mode === "wrong" || props.filter === "wrong") {
      return <EmptyCard title="暂无错题" text="当前错题已经清空，继续刷题保持手感。" />;
    }
    if (props.mode === "favorite" || props.filter === "favorite") {
      return <EmptyCard title="暂无收藏题" text="遇到容易混淆的题，可以点收藏，后面集中复习。" />;
    }
    return <EmptyCard title="没有匹配题目" text="换一个章节、练习模式或筛选条件再试试。" />;
  }
  const answerState = props.revealed && props.selected ? (props.selected === props.question.answer ? "answered-correct" : "answered-wrong") : "";
  const wrongCount = props.questionProgress?.wrongCount || 0;
  return (
    <section className="practice-layout">
      {props.toast && <div key={props.toast.id} className={`practice-toast ${props.toast.tone}`}>{props.toast.text}</div>}
      <header className="hero-panel practice-hero">
        <div>
          <p>{props.bank.subtitle} · {props.bank.generatedAt} · {props.modeLabel}</p>
          <h1>{props.bank.title}</h1>
          <div className="hero-progress">
            <span style={{ width: `${Math.round(((props.index + 1) / Math.max(props.questions.length, 1)) * 100)}%` }} />
          </div>
        </div>
        <div className="hero-watermark" aria-hidden="true"><img src="/assets/caac-hero-drone-fpv.png" alt="" /></div>
        <div className="hero-status">
          <span>当前进度</span>
          <strong>{props.index + 1}<small> / {props.questions.length}</small></strong>
          <button className="ghost focus-exit" onClick={props.onExitFocus}>返回主页</button>
        </div>
      </header>
      {props.metrics && <PracticeMetricsBar metrics={props.metrics} current={props.index + 1} total={props.questions.length} />}
      <article className={`question-card ${answerState}`}>
        <div className="question-topline">
          <span>{props.index + 1} / {props.questions.length}</span>
          <span>{props.question.chapter}</span>
          <span>{props.question.type || "单选"}</span>
          {wrongCount >= 2 && <span className="danger-chip">高频错题 · {wrongCount}</span>}
        </div>
        <div className="question-actions-inline">
          <button className={props.questionProgress?.favorite ? "chip active" : "chip"} onClick={props.onFavorite}><Star size={16} />收藏</button>
          <button className={props.questionProgress?.weak ? "chip active" : "chip"} onClick={props.onWeak}><Brain size={16} />不熟</button>
          <span className="history-chip">已答 {props.questionProgress?.attempts || 0} · 错 {props.questionProgress?.wrongCount || 0}</span>
        </div>
        <h2>{props.question.stem}</h2>
        <div className="options">
          {props.question.options.map((option) => (
            <AnswerOption
              key={option.key}
              option={option}
              selected={props.selected === option.key}
              correct={props.revealed && option.key === props.question?.answer}
              wrong={props.revealed && props.selected === option.key && option.key !== props.question?.answer}
              onClick={() => props.onAnswer(option.key)}
            />
          ))}
        </div>
        <FeedbackPanel question={props.question} selected={props.selected} revealed={props.revealed} progress={props.questionProgress} notice={props.answerNotice} onAi={props.onAi} aiLoading={props.aiLoading} />
        {props.aiLoading || props.aiContent ? (
          <div className="ai-panel">
            <strong>{props.aiLoading ? "AI 正在讲解..." : "AI 讲解"}</strong>
            {props.aiLoading ? <div className="ai-content">稍等一下，正在把考点拆开讲。</div> : <MarkdownContent text={props.aiContent} />}
          </div>
        ) : null}
        <div className="question-nav-row" aria-label="题目切换">
          <button className="ghost question-nav-btn" onClick={props.onPrev} disabled={props.index <= 0}>
            <ChevronLeft size={17} />上一题
          </button>
          <span>{props.index + 1} / {props.questions.length}</span>
          <button className="next-action question-nav-btn" onClick={props.onNext} disabled={props.index >= props.questions.length - 1}>
            下一题<ChevronRight size={17} />
          </button>
        </div>
      </article>
    </section>
  );
}

function PracticeMetricsBar({ metrics, current, total }: { metrics: PracticeMetrics; current: number; total: number }) {
  const groupPercent = total ? Math.round((current / total) * 100) : 0;
  const chapterPercent = metrics.chapterTotal ? Math.round((metrics.chapterAnswered / metrics.chapterTotal) * 100) : 0;
  return (
    <section className="practice-metrics" aria-label="练习进度">
      <div className="metric-card wide">
        <img className="metric-icon" src="/assets/ui-icons/layers.png" alt="" />
        <span>{metrics.chapterLabel}</span>
        <strong>{metrics.chapterAnswered}/{metrics.chapterTotal}</strong>
        <small>章节进度 · 正确率 {metrics.chapterAccuracy}%</small>
        <i><b style={{ width: `${chapterPercent}%` }} /></i>
      </div>
      <div className="metric-card">
        <img className="metric-icon" src="/assets/ui-icons/list.png" alt="" />
        <span>当前题组</span>
        <strong>{current}/{total}</strong>
        <small>{groupPercent}%</small>
      </div>
      <div className="metric-card">
        <img className="metric-icon" src="/assets/ui-icons/pie.png" alt="" />
        <span>总进度</span>
        <strong>{metrics.totalAnswered}/{metrics.totalQuestions}</strong>
        <small>正确率 {metrics.totalAccuracy}%</small>
      </div>
      <div className="metric-card accent">
        <img className="metric-icon" src="/assets/ui-icons/calendar.png" alt="" />
        <span>今日已刷</span>
        <strong>{metrics.todayCount}</strong>
        <small>保持节奏</small>
      </div>
      <div className="metric-card streak">
        <img className="metric-icon" src="/assets/ui-icons/target.png" alt="" />
        <span>连续答对</span>
        <strong>{metrics.streak}</strong>
        <small>{metrics.streak >= 3 ? "手感在线" : "连对 3 题有提示"}</small>
      </div>
    </section>
  );
}

function AnswerOption(props: {
  option: { key: string; text: string };
  selected: boolean;
  correct: boolean;
  wrong: boolean;
  onClick: () => void;
}) {
  return (
    <button className={`option-btn ${props.selected ? "selected" : ""} ${props.correct ? "correct" : ""} ${props.wrong ? "wrong" : ""}`} onClick={props.onClick}>
      <b>{props.option.key}</b>
      <span>{props.option.text}</span>
    </button>
  );
}

function FeedbackPanel({ question, selected, revealed, progress, notice, onAi, aiLoading }: { question: Question; selected: string; revealed: boolean; progress?: ProgressState["questions"][string]; notice: AnswerNotice; onAi: () => void; aiLoading: boolean }) {
  if (!revealed) return null;
  const correct = selected ? selected === question.answer : progress?.lastCorrect;
  return (
    <div className={`feedback-panel ${selected ? (correct ? "correct" : "wrong") : ""}`}>
      <div className="feedback-copy">
        <strong><CheckCircle2 size={18} /> 正确答案：{question.answer}</strong>
        {selected && <span>你的答案：{selected} · {correct ? "答对了" : "答错了"}</span>}
        {notice && <em className={`answer-notice ${notice.tone}`}>{notice.text}</em>}
        {question.explanation ? <p>{question.explanation}</p> : <p>暂无题库解析，可以点击 AI 讲解补充理解。</p>}
      </div>
      <button className="feedback-ai-button" onClick={onAi} disabled={aiLoading}><Sparkles size={17} />AI 讲解</button>
    </div>
  );
}

function WrongbookPage(props: {
  bank: QuestionBank;
  stats: ReturnType<typeof buildDashboardStats>;
  progress: ProgressState;
  questions: Question[];
  index: number;
  search: string;
  chapter: string;
  difficulty: string;
  status: string;
  planFilter: WrongbookPlanFilter;
  selected: string;
  expanded: boolean;
  similarPage: number;
  aiLoading: boolean;
  aiContent: string;
  aiCollapsed: boolean;
  toast: PracticeToast;
  onSearch: (value: string) => void;
  onChapter: (value: string) => void;
  onDifficulty: (value: string) => void;
  onStatus: (value: string) => void;
  onPlanFilter: (value: WrongbookPlanFilter) => void;
  onAnswer: (question: Question, answer: string) => void;
  onPrev: () => void;
  onNext: () => void;
  onJump: (questionId: string) => void;
  onFocusChapter: (chapter: string) => void;
  onPracticeQuestion: (question: Question) => void;
  onFavorite: (questionId: string) => void;
  onWeak: (questionId: string) => void;
  onAi: (question: Question) => void;
  onAiCollapsed: (value: boolean) => void;
  onClear: (questionId: string) => void;
  onMastered: (questionId: string) => void;
  onExpanded: (value: boolean) => void;
  onSimilarPage: () => void;
  onPractice: () => void;
}) {
  const question = props.questions[Math.min(props.index, Math.max(props.questions.length - 1, 0))] || null;
  const questionProgress = question ? props.progress.questions[question.id] : undefined;
  const selected = props.selected || questionProgress?.lastAnswer || "";
  const showAnswer = Boolean(questionProgress?.attempts || props.selected);
  const wrongQuestions = props.bank.questions.filter((item) => props.progress.questions[item.id]?.wrongCount);
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const weekStart = todayStart - 6 * 86400_000;
  const weeklyReviews = Object.values(props.progress.questions).reduce((sum, item) => (
    sum + item.answerHistory.filter((record) => record.answeredAt >= weekStart && record.answeredAt < todayStart + 86400_000).length
  ), 0);
  const fixedCount = Object.values(props.progress.questions).filter((item) => item.wrongCount === 0 && item.attempts > 0 && item.lastCorrect).length;
  const pinnedCount = Object.values(props.progress.questions).filter((item) => item.favorite).length;
  const weakCount = Object.values(props.progress.questions).filter((item) => item.weak).length;
  const chapterWrongRows = props.stats.chapterMastery
    .map((chapter) => {
      const chapterQuestions = props.bank.questions.filter((item) => item.chapter === chapter.chapter);
      const wrong = chapterQuestions.filter((item) => props.progress.questions[item.id]?.wrongCount).length;
      return { chapter: chapter.chapter, wrong, total: chapterQuestions.length };
    })
    .filter((item) => item.wrong > 0)
    .sort((a, b) => b.wrong - a.wrong)
    .slice(0, 5);
  const correctionRate = props.stats.answered ? Math.round((fixedCount / Math.max(props.stats.answered, 1)) * 1000) / 10 : 0;
  const totalAttempts = Object.values(props.progress.questions).reduce((sum, item) => sum + item.attempts, 0);
  const weakKnowledge = props.bank.chapters
    .map((chapter) => {
      const chapterQuestions = props.bank.questions.filter((item) => item.chapter === chapter.name);
      const answered = chapterQuestions.filter((item) => props.progress.questions[item.id]?.attempts).length;
      const wrong = chapterQuestions.filter((item) => props.progress.questions[item.id]?.wrongCount).length;
      const weak = chapterQuestions.filter((item) => props.progress.questions[item.id]?.weak).length;
      const wrongAttempts = chapterQuestions.reduce((sum, item) => sum + (props.progress.questions[item.id]?.wrongCount || 0), 0);
      const rate = answered || wrong || weak
        ? Math.min(96, Math.round(((wrongAttempts + weak) / Math.max(answered + weak, 1)) * 100))
        : 0;
      const firstQuestion = chapterQuestions.find((item) => props.progress.questions[item.id]?.wrongCount) || chapterQuestions[0];
      return { chapter: chapter.name, total: chapter.count, answered, wrong, weak, rate, question: firstQuestion };
    })
    .filter((item) => item.wrong > 0 || item.weak > 0)
    .sort((a, b) => b.rate - a.rate || b.wrong - a.wrong || b.weak - a.weak)
    .slice(0, 5);
  const similarPool = question ? props.bank.questions
    .map((item) => {
      const similarity = item.id === question.id ? 0 : getQuestionSimilarity(question, item);
      return { question: item, similarity };
    })
    .filter((item) => item.similarity >= 42)
    .sort((a, b) => b.similarity - a.similarity)
    .map((item) => item.question) : [];
  const similarStart = similarPool.length ? (props.similarPage * 3) % similarPool.length : 0;
  const similarQuestions = similarPool.length ? [...similarPool, ...similarPool].slice(similarStart, similarStart + 3) : [];
  const correctionRecords = props.bank.questions
    .filter((item) => {
      const row = props.progress.questions[item.id];
      return row?.lastCorrect === true && row.lastAnsweredAt;
    })
    .sort((a, b) => (props.progress.questions[b.id]?.lastAnsweredAt || 0) - (props.progress.questions[a.id]?.lastAnsweredAt || 0))
    .slice(0, 3);
  const planned = Object.values(props.progress.questions).filter((item) => item.weak && item.wrongCount > 0).length;
  const totalWrong = wrongQuestions.length;
  const progressPercent = totalWrong ? Math.round((fixedCount / Math.max(totalWrong + fixedCount, 1)) * 100) : 100;
  const todayCompleted = wrongQuestions.filter((item) => {
    const row = props.progress.questions[item.id];
    return row?.lastCorrect === true && row.lastAnsweredAt >= todayStart;
  });
  const scheduledWrongQuestions = wrongQuestions.map((item, index) => {
    const row = props.progress.questions[item.id];
    const dueOffset = row ? getWrongbookDueOffset(row, todayStart) : index % 3;
    return { question: item, progress: row, dueOffset };
  });
  const dueTodayQuestions = scheduledWrongQuestions
    .filter((item) => item.dueOffset <= 0)
    .sort((a, b) => {
      const pa = a.progress;
      const pb = b.progress;
      return Number(Boolean(pb?.weak)) - Number(Boolean(pa?.weak)) || (pb?.wrongCount || 0) - (pa?.wrongCount || 0);
    })
    .map((item) => item.question);
  const tomorrowQuestions = scheduledWrongQuestions.filter((item) => item.dueOffset === 1).map((item) => item.question);
  const planDays = Array.from({ length: 14 }, (_, index) => {
    const date = new Date(todayStart + index * 86400_000);
    const dueCount = scheduledWrongQuestions.filter((item) => Math.max(0, item.dueOffset) === index).length;
    const completedCount = index === 0 ? todayCompleted.length : 0;
    return {
      key: date.toISOString().slice(0, 10),
      day: date.getDate(),
      weekday: "日一二三四五六"[date.getDay()],
      dueCount,
      completedCount,
      filter: index === 0 ? "今日待复习" as WrongbookPlanFilter : index === 1 ? "明日待复习" as WrongbookPlanFilter : "全部计划" as WrongbookPlanFilter
    };
  });
  const analysisText = question?.explanation || "暂无题库解析，可以点击 AI 讲解补充理解。";
  const compactAnalysis = analysisText.length > 96 && !props.expanded ? `${analysisText.slice(0, 96)}...` : analysisText;

  return (
    <section className="wrongbook-page">
      {props.toast && <div key={props.toast.id} className={`practice-toast ${props.toast.tone}`}>{props.toast.text}</div>}
      <aside className="wrongbook-left">
        <section className="wrongbook-card wrongbook-overview">
          <div className="section-title"><ClipboardList size={16} /><span>错题概览</span></div>
          <div className="wrongbook-stat-grid">
            <WrongbookStat label="累计错题" value={totalWrong} unit="题" />
            <WrongbookStat label="已订正" value={fixedCount} unit="题" />
            <WrongbookStat label="待复习" value={planned || totalWrong} unit="题" tone="warning" />
            <WrongbookStat label="易错知识点" value={weakKnowledge.length || weakCount} unit="个" />
            <WrongbookStat label="本周复习" value={weeklyReviews} unit="题" />
            <WrongbookStat label="纠错率" value={`${correctionRate}%`} tone="success" />
          </div>
        </section>

        <section className="wrongbook-card wrongbook-filter">
          <div className="section-title"><Search size={16} /><span>筛选条件</span></div>
          <label>
            <div className="search-input"><Search size={16} /><input value={props.search} onChange={(event) => props.onSearch(event.target.value)} placeholder="搜索题目、知识点关键词" /></div>
          </label>
          <div className="wrongbook-filter-grid">
            <label><span>章节范围</span><select value={props.chapter} onChange={(event) => props.onChapter(event.target.value)}><option value={ALL_CHAPTER}>全部章节</option>{props.bank.chapters.map((chapter) => <option key={chapter.name} value={chapter.name}>{chapter.name}</option>)}</select></label>
            <label><span>题型</span><select disabled><option>全部题型</option></select></label>
            <label><span>难度</span><select value={props.difficulty} onChange={(event) => props.onDifficulty(event.target.value)}><option>全部难度</option><option>高频错题</option><option>普通错题</option></select></label>
            <label><span>错题状态</span><select value={props.status} onChange={(event) => props.onStatus(event.target.value)}><option>全部状态</option><option>待复习</option><option>已收藏</option><option>复习计划</option></select></label>
          </div>
          <label className="wrongbook-toggle"><span>只看待复习</span><input type="checkbox" checked={props.status === "待复习"} onChange={(event) => props.onStatus(event.target.checked ? "待复习" : "全部状态")} /></label>
        </section>

        <section className="wrongbook-card chapter-weak-card">
          <div className="section-title"><Gauge size={16} /><span>章节错题分布</span></div>
          {chapterWrongRows.length ? chapterWrongRows.map((item) => (
            <button className="chapter-weak-row" key={item.chapter} onClick={() => props.onFocusChapter(item.chapter)}>
              <span>{item.chapter}</span>
              <i><b style={{ width: `${Math.min(100, Math.round((item.wrong / Math.max(item.total, 1)) * 100))}%` }} /></i>
              <em>{item.wrong} / {item.total}</em>
            </button>
          )) : <p className="soft-note">暂无错题分布，继续练习后自动生成。</p>}
          <button className="wrongbook-link-btn" onClick={() => props.onChapter(ALL_CHAPTER)}>查看全部章节 <ChevronRight size={14} /></button>
        </section>
      </aside>

      <main className="wrongbook-main">
        <section className="wrongbook-hero">
          <div>
            <h1>错题本</h1>
            <p>查漏补缺 · 针对性复习 · AI 辅助解析</p>
            <div className="wrongbook-hero-metrics">
              <button type="button" onClick={() => props.onStatus("\u5f85\u590d\u4e60")}>
                <CheckCircle2 size={22} />
                <span className="wrongbook-metric-copy"><em>{"\u4eca\u65e5\u5f85\u590d\u4e60"}</em><strong><b>{dueTodayQuestions.length}</b><i>{"\u9898"}</i></strong></span>
              </button>
              <span>
                <Timer size={22} />
                <span className="wrongbook-metric-copy"><em>{"\u8fde\u7eed\u8ba2\u6b63"}</em><strong><b>{Math.max(1, questionProgress?.correctStreak || 0)}</b><i>{"\u5929"}</i></strong></span>
              </span>
              <button type="button" onClick={() => props.onDifficulty("\u9ad8\u9891\u9519\u9898")}>
                <Star size={22} />
                <span className="wrongbook-metric-copy"><em>{"\u63a8\u8350\u4f18\u5148\u590d\u4e60"}</em><strong><b>{weakKnowledge.length || 0}</b><i>{"\u9898"}</i></strong></span>
              </button>
            </div>
            <div className="wrongbook-total-progress"><span>总体订正进度</span><b>{progressPercent}%</b><i><em style={{ width: `${progressPercent}%` }} /></i><small>累计节省学习时间 <strong>{Math.round(totalAttempts * 1.2) / 10}</strong> 小时</small></div>
          </div>
          <img src="/assets/wrongbook-hero-drone.png" alt="" />
        </section>

        {!question ? (
          <EmptyCard title="当前没有匹配错题" text="可以调整筛选条件，或者继续练习生成新的错题复习任务。" />
        ) : (
          <article className="wrongbook-question-card">
            <div className="wrongbook-question-head">
              <div>
                <strong>第 {props.index + 1} 题</strong>
                <span>单选题</span>
                <em>{question.chapter}</em>
              </div>
              <div>
                <span>难度：中等</span>
              <button className={questionProgress?.favorite ? "mini-pill active" : "mini-pill"} onClick={() => props.onFavorite(question.id)}><Star size={14} />{questionProgress?.favorite ? "已收藏" : "收藏"}</button>
              </div>
            </div>
            <h2>{question.stem}</h2>
            <div className="wrongbook-options">
              {question.options.map((option) => {
                const isCorrect = option.key === question.answer;
                const isWrongChoice = showAnswer && selected === option.key && option.key !== question.answer;
                return (
                  <button key={option.key} className={`${isCorrect && showAnswer ? "correct" : ""} ${isWrongChoice ? "wrong" : ""}`} onClick={() => props.onAnswer(question, option.key)}>
                    <b>{option.key}</b>
                    <span>{option.text}</span>
                    {isCorrect && showAnswer && <em><CheckCircle2 size={16} />正确答案</em>}
                    {isWrongChoice && <em className="wrong"><XCircle size={16} />你的答案</em>}
                  </button>
                );
              })}
            </div>
            <div className="wrongbook-analysis">
              <div className="wrongbook-answer-meta">
                <span>正确答案：<b>{question.answer}</b></span>
                <span>你的答案：<b className={selected === question.answer ? "green" : "red"}>{selected || questionProgress?.lastAnswer || "未作答"}</b></span>
                <span>错因标签：<em>概念混淆</em></span>
              </div>
              <p>解析：{compactAnalysis}</p>
              <button className="wrongbook-expand" onClick={() => props.onExpanded(!props.expanded)}>
                {props.expanded ? "收起解析" : "展开完整解析"} <ChevronDown size={14} />
              </button>
              <div className="wrongbook-actions-panel">
                <button className={questionProgress?.favorite ? "active" : ""} onClick={() => props.onFavorite(question.id)}><Star size={18} />{questionProgress?.favorite ? "取消收藏" : "收藏"}</button>
                <button className={questionProgress?.weak ? "active" : ""} onClick={() => props.onWeak(question.id)}><Brain size={18} />{questionProgress?.weak ? "取消标记" : "标记"}</button>
                <button className={questionProgress?.weak ? "active" : ""} onClick={() => props.onWeak(question.id)}><ClipboardList size={18} />{questionProgress?.weak ? "移出计划" : "加入复习计划"}</button>
                <button className="ai" onClick={() => props.onAi(question)} disabled={props.aiLoading}><Sparkles size={18} />AI 讲解</button>
              </div>
            </div>
            {(props.aiLoading || props.aiContent) && (
              <div className={`wrongbook-ai-panel ${props.aiCollapsed ? "collapsed" : ""}`}>
                <div className="wrongbook-ai-panel-head">
                  <strong>{props.aiLoading ? "AI 正在解析这道错题..." : "AI 辅助解析"}</strong>
                  {props.aiContent && !props.aiLoading && (
                    <button type="button" onClick={() => props.onAiCollapsed(!props.aiCollapsed)}>
                      {props.aiCollapsed ? "\u5c55\u5f00" : "\u6536\u8d77"} <ChevronDown size={14} />
                    </button>
                  )}
                </div>
                {!props.aiCollapsed && (
                  props.aiLoading ? <p>正在结合题干、选项和正确答案拆解易错点。</p> : <MarkdownContent text={props.aiContent} />
                )}
              </div>
            )}
            <div className="wrongbook-footer-actions">
              <button className="ghost" onClick={props.onPrev} disabled={props.index === 0}><ChevronLeft size={16} />上一题</button>
              <button className="ghost" onClick={() => props.onMastered(question.id)}><CheckCircle2 size={16} />掌握了</button>
              <button className="next" onClick={props.onNext} disabled={props.index >= props.questions.length - 1}>继续复习 <ChevronRight size={16} /></button>
              <button className="danger" onClick={() => props.onClear(question.id)}><XCircle size={16} />移出错题本</button>
            </div>
          </article>
        )}
      </main>

      <aside className="wrongbook-right">
        <section className="wrongbook-card review-plan-card">
          <div className="section-title"><ClipboardList size={16} /><span>复习计划</span><button onClick={() => props.onStatus("复习计划")}>查看全部 <ChevronRight size={13} /></button></div>
          <div className="review-plan-counts">
            <button className={props.planFilter === "今日待复习" ? "active" : ""} onClick={() => props.onPlanFilter("今日待复习")}>
              <span>今日待复习</span>
              <strong><b>{dueTodayQuestions.length}</b><em>题</em></strong>
            </button>
            <button className={props.planFilter === "明日待复习" ? "active" : ""} onClick={() => props.onPlanFilter("明日待复习")}>
              <span>明日待复习</span>
              <strong><b>{tomorrowQuestions.length}</b><em>题</em></strong>
            </button>
          </div>
          <div className="review-plan-summary">
            <button className={props.planFilter === "全部计划" ? "active" : ""} onClick={() => props.onPlanFilter("全部计划")}>全部计划 {scheduledWrongQuestions.length}</button>
            <button className={props.planFilter === "已完成" ? "active" : ""} onClick={() => props.onPlanFilter("已完成")}>今日完成 {todayCompleted.length}</button>
          </div>
          <div className="calendar-mini">
            {planDays.slice(0, 7).map((day) => <span key={day.weekday}>{day.weekday}</span>)}
            {planDays.map((day, idx) => (
              <button
                key={day.key}
                className={`${idx === 0 ? "today" : ""} ${day.dueCount ? "planned" : ""} ${day.completedCount ? "done" : ""}`}
                onClick={() => props.onPlanFilter(day.filter)}
                title={`${day.key} 待复习 ${day.dueCount} 题，已完成 ${day.completedCount} 题`}
              >
                {day.day}
                {(day.dueCount > 0 || day.completedCount > 0) && <em>{day.dueCount || day.completedCount}</em>}
              </button>
            ))}
          </div>
          <div className="calendar-legend"><span><i />待复习</span><span><i />已完成</span></div>
        </section>

        <section className="wrongbook-card similar-card">
          <div className="section-title"><Target size={16} /><span>相似题推荐</span><button onClick={props.onSimilarPage}>换一批 <ChevronRight size={13} /></button></div>
          {(similarQuestions.length ? similarQuestions : props.bank.questions.slice(0, 3)).map((item, idx) => (
            <button className="similar-row" key={item.id} onClick={() => props.onPracticeQuestion(item)}>
              <b>{idx + 1}</b>
              <span>{item.stem}</span>
              <em><small>相似度</small><strong>{question ? getQuestionSimilarity(question, item) : Math.max(72, 86 - idx * 5)}%</strong></em>
            </button>
          ))}
        </section>

        <section className="wrongbook-card weak-top-card">
          <div className="section-title"><BarChart3 size={16} /><span>薄弱知识点 Top 5</span><button onClick={() => props.onDifficulty("高频错题")}>查看全部 <ChevronRight size={13} /></button></div>
          {(weakKnowledge.length ? weakKnowledge : props.bank.chapters.slice(0, 5).map((chapter, idx) => ({ chapter: chapter.name, total: chapter.count, answered: 0, wrong: 0, weak: 0, rate: Math.max(0, 72 - idx * 6), question: props.bank.questions.find((item) => item.chapter === chapter.name) || props.bank.questions[0] }))).map((item, idx) => (
            <button className="weak-top-row" key={item.chapter} onClick={() => props.onFocusChapter(item.chapter)}>
              <b>{idx + 1}</b>
              <span><strong>{item.chapter}</strong><small>{item.wrong} 错 · {item.weak} 计划</small><i><em style={{ width: `${item.rate}%` }} /></i></span>
              <strong>{item.rate}%</strong>
            </button>
          ))}
        </section>

        <section className="wrongbook-card correction-card">
          <div className="section-title"><CheckCircle2 size={16} /><span>最近订正记录</span><button onClick={() => props.onStatus("全部状态")}>查看全部 <ChevronRight size={13} /></button></div>
          {correctionRecords.length ? correctionRecords.map((item) => (
            <button className="correction-row" key={item.id} onClick={() => props.questions.some((question) => question.id === item.id) ? props.onJump(item.id) : props.onPracticeQuestion(item)}>
              <CheckCircle2 size={17} />
              <span>第 {item.sourceNumber || item.id.slice(-3)} 题</span>
              <b>{item.stem}</b>
              <em>{new Date(props.progress.questions[item.id]?.lastAnsweredAt || Date.now()).toLocaleDateString()}</em>
            </button>
          )) : <p className="soft-note">订正错题后，这里会展示最近记录。</p>}
        </section>
      </aside>
    </section>
  );
}

function WrongbookStat({ label, value, unit = "", tone = "" }: { label: string; value: string | number; unit?: string; tone?: string }) {
  return (
    <div className={`wrongbook-stat ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {unit && <em>{unit}</em>}
    </div>
  );
}

function formatDuration(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  const minute = Math.floor(safe / 60);
  const second = safe % 60;
  return `${minute}:${String(second).padStart(2, "0")}`;
}

function ExamPage(props: {
  bank: QuestionBank;
  exam: ActiveExam | null;
  progress: ProgressState;
  onStart: (config: ExamConfig) => void;
  onAnswer: (questionId: string, answer: string) => void;
  onJump: (index: number) => void;
  onMark: (questionId: string) => void;
  onFavorite: (questionId: string) => void;
  onWeak: (questionId: string) => void;
  onSubmit: () => void;
  onReset: () => void;
  aiLoading: boolean;
  aiContent: string;
  onAiAnalysis: () => void;
}) {
  const [questionCount, setQuestionCount] = useState(DEFAULT_EXAM_QUESTION_COUNT);
  const [durationMinutes, setDurationMinutes] = useState(120);
  const [targetAccuracy, setTargetAccuracy] = useState(DEFAULT_EXAM_TARGET_ACCURACY);
  const [random, setRandom] = useState(true);
  const [chapterScope, setChapterScope] = useState<string[]>([ALL_CHAPTER]);
  const [onlyUnanswered, setOnlyUnanswered] = useState(false);
  const [answerPanelCollapsed, setAnswerPanelCollapsed] = useState(false);
  const phase: ExamPhase = !props.exam ? "setup" : props.exam.result ? "finished" : "running";

  function toggleChapter(name: string) {
    setChapterScope((current) => {
      if (name === ALL_CHAPTER) return [ALL_CHAPTER];
      const base = current.includes(ALL_CHAPTER) ? [] : current;
      const next = base.includes(name) ? base.filter((item) => item !== name) : [...base, name];
      return next.length ? next : [ALL_CHAPTER];
    });
  }

  function start() {
    props.onStart({
      questionCount,
      durationMinutes,
      targetAccuracy,
      random,
      chapterScope
    });
  }

  useEffect(() => {
    if (!props.exam) return;
    setQuestionCount(props.exam.config.questionCount);
    setDurationMinutes(props.exam.config.durationMinutes);
    setTargetAccuracy(props.exam.config.targetAccuracy);
    setRandom(props.exam.config.random);
    setChapterScope(props.exam.config.chapterScope);
  }, [props.exam?.startedAt]);

  if (phase === "setup") {
    const setupExamPreview: ActiveExam = {
      config: { questionCount, durationMinutes, targetAccuracy, random, chapterScope },
      questions: props.bank.questions.slice(0, Math.min(questionCount, props.bank.questions.length)),
      answers: {},
      marked: {},
      index: 0,
      startedAt: Date.now(),
      remainingSeconds: durationMinutes * 60,
      started: false,
      result: null
    };
    const previewQuestion = setupExamPreview.questions[0];
    const setupChapterRows = props.bank.chapters.map((chapter) => ({
      name: chapter.name,
      total: chapterScope.includes(ALL_CHAPTER) || chapterScope.includes(chapter.name) ? Math.min(chapter.count, questionCount) : 0,
      count: chapter.count
    })).filter((chapter) => chapter.total > 0).slice(0, 5);
    return (
      <section className="exam-page exam-running exam-full-layout exam-setup-layout" data-ui-version={EXAM_UI_VERSION}>
        <aside className="exam-left-rail">
          <section className="exam-side-card">
            <div className="section-title"><CheckCircle2 size={16} /><span>考试概览</span></div>
            <div className="exam-overview-grid">
              <div><b>{questionCount}</b><span>总题数</span></div>
              <div><b>0</b><span>已答题</span></div>
              <div><b>{questionCount}</b><span>未答题</span></div>
              <div><b>0</b><span>已标记</span></div>
            </div>
            <div className="exam-target-row">
              <span>目标正确率</span><strong>≥ {targetAccuracy}%</strong>
              <span>预计用时</span><strong>{durationMinutes} 分钟</strong>
            </div>
          </section>

          <section className="exam-side-card">
            <div className="section-title"><Shuffle size={16} /><span>考试控制</span></div>
            <label>
              <span>快速跳题</span>
              <div className="search-input"><Search size={16} /><input disabled placeholder="开始考试后可跳转" /></div>
            </label>
            <label>
              <span>考试模式</span>
              <select value={random ? "模拟考试（计时）" : "顺序考试（计时）"} onChange={(event) => setRandom(event.target.value.includes("模拟"))}>
                <option>模拟考试（计时）</option>
                <option>顺序考试（计时）</option>
              </select>
            </label>
            <div className="exam-control-grid">
              <label>
                <span>考试题量</span>
                <input type="number" min={5} max={props.bank.total} value={questionCount} onChange={(event) => setQuestionCount(Number(event.target.value || 1))} />
              </label>
              <label>
                <span>考试时间</span>
                <input type="number" min={1} max={240} value={durationMinutes} onChange={(event) => setDurationMinutes(Number(event.target.value || 1))} />
              </label>
              <label>
                <span>目标正确率</span>
                <input type="number" min={1} max={100} value={targetAccuracy} onChange={(event) => setTargetAccuracy(Number(event.target.value || 1))} />
              </label>
            </div>
            <label>
              <span>章节范围</span>
              <select value={chapterScope.includes(ALL_CHAPTER) ? ALL_CHAPTER : chapterScope[0]} onChange={(event) => setChapterScope(event.target.value === ALL_CHAPTER ? [ALL_CHAPTER] : [event.target.value])}>
                <option value={ALL_CHAPTER}>全部章节</option>
                {props.bank.chapters.map((chapter) => <option key={chapter.name} value={chapter.name}>{chapter.name}</option>)}
              </select>
            </label>
            <label className="exam-check-row">
              <input type="checkbox" checked={onlyUnanswered} onChange={(event) => setOnlyUnanswered(event.target.checked)} />
              <span>仅看未答</span>
            </label>
            <button className="next-action exam-start-inline" onClick={start}><Timer size={17} />开始考试</button>
          </section>

          <section className="exam-side-card">
            <div className="section-title"><ClipboardList size={16} /><span>题目章节</span></div>
            <div className="exam-chapter-mini">
              <button className="active"><span>全部题目</span><b>0/{questionCount}</b><i style={{ width: "0%" }} /></button>
              {setupChapterRows.map((row) => (
                <button key={row.name} onClick={() => setChapterScope([row.name])}><span>{row.name}</span><b>0/{row.total}</b><i style={{ width: "0%" }} /></button>
              ))}
            </div>
          </section>
        </aside>

        <ExamRunningHero bank={props.bank} exam={setupExamPreview} answeredCount={0} progressPercent={0} />

        <main className="exam-main-column">
          <article className="exam-question-panel exam-setup-panel">
            <div className="exam-question-head">
              <div>
                <strong>第 1 题</strong>
                <span>{previewQuestion?.type || "单选题"}</span>
                <small>来自 · {previewQuestion?.chapter || (chapterScope.includes(ALL_CHAPTER) ? "全部章节" : chapterScope.join("、"))}</small>
              </div>
              <div className="exam-question-tools">
                <button className="ghost compact" disabled><Star size={15} />收藏</button>
                <button className="ghost compact" disabled><Bookmark size={15} />标记</button>
                <button className="ghost compact" disabled><Brain size={15} />不熟</button>
              </div>
            </div>
            <h2>{previewQuestion?.stem || "正在准备本次模拟考试题目。"}</h2>
            <div className="exam-options">
              {previewQuestion?.options.map((option) => (
                <AnswerOption
                  key={option.key}
                  option={option}
                  selected={false}
                  correct={false}
                  wrong={false}
                  onClick={start}
                />
              ))}
            </div>
            <div className="exam-hint"><Info size={16} />点击开始考试后进入正式计时；考试过程中不会显示正确答案和 AI 讲解。</div>
            <footer className="exam-action-row">
              <button className="ghost" disabled><ChevronLeft size={17} />上一题</button>
              <button className="ghost" disabled><Bookmark size={17} />暂存本题</button>
              <button className="next-action" onClick={start}><Timer size={17} />开始考试</button>
              <button className="danger-action" disabled>交卷</button>
            </footer>
            <div className="exam-warning"><Info size={15} />模拟考试为真实考试环境，开始后将隐藏正确答案和 AI 讲解。</div>
          </article>
        </main>

        <aside className="exam-answer-panel exam-setup-answer-panel">
          <div className="exam-answer-head">
            <div className="section-title"><CheckCircle2 size={16} /><span>答题卡</span></div>
            <button className="ghost compact" disabled>收起 <ChevronDown size={14} /></button>
          </div>
          <div className="exam-answer-legend">
            <span><i className="done" />已答</span>
            <span><i className="current" />当前</span>
            <span><i />未答</span>
            <span><i className="marked" />已标记</span>
          </div>
          <section className="exam-answer-group exam-answer-flat">
            <div className="exam-answer-flat-title">全部题目 (0/{Math.min(questionCount, DEFAULT_EXAM_QUESTION_COUNT)})</div>
            <div className="exam-answer-grid">
              {Array.from({ length: Math.min(DEFAULT_EXAM_QUESTION_COUNT, questionCount) }, (_, index) => (
                <button key={index} className={index === 0 ? "active" : ""}>{index + 1}</button>
              ))}
            </div>
          </section>
        </aside>
      </section>
    );
  }

  const exam = props.exam!;
  const question = exam.questions[exam.index];
  const selected = question ? exam.answers[question.id] || "" : "";
  const answeredCount = Object.keys(exam.answers).filter((id) => exam.questions.some((q) => q.id === id)).length;
  const markedCount = Object.values(exam.marked).filter(Boolean).length;
  const progressPercent = exam.questions.length ? Math.round((answeredCount / exam.questions.length) * 100) : 0;
  const currentProgress = question ? props.progress.questions[question.id] : undefined;

  function jumpQuestion(index: number) {
    props.onJump(index);
  }

  function jumpRelative(delta: number) {
    if (!onlyUnanswered) {
      props.onJump(exam.index + delta);
      return;
    }
    const direction = delta >= 0 ? 1 : -1;
    for (let cursor = exam.index + direction; cursor >= 0 && cursor < exam.questions.length; cursor += direction) {
      if (!exam.answers[exam.questions[cursor].id]) {
        props.onJump(cursor);
        return;
      }
    }
  }

  if (phase === "finished" && exam.result) {
    const wrongQuestions = exam.questions.filter((item) => exam.result?.wrongQuestionIds.includes(item.id));
    const score = exam.result.accuracy;
    const isPassed = score >= EXAM_PASS_SCORE;
    const usedSeconds = exam.config.durationMinutes * 60 - exam.remainingSeconds;
    return (
      <section className={`exam-page exam-report-page ${isPassed ? "exam-passed" : "exam-failed"}`}>
        {isPassed && <CelebrationOverlay />}
        <header className={`exam-report-header ${isPassed ? "passed" : "failed"}`}>
          <div className="exam-report-header-main">
            <div className="exam-report-title-block">
              <p>考试报告 · {new Date(exam.startedAt).toLocaleString()}</p>
              <h1>{isPassed ? "恭喜通过！" : "未通过，继续加油"}</h1>
              <span>{isPassed ? "表现优秀，继续保持！" : "复盘错题和薄弱章节，下次稳稳拿下。"}</span>
            </div>
            <div className="exam-report-score-block">
              <span>得分</span>
              <strong>{score}<small> 分</small></strong>
              <button onClick={props.onReset}><RotateCcw size={17} />重新考试</button>
            </div>
          </div>
          <div className="exam-report-pass-summary">
            <span><b>您的得分</b><strong>{score}分</strong></span>
            <span><b>及格分数</b><strong>{EXAM_PASS_SCORE}分</strong></span>
            <span><b>正确率</b><strong>{exam.result.accuracy}%</strong></span>
            <span><b>用时</b><strong>{formatDuration(usedSeconds)}</strong></span>
          </div>
          <div className="exam-report-progress">
            <div>
              <span>考试进度</span>
              <strong>100%</strong>
            </div>
            <i><b style={{ width: "100%" }} /></i>
          </div>
        </header>
        <section className="exam-result-grid">
          <Stat label="分数" value={`${score}分`} />
          <Stat label={`及格分数 / 固定标准`} value={`${EXAM_PASS_SCORE}分`} />
          <Stat label="正确率" value={`${exam.result.accuracy}%`} />
          <Stat label="错题数" value={exam.result.wrongQuestionIds.length} tone="danger" />
          <Stat label="用时" value={formatDuration(usedSeconds)} />
        </section>
        <section className="ai-panel exam-ai-panel">
          <div className="exam-ai-heading">
            <strong>{props.aiLoading ? "AI 正在生成考试诊断..." : "AI 考试诊断"}</strong>
            <button className="ghost compact" onClick={props.onAiAnalysis} disabled={props.aiLoading}>
              <Sparkles size={15} />{props.aiContent ? "重新生成" : "生成分析"}
            </button>
          </div>
          {props.aiLoading ? (
            <div className="ai-content">正在结合分数、错题、薄弱章节和未答情况生成报告。</div>
          ) : props.aiContent ? (
            <MarkdownContent text={props.aiContent} />
          ) : (
            <div className="ai-content">AI 会根据本次考试情况生成总体判断、薄弱原因和复习优先级。</div>
          )}
        </section>
        <section className="dashboard-grid exam-report-grid">
          <div className="panel">
            <h2>错题列表</h2>
            {wrongQuestions.length === 0 ? (
              <p className="soft-note">本次没有错题，可以增加题量继续挑战。</p>
            ) : wrongQuestions.map((item) => (
              <div className="exam-wrong-row" key={item.id}>
                <strong>{item.chapter}</strong>
                <p>{item.stem}</p>
                <span>你的答案：{exam.answers[item.id] || "未答"} · 正确答案：{item.answer}</span>
              </div>
            ))}
          </div>
          <div className="panel">
            <h2>薄弱章节</h2>
            {exam.result.weakChapters.length === 0 ? (
              <p className="soft-note">没有明显薄弱章节，当前状态不错。</p>
            ) : exam.result.weakChapters.map((item) => (
              <div className="mastery-row" key={item.chapter}>
                <div><strong>{item.chapter}</strong><span>错 {item.wrong}/{item.total} 题</span></div>
                <progress max={100} value={item.accuracy} />
                <b>{item.accuracy}%</b>
              </div>
            ))}
          </div>
          <div className="panel weak-panel">
            <h2>复习建议</h2>
            <div className="recommend-list">
              {exam.result.recommendations.map((item) => <span key={item}>{item}</span>)}
            </div>
          </div>
        </section>
      </section>
    );
  }

  return (
    <section className="exam-page exam-running exam-full-layout">
      <ExamLeftRail
        exam={exam}
        bank={props.bank}
        answeredCount={answeredCount}
        markedCount={markedCount}
        progressPercent={progressPercent}
        questionCount={questionCount}
        durationMinutes={durationMinutes}
        targetAccuracy={targetAccuracy}
        random={random}
        chapterScope={chapterScope}
        onQuestionCount={setQuestionCount}
        onDurationMinutes={setDurationMinutes}
        onTargetAccuracy={setTargetAccuracy}
        onRandom={setRandom}
        onChapterScope={setChapterScope}
        onRestart={start}
        onlyUnanswered={onlyUnanswered}
        onOnlyUnanswered={setOnlyUnanswered}
        onJump={jumpQuestion}
      />
      <ExamRunningHero bank={props.bank} exam={exam} answeredCount={answeredCount} progressPercent={progressPercent} />
      <main className="exam-main-column">
        <article className="exam-question-panel">
          <div className="exam-question-head">
            <div>
              <strong>第 {exam.index + 1} 题</strong>
              <span>{question.type || "单选题"}</span>
              <small>来自 · {question.chapter}</small>
            </div>
            <div className="exam-question-tools">
              <button className={`ghost compact exam-tool-favorite ${currentProgress?.favorite ? "active" : ""}`} onClick={() => props.onFavorite(question.id)}><Star size={15} />收藏</button>
              <button className={`ghost compact exam-tool-mark ${exam.marked[question.id] ? "active" : ""}`} onClick={() => props.onMark(question.id)}><Bookmark size={15} />标记</button>
              <button className={`ghost compact exam-tool-weak ${currentProgress?.weak ? "active" : ""}`} onClick={() => props.onWeak(question.id)}><Brain size={15} />不熟</button>
            </div>
          </div>
          <h2>{question.stem}</h2>
          <div className="exam-options">
            {question.options.map((option) => (
              <AnswerOption
                key={option.key}
                option={option}
                selected={selected === option.key}
                correct={false}
                wrong={false}
                onClick={() => props.onAnswer(question.id, option.key)}
              />
            ))}
          </div>
          <div className="exam-hint"><Info size={16} />提示：请选择最符合题意的正确答案。</div>
          <footer className="exam-action-row">
            <button className="ghost" onClick={() => jumpRelative(-1)} disabled={exam.index <= 0}><ChevronLeft size={17} />上一题</button>
            <button className="ghost" onClick={() => props.onMark(question.id)}><Bookmark size={17} />暂存本题</button>
            <button className="next-action" onClick={() => jumpRelative(1)} disabled={exam.index >= exam.questions.length - 1}>下一题<ChevronRight size={17} /></button>
            <button className="danger-action" onClick={props.onSubmit}>交卷</button>
          </footer>
          <div className="exam-warning"><Info size={15} />模拟考试为真实考试环境，请独立完成。考试过程中不可使用 AI 工具或外部资料，否则成绩无效。</div>
        </article>
      </main>
      <ExamAnswerPanel
        exam={exam}
        collapsed={answerPanelCollapsed}
        onlyUnanswered={onlyUnanswered}
        onCollapsed={setAnswerPanelCollapsed}
        onJump={jumpQuestion}
      />
    </section>
  );
}

function ExamRunningHero({ bank, exam, answeredCount, progressPercent }: { bank: QuestionBank; exam: ActiveExam; answeredCount: number; progressPercent: number }) {
  return (
    <header className="exam-running-hero">
      <div>
        <p>模拟考试 / {bank.subtitle} / {bank.generatedAt || "练习题库"} · 模拟考试（计时）</p>
        <h1>多旋翼无人机执照模拟考试</h1>
        <div className="exam-hero-meta">
          <span><Clock size={14} />考试模式：计时模式</span>
          <span><ListChecks size={14} />总题数：{exam.questions.length}题</span>
          <span><Target size={14} />目标正确率：≥ {exam.config.targetAccuracy}%</span>
        </div>
        <div className="exam-hero-progress">
          <span>考试进度</span>
          <i><b style={{ width: `${progressPercent}%` }} /></i>
          <strong>{progressPercent}%</strong>
        </div>
      </div>
      <div className="exam-countdown">
        <span>剩余时间</span>
        <strong>{formatDuration(exam.remainingSeconds)}</strong>
        <em className={exam.started ? "" : "waiting"}>{exam.started ? "进行中" : "待开始"}</em>
      </div>
      <img src="/assets/caac-exam-drone-fpv.png" alt="" />
    </header>
  );
}

function ExamLeftRail(props: {
  exam: ActiveExam;
  bank: QuestionBank;
  answeredCount: number;
  markedCount: number;
  progressPercent: number;
  questionCount: number;
  durationMinutes: number;
  targetAccuracy: number;
  random: boolean;
  chapterScope: string[];
  onQuestionCount: (value: number) => void;
  onDurationMinutes: (value: number) => void;
  onTargetAccuracy: (value: number) => void;
  onRandom: (value: boolean) => void;
  onChapterScope: (value: string[]) => void;
  onRestart: () => void;
  onlyUnanswered: boolean;
  onOnlyUnanswered: (value: boolean) => void;
  onJump: (index: number) => void;
}) {
  const {
    exam,
    bank,
    answeredCount,
    markedCount,
    progressPercent,
    questionCount,
    durationMinutes,
    targetAccuracy,
    random,
    chapterScope,
    onQuestionCount,
    onDurationMinutes,
    onTargetAccuracy,
    onRandom,
    onChapterScope,
    onRestart,
    onlyUnanswered,
    onOnlyUnanswered,
    onJump
  } = props;
  const notAnswered = Math.max(0, exam.questions.length - answeredCount);
  const chapterRows = bank.chapters.map((chapter) => {
    const scoped = exam.questions.filter((question) => question.chapter === chapter.name);
    const answered = scoped.filter((question) => exam.answers[question.id]).length;
    const firstIndex = scoped.length ? exam.questions.findIndex((question) => question.id === scoped[0].id) : -1;
    return { name: chapter.name, total: scoped.length, answered, firstIndex };
  }).filter((row) => row.total > 0);
  const activeChapter = exam.questions[exam.index]?.chapter;

  return (
    <aside className="exam-left-rail">
      <section className="exam-side-card">
        <div className="section-title"><CheckCircle2 size={16} /><span>考试概览</span></div>
        <div className="exam-overview-grid">
          <div><b>{exam.questions.length}</b><span>总题数</span></div>
          <div><b>{answeredCount}</b><span>已答题</span></div>
          <div><b>{notAnswered}</b><span>未答题</span></div>
          <div><b>{markedCount}</b><span>已标记</span></div>
        </div>
        <div className="exam-target-row">
          <span>目标正确率</span><strong>≥ {exam.config.targetAccuracy}%</strong>
          <span>及格分数</span><strong>{EXAM_PASS_SCORE} 分</strong>
          <span>预计用时</span><strong>{exam.config.durationMinutes} 分钟</strong>
        </div>
      </section>

      <section className="exam-side-card">
        <div className="section-title"><Shuffle size={16} /><span>考试控制</span></div>
        <label>
          <span>快速跳题</span>
          <div className="search-input"><Search size={16} /><input placeholder="输入题号，按回车跳转" onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            const value = Number((event.currentTarget as HTMLInputElement).value);
            if (Number.isFinite(value)) onJump(value - 1);
          }} /></div>
        </label>
        <label>
          <span>考试模式</span>
          <select value={random ? "模拟考试（计时）" : "顺序考试（计时）"} onChange={(event) => onRandom(event.target.value.includes("模拟"))}>
            <option>模拟考试（计时）</option>
            <option>顺序考试（计时）</option>
          </select>
        </label>
        <div className="exam-control-grid">
          <label>
            <span>考试题数</span>
            <input type="number" min={5} max={bank.total} value={questionCount} onChange={(event) => onQuestionCount(Number(event.target.value || 1))} />
          </label>
          <label>
            <span>考试时间</span>
            <input type="number" min={1} max={240} value={durationMinutes} onChange={(event) => onDurationMinutes(Number(event.target.value || 1))} />
          </label>
          <label>
            <span>目标正确率</span>
            <input type="number" min={1} max={100} value={targetAccuracy} onChange={(event) => onTargetAccuracy(Number(event.target.value || 1))} />
          </label>
        </div>
        <label>
          <span>章节范围</span>
          <select value={chapterScope.includes(ALL_CHAPTER) ? ALL_CHAPTER : chapterScope[0] || activeChapter || ALL_CHAPTER} onChange={(event) => {
            const value = event.target.value;
            onChapterScope(value === ALL_CHAPTER ? [ALL_CHAPTER] : [value]);
          }}>
            <option value={ALL_CHAPTER}>全部章节</option>
            {bank.chapters.map((row) => <option key={row.name} value={row.name}>{row.name}</option>)}
          </select>
        </label>
        <label className="exam-check-row">
          <input type="checkbox" checked={onlyUnanswered} onChange={(event) => onOnlyUnanswered(event.target.checked)} />
          <span>仅看未答</span>
        </label>
        <button className="next-action exam-start-inline" onClick={onRestart}><RotateCcw size={16} />按设置重开</button>
        <p className="exam-config-note">修改题数、时间或目标正确率后，重开本次模拟考试生效。</p>
      </section>

      <section className="exam-side-card">
        <div className="section-title"><ClipboardList size={16} /><span>题目章节</span></div>
        <div className="exam-chapter-mini">
          <button className="active"><span>全部题目</span><b>{answeredCount}/{exam.questions.length}</b><i style={{ width: `${progressPercent}%` }} /></button>
          {chapterRows.map((row) => (
            <button key={row.name} className={activeChapter === row.name ? "active" : ""} onClick={() => row.firstIndex >= 0 && onJump(row.firstIndex)}>
              <span>{row.name}</span><b>{row.answered}/{row.total}</b><i style={{ width: `${row.total ? Math.round((row.answered / row.total) * 100) : 0}%` }} />
            </button>
          ))}
        </div>
      </section>
    </aside>
  );
}

function ExamAnswerPanel(props: {
  exam: ActiveExam;
  collapsed: boolean;
  onlyUnanswered: boolean;
  onCollapsed: (value: boolean) => void;
  onJump: (index: number) => void;
}) {
  const { exam, collapsed, onCollapsed, onJump } = props;
  const rows = exam.questions.map((question, index) => ({ question, index }));
  const answeredCount = rows.filter((row) => exam.answers[row.question.id]).length;
  return (
    <aside className={`exam-answer-panel ${collapsed ? "collapsed" : ""}`}>
      <div className="exam-answer-head">
        <div className="section-title"><CheckCircle2 size={16} /><span>答题卡</span></div>
        <button className="ghost compact" onClick={() => onCollapsed(!collapsed)}>{collapsed ? "展开" : "收起"} <ChevronDown size={14} /></button>
      </div>
      {!collapsed && (
        <>
          <div className="exam-answer-legend">
            <span><i className="done" />已答</span>
            <span><i className="current" />当前</span>
            <span><i />未答</span>
            <span><i className="marked" />已标记</span>
          </div>
          {rows.length === 0 ? (
            <div className="exam-answer-empty">所有题目都已作答。</div>
          ) : (
            <section className="exam-answer-group exam-answer-flat">
              <div className="exam-answer-flat-title">全部题目 ({answeredCount}/{rows.length})</div>
              <div className="exam-answer-grid">
                {rows.map((row) => (
                  <button key={row.question.id} className={`${row.index === exam.index ? "active" : ""} ${exam.answers[row.question.id] ? "answered" : ""} ${exam.marked[row.question.id] ? "marked" : ""}`} onClick={() => onJump(row.index)}>
                    {row.index + 1}
                  </button>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </aside>
  );
}

function renderInlineMarkdown(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text))) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    const token = match[0];
    if (token.startsWith("**")) {
      nodes.push(<strong key={`${match.index}-strong`}>{token.slice(2, -2)}</strong>);
    } else {
      nodes.push(<code key={`${match.index}-code`}>{token.slice(1, -1)}</code>);
    }
    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

function MarkdownContent({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: React.ReactNode[] = [];
  let paragraph: string[] = [];
  let list: Array<{ ordered: boolean; text: string }> = [];

  function flushParagraph() {
    if (!paragraph.length) return;
    blocks.push(<p key={`p-${blocks.length}`}>{renderInlineMarkdown(paragraph.join(" "))}</p>);
    paragraph = [];
  }

  function flushList() {
    if (!list.length) return;
    const ordered = list[0].ordered;
    const Tag = ordered ? "ol" : "ul";
    blocks.push(
      <Tag key={`list-${blocks.length}`}>
        {list.map((item, index) => <li key={index}>{renderInlineMarkdown(item.text)}</li>)}
      </Tag>
    );
    list = [];
  }

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
      blocks.push(<hr key={`hr-${blocks.length}`} />);
      continue;
    }

    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      const level = Math.min(heading[1].length, 4);
      const content = renderInlineMarkdown(heading[2]);
      if (level === 1) blocks.push(<h3 key={`h-${blocks.length}`}>{content}</h3>);
      else if (level === 2) blocks.push(<h4 key={`h-${blocks.length}`}>{content}</h4>);
      else if (level === 3) blocks.push(<h5 key={`h-${blocks.length}`}>{content}</h5>);
      else blocks.push(<h6 key={`h-${blocks.length}`}>{content}</h6>);
      continue;
    }

    if (line.startsWith(">")) {
      flushParagraph();
      flushList();
      blocks.push(<blockquote key={`quote-${blocks.length}`}>{renderInlineMarkdown(line.replace(/^>\s*/, ""))}</blockquote>);
      continue;
    }

    const unordered = /^[-*]\s+(.+)$/.exec(line);
    const ordered = /^\d+[.)]\s+(.+)$/.exec(line);
    if (unordered || ordered) {
      flushParagraph();
      const next = { ordered: Boolean(ordered), text: (unordered || ordered)?.[1] || "" };
      if (list.length && list[0].ordered !== next.ordered) flushList();
      list.push(next);
      continue;
    }

    paragraph.push(line);
  }

  flushParagraph();
  flushList();

  return <div className="ai-content markdown-content">{blocks}</div>;
}

function clampPercent(value: number) {
  return Math.min(100, Math.max(0, Math.round(value)));
}

function formatDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDateTime(value: number) {
  const date = new Date(value);
  return `${formatDate(date)} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function formatLearningTime(minutes: number) {
  const safeMinutes = Math.max(0, Math.round(minutes));
  const hours = Math.floor(safeMinutes / 60);
  const rest = safeMinutes % 60;
  return { hours, minutes: rest };
}

function buildSparklinePoints(values: number[], width = 220, height = 76) {
  const safeValues = values.length ? values : [0];
  const max = Math.max(...safeValues, 1);
  return safeValues.map((value, index) => {
    const x = safeValues.length === 1 ? width / 2 : (index / (safeValues.length - 1)) * width;
    const y = height - (value / max) * (height - 12) - 6;
    return `${x},${y}`;
  }).join(" ");
}

function buildDonutBackground(items: Array<{ value: number; color: string }>, fallback = "#edf2ee") {
  const total = items.reduce((sum, item) => sum + Math.max(item.value, 0), 0);
  if (!total) return `conic-gradient(${fallback} 0 100%)`;
  let cursor = 0;
  const segments = items.map((item) => {
    const start = cursor;
    const end = cursor + (Math.max(item.value, 0) / total) * 100;
    cursor = end;
    return `${item.color} ${start}% ${end}%`;
  });
  return `conic-gradient(${segments.join(", ")}, ${fallback} ${cursor}% 100%)`;
}

type DashboardLegendItem = {
  label: string;
  value: string | number;
  unit?: string;
  color: string;
  meta?: string;
};

function DashboardCard({ className = "", title, action, loading = false, children }: { className?: string; title?: string; action?: React.ReactNode; loading?: boolean; children: React.ReactNode }) {
  return (
    <section className={`dash-card dashboard-card-modern ${className}`}>
      {(title || action) && (
        <div className="dash-card-head modern-head">
          {title && <h2>{title}</h2>}
          {action}
        </div>
      )}
      {loading ? <div className="dashboard-skeleton" /> : children}
    </section>
  );
}

function StatLegend({ items }: { items: DashboardLegendItem[] }) {
  return (
    <div className="stat-legend">
      {items.map((item) => (
        <div className="stat-legend-row" key={item.label}>
          <i style={{ background: item.color }} />
          <span>{item.label}</span>
          <b>{item.value}</b>
          {item.unit && <em>{item.unit}</em>}
          {item.meta && <small>{item.meta}</small>}
        </div>
      ))}
    </div>
  );
}

function DonutChart({ items, value, label, className = "" }: { items: DashboardLegendItem[]; value: string | number; label: string; className?: string }) {
  return (
    <div className={`donut-visual ${className}`} style={{ background: buildDonutBackground(items.map((item) => ({ value: Number(item.value) || 0, color: item.color })), "#edf2ee") }}>
      <div className="donut-center">
        <strong>{value}</strong>
        <span>{label}</span>
      </div>
    </div>
  );
}

function buildSmoothPath(points: Array<{ x: number; y: number }>) {
  if (!points.length) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  const commands = [`M ${points[0].x} ${points[0].y}`];
  for (let index = 0; index < points.length - 1; index += 1) {
    const previous = points[Math.max(0, index - 1)];
    const current = points[index];
    const next = points[index + 1];
    const nextAfter = points[Math.min(points.length - 1, index + 2)];
    const control1 = {
      x: current.x + (next.x - previous.x) / 6,
      y: current.y + (next.y - previous.y) / 6
    };
    const control2 = {
      x: next.x - (nextAfter.x - current.x) / 6,
      y: next.y - (nextAfter.y - current.y) / 6
    };
    commands.push(`C ${control1.x} ${control1.y}, ${control2.x} ${control2.y}, ${next.x} ${next.y}`);
  }
  return commands.join(" ");
}

function TrendChart({ values, labels, bars, suffix = "", emptyText = "暂无趋势数据" }: { values: number[]; labels: string[]; bars?: number[]; suffix?: string; emptyText?: string }) {
  const chartId = useId().replace(/:/g, "");
  const width = 360;
  const height = 210;
  const left = 22;
  const right = 22;
  const top = 38;
  const bottom = 36;
  const plotHeight = height - top - bottom;
  const safeValues = (bars?.length ? bars : values).map((value) => Math.max(0, value || 0));
  const maxValue = Math.max(...safeValues, 0);
  const max = Math.max(maxValue * 1.28, 1);
  if (!safeValues.length) {
    return <div className="chart-empty-state"><BarChart3 size={24} /><span>{emptyText}</span></div>;
  }
  const points = safeValues.map((value, index) => ({
    x: safeValues.length === 1 ? width / 2 : left + (index / Math.max(safeValues.length - 1, 1)) * (width - left - right),
    y: top + (1 - value / max) * plotHeight
  }));
  const linePath = buildSmoothPath(points);
  const areaPath = points.length ? `${linePath} L ${points[points.length - 1].x} ${height - bottom} L ${points[0].x} ${height - bottom} Z` : "";
  const peakIndex = safeValues.findIndex((value) => value === maxValue);
  const peakPoint = points[peakIndex];
  const peakLabel = peakIndex >= 0 ? `${labels[peakIndex]} · ${safeValues[peakIndex]}${suffix}` : "";
  const peakLabelX = peakPoint ? Math.min(Math.max(peakPoint.x, 52), width - 52) : width / 2;
  const peakLabelY = peakPoint ? Math.max(peakPoint.y - 28, 20) : 20;

  return (
    <div className="trend-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="趋势图">
        <defs>
          <linearGradient id={`${chartId}TrendFill`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#52B788" stopOpacity=".18" />
            <stop offset="100%" stopColor="#52B788" stopOpacity="0" />
          </linearGradient>
          <filter id={`${chartId}TooltipShadow`} x="-30%" y="-80%" width="160%" height="260%">
            <feDropShadow dx="0" dy="8" stdDeviation="8" floodColor="#102033" floodOpacity=".12" />
          </filter>
        </defs>
        {[0, 1, 2, 3].map((line) => {
          const y = top + (line / 3) * plotHeight;
          return <line className="trend-grid-line" key={line} x1={left} x2={width - right} y1={y} y2={y} />;
        })}
        {peakPoint && maxValue > 0 && <line className="trend-peak-line" x1={peakPoint.x} x2={peakPoint.x} y1={top + 4} y2={height - bottom} />}
        {areaPath && <path className="trend-area" d={areaPath} style={{ fill: `url(#${chartId}TrendFill)` }} />}
        {linePath && <path className="trend-line" d={linePath} />}
        {points.map((point, index) => (
          <g className={index === peakIndex && maxValue > 0 ? "trend-point active" : "trend-point"} key={`${labels[index]}-${index}`}>
            <circle cx={point.x} cy={point.y} r="4.6" />
            <g className="trend-hover-card" transform={`translate(${Math.min(Math.max(point.x, 52), width - 52)} ${Math.max(point.y - 28, 20)})`}>
              <rect x="-39" y="-16" width="78" height="24" rx="10" filter={`url(#${chartId}TooltipShadow)`} />
              <text x="0" y="0">{labels[index]} · {safeValues[index]}{suffix}</text>
            </g>
            <text className="trend-tooltip" x={Math.min(Math.max(point.x, 36), width - 36)} y={Math.max(point.y - 14, 16)}>{labels[index]} · {safeValues[index]}{suffix}</text>
          </g>
        ))}
        {peakPoint && maxValue > 0 && (
          <g className="trend-peak-label" transform={`translate(${peakLabelX} ${peakLabelY})`}>
            <rect x="-43" y="-17" width="86" height="26" rx="10" filter={`url(#${chartId}TooltipShadow)`} />
            <text x="0" y="0">{peakLabel}</text>
          </g>
        )}
        {labels.map((label, index) => {
          const x = labels.length === 1 ? width / 2 : left + (index / Math.max(labels.length - 1, 1)) * (width - left - right);
          return <text className="trend-axis-label" key={label} x={x} y={height - 8}>{label}</text>;
        })}
      </svg>
    </div>
  );
}

function ProgressList({ items }: { items: Array<{ label: string; value: number; meta?: string }> }) {
  if (!items.length) {
    return <div className="chart-empty-state"><ListChecks size={24} /><span>暂无章节进度，开始练习后自动生成。</span></div>;
  }
  return (
    <div className="progress-list-modern">
      {items.map((item, index) => (
        <div className="progress-list-row" key={item.label}>
          <span>{index + 1}. {item.label}</span>
          <i><b style={{ width: `${item.value}%` }} /></i>
          <strong>{item.value}%</strong>
          {item.meta && <em>{item.meta}</em>}
        </div>
      ))}
    </div>
  );
}

function DashboardPage({ bank, stats, progress, onPractice, onExam }: { bank: QuestionBank; stats: ReturnType<typeof buildDashboardStats>; progress: ProgressState; onPractice: () => void; onExam: () => void }) {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const todayEnd = todayStart + 86400_000;
  const examRecords = [...progress.examRecords].sort((a, b) => b.createdAt - a.createdAt);
  const latestExam = examRecords[0];
  const answerEvents = bank.questions.flatMap((question) => (
    (progress.questions[question.id]?.answerHistory || []).map((record) => ({ question, record }))
  ));
  const todayAnswers = answerEvents.filter(({ record }) => record.answeredAt >= todayStart && record.answeredAt < todayEnd);
  const todayExams = examRecords.filter((exam) => exam.createdAt >= todayStart && exam.createdAt < todayEnd);
  const totalExamMinutes = examRecords.reduce((sum, exam) => sum + Math.round((exam.durationSeconds || 0) / 60), 0);
  const learningTime = formatLearningTime(answerEvents.length * 2 + totalExamMinutes);
  const todayMinutes = todayAnswers.length * 2 + todayExams.reduce((sum, exam) => sum + Math.round((exam.durationSeconds || 0) / 60), 0);
  const completionRate = stats.total ? clampPercent((stats.answered / stats.total) * 100) : 0;
  const learningCount = Math.max(0, stats.answered - stats.correct);
  const unstartedCount = Math.max(0, stats.total - stats.answered);
  const points = stats.answered + stats.correct * 2 + stats.favorites * 8 + examRecords.length * 40;
  const nextLevel = points >= 2000 ? 5000 : points >= 1000 ? 2000 : 1000;
  const levelStart = points >= 2000 ? 2000 : points >= 1000 ? 1000 : 0;
  const levelProgress = clampPercent(((points - levelStart) / Math.max(nextLevel - levelStart, 1)) * 100);
  const levelName = points >= 2000 ? "精英学员" : points >= 1000 ? "进阶学员" : "起飞学员";

  const overviewItems = [
    { label: "总题量", value: stats.total, unit: "道", icon: "doc" },
    { label: "已练", value: stats.answered, unit: "道", icon: "check" },
    { label: "正确率", value: `${stats.accuracy}%`, unit: "", icon: "chart", strong: true },
    { label: "错题", value: stats.wrong, unit: "道", icon: "tools", danger: true },
    { label: "连续学习天数", value: stats.recentDays.filter((day) => day.count > 0).length, unit: "天", icon: "calendar" },
    { label: "本周学习时长", value: Math.round(stats.recentDays.reduce((sum, day) => sum + day.count * 2, 0) / 10) / 10, unit: "小时", icon: "clock" }
  ];

  const taskItems = [
    { label: "学习新题 30 道", current: Math.min(todayAnswers.length, 30), total: 30 },
    { label: "模拟考试 1 次", current: Math.min(todayExams.length, 1), total: 1 },
    { label: "复习错题 20 道", current: Math.min(stats.wrong, 20), total: 20 },
    { label: "学习时长 60 分钟", current: Math.min(todayMinutes, 60), total: 60 }
  ];
  const doneTasks = taskItems.filter((item) => item.current >= item.total).length;

  const wrongByChapter = new Map<string, number>();
  for (const question of bank.questions) {
    const wrongCount = progress.questions[question.id]?.wrongCount || 0;
    if (wrongCount) wrongByChapter.set(question.chapter, (wrongByChapter.get(question.chapter) || 0) + wrongCount);
  }

  const chapterCompletion = stats.chapterMastery
    .map((item) => ({ ...item, completion: item.total ? clampPercent((item.answered / item.total) * 100) : 0 }))
    .sort((a, b) => b.completion - a.completion || b.answered - a.answered)
    .slice(0, 6);

  const reviewChapters = stats.chapterMastery
    .map((item) => ({
      chapter: item.chapter,
      wrong: wrongByChapter.get(item.chapter) || 0,
      total: item.total,
      score: (wrongByChapter.get(item.chapter) || 0) * 3 + (item.accuracy === null ? 20 : Math.max(0, 100 - item.accuracy))
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  const recentExamTrend = examRecords.slice(0, 10).reverse();
  const examScores = recentExamTrend.map((exam) => exam.total ? Math.round((exam.correct / exam.total) * 100) : 0);
  const avgExamScore = examScores.length ? Math.round(examScores.reduce((sum, value) => sum + value, 0) / examScores.length) : 0;
  const passRate = examScores.length ? Math.round((examScores.filter((score) => score >= 70).length / examScores.length) * 100) : 0;

  const typeCounts = new Map<string, number>();
  for (const question of bank.questions) {
    typeCounts.set(question.type || "单选题", (typeCounts.get(question.type || "单选题") || 0) + 1);
  }
  const typeColors = ["#55b85c", "#5b8def", "#f5c23c", "#9c7cf3"];
  const typeItems = [...typeCounts.entries()].map(([label, value], index) => ({
    label,
    value,
    color: typeColors[index % typeColors.length],
    percent: stats.total ? clampPercent((value / stats.total) * 100) : 0
  })).slice(0, 4);

  const answeredProgress = bank.questions
    .map((question) => progress.questions[question.id])
    .filter((item): item is NonNullable<typeof item> => Boolean(item?.attempts));
  const accuracyBands = [
    { label: "高正确率 (≥80%)", value: answeredProgress.filter((item) => item.answerHistory.filter((record) => record.correct).length / Math.max(item.answerHistory.length, 1) >= 0.8).length, color: "#56b85f" },
    { label: "中正确率 (50%-80%)", value: answeredProgress.filter((item) => {
      const rate = item.answerHistory.filter((record) => record.correct).length / Math.max(item.answerHistory.length, 1);
      return rate >= 0.5 && rate < 0.8;
    }).length, color: "#f4c21f" },
    { label: "低正确率 (<50%)", value: answeredProgress.filter((item) => item.answerHistory.filter((record) => record.correct).length / Math.max(item.answerHistory.length, 1) < 0.5).length, color: "#fb955b" }
  ];

  const recentActivities = [
    ...answerEvents.map(({ question, record }) => ({
      id: `${question.id}-${record.answeredAt}`,
      time: record.answeredAt,
      content: `章节练习 - ${question.chapter}`,
      duration: "2 分钟",
      amount: "1 道",
      accuracy: record.correct ? "100%" : "0%",
      action: "继续学习"
    })),
    ...examRecords.map((exam) => ({
      id: exam.id,
      time: exam.createdAt,
      content: `模拟考试 - ${exam.chapterScope.join("、")}`,
      duration: `${Math.max(1, Math.round((exam.durationSeconds || 0) / 60))} 分钟`,
      amount: `${exam.total} 道`,
      accuracy: `${exam.total ? Math.round((exam.correct / exam.total) * 100) : 0}%`,
      action: "查看报告"
    }))
  ].sort((a, b) => b.time - a.time).slice(0, 5);

  const progressLegend = [
    { label: "已完成", value: stats.correct, unit: "题", color: "#52B788" },
    { label: "学习中", value: learningCount, unit: "题", color: "#F2C94C" },
    { label: "未学习", value: unstartedCount, unit: "题", color: "#8CB6FF" }
  ];
  const typeLegend = typeItems.map((item) => ({ label: item.label, value: item.percent, unit: "%", color: item.color, meta: `${item.value} 题` }));
  const accuracyLegend = accuracyBands.map((item) => ({ label: item.label, value: item.value, unit: "题", color: item.color }));

  return (
    <section className="dashboard-page dashboard-v2">
      <aside className="dashboard-left-rail">
        <section className="dash-card dashboard-overview-card">
          <div className="dash-card-title"><Gauge size={16} /><span>学习概览</span><button type="button" aria-label="刷新学习概览"><RotateCcw size={15} /></button></div>
          <div className="overview-grid">
            {overviewItems.map((item) => (
              <div className="overview-stat" key={item.label}>
                <span className="overview-icon"><img src={`/assets/ui-icons/${item.icon}.png`} alt="" /></span>
                <span className="overview-copy">
                  <small>{item.label}</small>
                  <span className="overview-value">
                    <strong className={`${item.strong ? "success" : ""} ${item.danger ? "danger" : ""}`}>{item.value}</strong>
                    {item.unit && <em>{item.unit}</em>}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="dash-card achievement-card">
          <div className="dash-card-title"><Star size={16} /><span>学习成就</span></div>
          <div className="achievement-badge">
            <div className="badge-medal"><Star size={36} fill="currentColor" /></div>
            <div>
              <h3>{levelName}</h3>
              <p>距离升阶还差 <b>{Math.max(nextLevel - points, 0)}</b> 积分</p>
            </div>
          </div>
          <div className="thin-progress"><span style={{ width: `${levelProgress}%` }} /></div>
          <div className="achievement-score"><span>{points}</span><b>/ {nextLevel}</b></div>
          <div className="medal-row">
            <span><CheckCircle2 size={15} />坚持不错</span>
            <span><Target size={15} />进度突破</span>
            <span><Timer size={15} />模拟达人</span>
          </div>
        </section>

        <section className="dash-card quick-entry-card">
          <div className="dash-card-title"><Grid2X2 size={16} /><span>快捷入口</span></div>
          <div className="quick-entry-grid">
            <button type="button" onClick={onExam}><CheckCircle2 size={22} />模拟考试</button>
            <button type="button" onClick={onPractice}><ClipboardList size={22} />错题本</button>
            <button type="button" onClick={onPractice}><Bookmark size={22} />收藏题库</button>
            <button type="button" onClick={onPractice}><CalendarIcon />学习计划</button>
          </div>
        </section>

        <div className="dashboard-illustration" aria-hidden="true" />
      </aside>

      <div className="dashboard-center">
        <section className="dash-card dashboard-hero-v2 dashboard-hero-clean">
          <div className="dashboard-hero-copy">
            <div className="dashboard-hero-kicker">
              <p>学习数据总览</p>
              <span>数据统计截至 {formatDate(now)}</span>
            </div>
            <h1>保持节奏，稳步提升</h1>
            <div className="learning-time">
              累计学习 <b>{learningTime.hours}</b> 小时 <b>{learningTime.minutes}</b> 分钟
            </div>
            <div className="dashboard-hero-progress">
              <div><span>学习完成度</span><strong>{completionRate}%</strong></div>
              <i><b style={{ width: `${completionRate}%` }} /></i>
            </div>
          </div>
          <img className="dashboard-hero-drone" src="/assets/dashboard-hero-drone.png" alt="" />
        </section>

        <div className="dashboard-center-grid top">
          <DashboardCard className="learning-progress-card" title="学习进度">
            <div className="donut-layout-modern">
              <DonutChart items={progressLegend} value={`${completionRate}%`} label="总进度" />
              <StatLegend items={progressLegend} />
            </div>
            <p className="chart-footnote">预计完成剩余内容需 {Math.max(1, Math.round(unstartedCount * 2 / 60))} 小时</p>
          </DashboardCard>

          <DashboardCard className="chapter-completion-card" title="章节完成度" action={<button type="button" onClick={onPractice}>查看全部 <ChevronRight size={14} /></button>}>
            <ProgressList items={chapterCompletion.map((item) => ({ label: item.chapter, value: item.completion, meta: `${item.answered}/${item.total}` }))} />
          </DashboardCard>

          <DashboardCard className="weekly-trend-card" title="最近七天学习趋势" action={<button type="button">近7天 <ChevronDown size={14} /></button>}>
            <TrendChart values={stats.recentDays.map((day) => day.correct)} bars={stats.recentDays.map((day) => day.count)} labels={stats.recentDays.map((day) => day.label)} suffix="题" />
          </DashboardCard>
        </div>

        <div className="dashboard-center-grid lower">
          <DashboardCard className="exam-trend-card" title="模拟考试成绩趋势" action={<button type="button">近10次 <ChevronDown size={14} /></button>}>
            <div className="trend-with-stats">
              <TrendChart values={examScores} labels={recentExamTrend.map((_, index) => `第${index + 1}次`)} suffix="分" emptyText="完成一次模拟考试后生成成绩曲线" />
              <div className="chart-side-stat"><span>平均分</span><strong>{avgExamScore || "--"}</strong><span>通过率</span><b>{passRate}%</b></div>
            </div>
          </DashboardCard>

          <DashboardCard className="distribution-card" title="题型分布">
            <div className="donut-layout-modern compact">
              <DonutChart items={typeLegend} value={stats.total} label="总题量" className="small" />
              <StatLegend items={typeLegend} />
            </div>
          </DashboardCard>

          <DashboardCard className="accuracy-card" title="正确率分析">
            <div className="donut-layout-modern compact">
              <DonutChart items={accuracyLegend} value={`${stats.accuracy}%`} label="总体正确率" className="small" />
              <StatLegend items={accuracyLegend} />
            </div>
          </DashboardCard>
        </div>

        <section className="dash-card recent-record-card">
          <h2>最近学习记录</h2>
          <div className="record-table">
            <div className="record-head"><span>时间</span><span>学习内容</span><span>学习时长</span><span>做题数</span><span>正确率</span><span>操作</span></div>
            {recentActivities.length ? recentActivities.map((item) => (
              <div className="record-row" key={item.id}>
                <span>{formatDateTime(item.time)}</span>
                <strong>{item.content}</strong>
                <span>{item.duration}</span>
                <span>{item.amount}</span>
                <span>{item.accuracy}</span>
                <button type="button" onClick={item.action === "查看报告" ? onExam : onPractice}>{item.action}</button>
              </div>
            )) : (
              <div className="record-empty">还没有学习记录，先完成一道题或一次模拟考试。</div>
            )}
          </div>
        </section>
      </div>

      <aside className="dashboard-right-rail">
        <section className="dash-card today-task-card">
          <div className="dash-card-head"><h2>今日任务</h2><span>任务进度 {doneTasks}/{taskItems.length}</span></div>
          <div className="task-list">
            {taskItems.map((item) => (
              <div className={item.current >= item.total ? "task-row done" : "task-row"} key={item.label}>
                <CheckCircle2 size={18} />
                <span>{item.label}</span>
                <b>{item.current}/{item.total}</b>
              </div>
            ))}
          </div>
          <button className="soft-full-btn" type="button" onClick={onPractice}>查看全部任务</button>
        </section>

        <section className="dash-card recent-exam-card">
          <div className="dash-card-head"><h2>最近考试成绩</h2><button type="button" onClick={onExam}>查看全部 <ChevronRight size={14} /></button></div>
          {latestExam ? (
            <>
              <div className="recent-score"><strong>{latestExam.total ? Math.round((latestExam.correct / latestExam.total) * 100) : 0}</strong><span>分</span><em>{latestExam.total && latestExam.correct / latestExam.total >= 0.7 ? "通过" : "待提升"}</em></div>
              <p>多旋翼无人机执照模拟考试<br />{formatDateTime(latestExam.createdAt)}</p>
              <div className="exam-mini-stats">
                <span><b>{latestExam.total}</b>总题数</span>
                <span><b>{latestExam.correct}</b>正确数</span>
                <span><b>{latestExam.total ? Math.round((latestExam.correct / latestExam.total) * 100) : 0}%</b>正确率</span>
              </div>
            </>
          ) : (
            <p className="soft-note">还没有模拟考试成绩，完成一次考试后这里会展示成绩摘要。</p>
          )}
        </section>

        <section className="dash-card reminder-card">
          <div className="dash-card-head"><h2>学习提醒</h2><button type="button">设置提醒 <ChevronRight size={14} /></button></div>
          <div className="reminder-row"><Clock size={15} /><span>每日学习提醒</span><b>已开启 19:00 提醒</b></div>
          <div className="reminder-row"><Clock size={15} /><span>错题复习提醒</span><b>已开启 每周日 20:00</b></div>
        </section>

        <section className="dash-card review-card">
          <div className="dash-card-head"><h2>待复习章节</h2><button type="button" onClick={onPractice}>查看全部 <ChevronRight size={14} /></button></div>
          <div className="review-list">
            {(reviewChapters.length ? reviewChapters : chapterCompletion.slice(-3)).map((item, index) => (
              <div className="review-row" key={item.chapter}>
                <b>{index + 1}.</b>
                <span>{item.chapter}</span>
                <em>错题 {"wrong" in item ? item.wrong : 0} 道</em>
              </div>
            ))}
          </div>
        </section>

        <section className="dash-card ranking-card">
          <div className="dash-card-head"><h2>学员排行榜（本周）</h2><button type="button">查看全部 <ChevronRight size={14} /></button></div>
          <div className="ranking-list">
            {[
              { rank: 1, name: "李飞飞", score: Math.max(points + 420, 1280) },
              { rank: 2, name: "王浩然", score: Math.max(points + 210, 1070) },
              { rank: 3, name: "张子墨", score: Math.max(points + 120, 980) },
              { rank: 4, name: "我（wooxiaowei）", score: Math.max(points, 860), me: true }
            ].map((item) => (
              <div className={item.me ? "ranking-row me" : "ranking-row"} key={item.rank}>
                <b>{item.rank}</b>
                <span>{item.name}</span>
                <em>{item.score} 分</em>
              </div>
            ))}
          </div>
        </section>
      </aside>
    </section>
  );
}

function CalendarIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 3v3m10-3v3M5 9h14M6 5h12a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="m8 14 2 2 5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function EmptyCard({ title, text }: { title: string; text: string }) {
  return <div className="empty-card"><BarChart3 /><h2>{title}</h2><p>{text}</p></div>;
}

createRoot(document.getElementById("root")!).render(<App />);
