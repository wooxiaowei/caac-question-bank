import {
  ANSWER_HISTORY_LIMIT,
  ALL_CHAPTER,
  PracticeMode,
  ProgressState,
  Question,
  QuestionFilter
} from "../types";
import { createQuestionProgress } from "./progressStore";

export function answerQuestion(progress: ProgressState, question: Question, answer: string, now = Date.now()): ProgressState {
  const current = progress.questions[question.id] || createQuestionProgress();
  const correct = answer === question.answer;
  const correctStreak = correct ? current.correctStreak + 1 : 0;
  const wrongCount = correct ? current.wrongCount : current.wrongCount + 1;
  const shouldClearWrong = correct && correctStreak >= progress.settings.wrongClearStreak;
  return {
    ...progress,
    questions: {
      ...progress.questions,
      [question.id]: {
        ...current,
        answerHistory: [...current.answerHistory, { answer, correct, answeredAt: now }].slice(-ANSWER_HISTORY_LIMIT),
        attempts: current.attempts + 1,
        wrongCount: shouldClearWrong ? 0 : wrongCount,
        correctStreak,
        lastAnswer: answer,
        lastCorrect: correct,
        lastAnsweredAt: now
      }
    }
  };
}

export function toggleFavorite(progress: ProgressState, questionId: string): ProgressState {
  const current = progress.questions[questionId] || createQuestionProgress();
  return {
    ...progress,
    questions: {
      ...progress.questions,
      [questionId]: { ...current, favorite: !current.favorite }
    }
  };
}

export function toggleWeak(progress: ProgressState, questionId: string): ProgressState {
  const current = progress.questions[questionId] || createQuestionProgress();
  return {
    ...progress,
    questions: {
      ...progress.questions,
      [questionId]: { ...current, weak: !current.weak }
    }
  };
}

function matchesFilter(question: Question, progress: ProgressState, filter: QuestionFilter): boolean {
  const item = progress.questions[question.id];
  if (filter === "all") return true;
  if (filter === "answered") return Boolean(item?.attempts);
  if (filter === "unanswered") return !item?.attempts;
  if (filter === "wrong") return Boolean(item?.wrongCount);
  if (filter === "favorite") return Boolean(item?.favorite);
  if (filter === "weak") return Boolean(item?.weak);
  return true;
}

function matchesSearch(question: Question, keyword: string): boolean {
  const q = keyword.trim().toLowerCase();
  if (!q) return true;
  const options = question.options.map((option) => `${option.key} ${option.text}`).join(" ");
  return `${question.chapter} ${question.stem} ${options}`.toLowerCase().includes(q);
}

function deterministicShuffle<T>(items: T[], seed: string): T[] {
  let hash = 2166136261;
  for (const char of seed) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  const copy = items.map((item, index) => ({ item, score: Math.sin(hash + index * 9999) }));
  return copy.sort((a, b) => a.score - b.score).map((entry) => entry.item);
}

export function getPracticeQuestions(params: {
  questions: Question[];
  progress: ProgressState;
  chapter: string;
  mode: PracticeMode;
  filter: QuestionFilter;
  search: string;
  randomSeed?: string;
}): Question[] {
  const { questions, progress, chapter, mode, filter, search, randomSeed = "caac" } = params;
  let list = questions.filter((question) => chapter === ALL_CHAPTER || question.chapter === chapter);
  list = list.filter((question) => matchesSearch(question, search));
  list = list.filter((question) => matchesFilter(question, progress, filter));

  if (mode === "wrong") list = list.filter((question) => Boolean(progress.questions[question.id]?.wrongCount));
  if (mode === "favorite") list = list.filter((question) => Boolean(progress.questions[question.id]?.favorite));
  if (mode === "unanswered") {
    list = list.sort((a, b) => Number(Boolean(progress.questions[a.id]?.attempts)) - Number(Boolean(progress.questions[b.id]?.attempts)));
  }
  if (mode === "frequentWrong") {
    list = list.sort((a, b) => {
      const pa = progress.questions[a.id];
      const pb = progress.questions[b.id];
      return (pb?.wrongCount || 0) - (pa?.wrongCount || 0) || (pb?.lastAnsweredAt || 0) - (pa?.lastAnsweredAt || 0);
    });
  }
  if (mode === "random") list = deterministicShuffle(list, `${randomSeed}:${search}:${chapter}:${filter}`);
  return list;
}

export function getWrongCount(progress: ProgressState): number {
  return Object.values(progress.questions).filter((item) => item.wrongCount > 0).length;
}

