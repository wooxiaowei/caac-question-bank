export const ALL_CHAPTER = "全部";
export const PROGRESS_SCHEMA_VERSION = 2;
export const WRONG_CLEAR_STREAK = 2;
export const ANSWER_HISTORY_LIMIT = 20;

export type QuestionOption = {
  key: string;
  text: string;
};

export type Question = {
  id: string;
  sourceNumber?: number;
  chapter: string;
  type: string;
  stem: string;
  options: QuestionOption[];
  answer: string;
  explanation?: string;
};

export type ChapterSummary = {
  name: string;
  count: number;
};

export type QuestionBank = {
  title: string;
  subtitle: string;
  sourceFile?: string;
  generatedAt?: string;
  total: number;
  chapters: ChapterSummary[];
  questions: Question[];
};

export type AnswerRecord = {
  answer: string;
  correct: boolean;
  answeredAt: number;
};

export type QuestionProgress = {
  answerHistory: AnswerRecord[];
  attempts: number;
  wrongCount: number;
  correctStreak: number;
  favorite: boolean;
  weak: boolean;
  lastAnswer: string;
  lastCorrect: boolean | null;
  lastAnsweredAt: number;
};

export type ProgressState = {
  progressSchemaVersion: 2;
  questions: Record<string, QuestionProgress>;
  settings: {
    wrongClearStreak: number;
  };
  examRecords: ExamRecord[];
};

export type LegacyQuestionProgress = {
  answer?: string;
  correct?: boolean;
  updated_at?: number;
};

export type PracticeMode =
  | "sequence"
  | "random"
  | "wrong"
  | "favorite"
  | "unanswered"
  | "frequentWrong";

export type QuestionFilter = "all" | "answered" | "unanswered" | "wrong" | "favorite" | "weak";

export type ExamRecord = {
  id: string;
  createdAt: number;
  total: number;
  correct: number;
  durationSeconds?: number;
  chapterScope: string[];
  wrongQuestionIds: string[];
};

export type User = {
  id: number;
  username: string;
  created_at: number;
};

export type AuthPayload = {
  ok: boolean;
  token: string;
  user: User;
  stats: unknown;
};

export type AiExplainPayload = {
  ok: boolean;
  model: string;
  content: string;
};

export type DashboardStats = {
  total: number;
  answered: number;
  correct: number;
  wrong: number;
  favorites: number;
  weak: number;
  accuracy: number;
  recentDays: Array<{ label: string; count: number; correct: number }>;
  chapterMastery: Array<{ chapter: string; total: number; answered: number; correct: number; accuracy: number | null }>;
};

