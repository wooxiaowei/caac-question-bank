import { ALL_CHAPTER, ExamRecord, Question } from "../types";

export type ExamConfig = {
  questionCount: number;
  chapterScope: string[];
  random: boolean;
  durationMinutes: number;
  targetAccuracy: number;
};

export type ExamResult = {
  total: number;
  correct: number;
  accuracy: number;
  wrongQuestionIds: string[];
  weakChapters: Array<{ chapter: string; total: number; wrong: number; accuracy: number }>;
  recommendations: string[];
};

function deterministicShuffle<T>(items: T[], seed: string): T[] {
  let hash = 2166136261;
  for (const char of seed) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return items
    .map((item, index) => ({ item, score: Math.sin(hash + index * 9999) }))
    .sort((a, b) => a.score - b.score)
    .map((entry) => entry.item);
}

export function buildExamQuestions(questions: Question[], config: ExamConfig, seed = "caac-exam"): Question[] {
  const scoped = config.chapterScope.length && !config.chapterScope.includes(ALL_CHAPTER)
    ? questions.filter((question) => config.chapterScope.includes(question.chapter))
    : questions;
  const ordered = config.random ? deterministicShuffle(scoped, seed) : scoped;
  return ordered.slice(0, Math.max(1, Math.min(config.questionCount, ordered.length)));
}

export function gradeExam(questions: Question[], answers: Record<string, string>): ExamResult {
  const total = questions.length;
  const correct = questions.filter((question) => answers[question.id] === question.answer).length;
  const wrongQuestions = questions.filter((question) => answers[question.id] !== question.answer);
  const byChapter = new Map<string, { total: number; wrong: number }>();

  for (const question of questions) {
    const row = byChapter.get(question.chapter) || { total: 0, wrong: 0 };
    row.total += 1;
    if (answers[question.id] !== question.answer) row.wrong += 1;
    byChapter.set(question.chapter, row);
  }

  const weakChapters = [...byChapter.entries()]
    .map(([chapter, item]) => ({
      chapter,
      total: item.total,
      wrong: item.wrong,
      accuracy: item.total ? Math.round(((item.total - item.wrong) / item.total) * 100) : 0
    }))
    .filter((item) => item.wrong > 0)
    .sort((a, b) => b.wrong - a.wrong || a.accuracy - b.accuracy)
    .slice(0, 5);

  const recommendations = weakChapters.length
    ? weakChapters.map((item) => `优先复习「${item.chapter}」，本次错 ${item.wrong}/${item.total} 题。`)
    : ["本次没有错题，可以提高题量或切换随机章节继续保持。"];

  return {
    total,
    correct,
    accuracy: total ? Math.round((correct / total) * 100) : 0,
    wrongQuestionIds: wrongQuestions.map((question) => question.id),
    weakChapters,
    recommendations
  };
}

export function createExamRecord(result: ExamResult, chapterScope: string[], durationSeconds: number, now = Date.now()): ExamRecord {
  return {
    id: `exam-${now}`,
    createdAt: now,
    total: result.total,
    correct: result.correct,
    durationSeconds,
    chapterScope: chapterScope.length ? chapterScope : [ALL_CHAPTER],
    wrongQuestionIds: result.wrongQuestionIds
  };
}
