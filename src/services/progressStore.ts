import {
  ANSWER_HISTORY_LIMIT,
  PROGRESS_SCHEMA_VERSION,
  ProgressState,
  QuestionProgress,
  LegacyQuestionProgress,
  WRONG_CLEAR_STREAK
} from "../types";

const EMPTY_PROGRESS: ProgressState = {
  progressSchemaVersion: PROGRESS_SCHEMA_VERSION,
  questions: {},
  settings: {
    wrongClearStreak: WRONG_CLEAR_STREAK
  },
  examRecords: []
};

export function createQuestionProgress(): QuestionProgress {
  return {
    answerHistory: [],
    attempts: 0,
    wrongCount: 0,
    correctStreak: 0,
    favorite: false,
    weak: false,
    lastAnswer: "",
    lastCorrect: null,
    lastAnsweredAt: 0
  };
}

function isLegacyQuestionProgress(value: unknown): value is LegacyQuestionProgress {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return "answer" in item || "correct" in item || "updated_at" in item;
}

export function normalizeTimestamp(value: unknown): number {
  const raw = Number(value || 0);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return raw > 10_000_000_000 ? raw : raw * 1000;
}

export function migrateProgress(input: unknown): ProgressState {
  if (!input || typeof input !== "object") return structuredClone(EMPTY_PROGRESS);
  const raw = input as Record<string, unknown>;

  if (raw.progressSchemaVersion === PROGRESS_SCHEMA_VERSION && raw.questions && typeof raw.questions === "object") {
    const questions: Record<string, QuestionProgress> = {};
    for (const [id, value] of Object.entries(raw.questions as Record<string, unknown>)) {
      const item = value as Partial<QuestionProgress>;
      const base = createQuestionProgress();
      questions[id] = {
        ...base,
        ...item,
        answerHistory: Array.isArray(item.answerHistory) ? item.answerHistory.slice(-ANSWER_HISTORY_LIMIT) : [],
        attempts: Number(item.attempts || 0),
        wrongCount: Number(item.wrongCount || 0),
        correctStreak: Number(item.correctStreak || 0),
        favorite: Boolean(item.favorite),
        weak: Boolean(item.weak),
        lastAnswer: String(item.lastAnswer || ""),
        lastCorrect: typeof item.lastCorrect === "boolean" ? item.lastCorrect : null,
        lastAnsweredAt: normalizeTimestamp(item.lastAnsweredAt)
      };
    }
    return {
      progressSchemaVersion: PROGRESS_SCHEMA_VERSION,
      questions,
      settings: {
        wrongClearStreak: Number((raw.settings as { wrongClearStreak?: number } | undefined)?.wrongClearStreak || WRONG_CLEAR_STREAK)
      },
      examRecords: Array.isArray(raw.examRecords) ? raw.examRecords : []
    };
  }

  const questions: Record<string, QuestionProgress> = {};
  for (const [id, value] of Object.entries(raw)) {
    if (!isLegacyQuestionProgress(value)) continue;
    const answeredAt = normalizeTimestamp(value.updated_at);
    const correct = Boolean(value.correct);
    const answer = String(value.answer || "");
    questions[id] = {
      ...createQuestionProgress(),
      answerHistory: answer ? [{ answer, correct, answeredAt }] : [],
      attempts: answer ? 1 : 0,
      wrongCount: correct ? 0 : 1,
      correctStreak: correct ? 1 : 0,
      lastAnswer: answer,
      lastCorrect: correct,
      lastAnsweredAt: answeredAt
    };
  }

  return {
    ...structuredClone(EMPTY_PROGRESS),
    questions
  };
}

export function serializeForRemote(progress: ProgressState): ProgressState {
  return migrateProgress(progress);
}

export function mergeProgress(local: ProgressState, remoteRaw: unknown): ProgressState {
  const remote = migrateProgress(remoteRaw);
  const merged: ProgressState = {
    progressSchemaVersion: PROGRESS_SCHEMA_VERSION,
    questions: { ...remote.questions },
    settings: local.settings || remote.settings,
    examRecords: [...(remote.examRecords || [])]
  };

  for (const [id, localItem] of Object.entries(local.questions)) {
    const remoteItem = merged.questions[id];
    if (!remoteItem || localItem.lastAnsweredAt >= remoteItem.lastAnsweredAt) {
      merged.questions[id] = localItem;
    } else {
      merged.questions[id] = {
        ...remoteItem,
        favorite: remoteItem.favorite || localItem.favorite,
        weak: remoteItem.weak || localItem.weak
      };
    }
  }

  const seenExams = new Set(merged.examRecords.map((item) => item.id));
  for (const exam of local.examRecords || []) {
    if (!seenExams.has(exam.id)) merged.examRecords.push(exam);
  }
  return merged;
}

export function loadProgress(storage: Storage): ProgressState {
  try {
    return migrateProgress(JSON.parse(storage.getItem("uavQuizStats") || "{}"));
  } catch {
    return migrateProgress({});
  }
}

export function saveProgress(storage: Storage, progress: ProgressState): void {
  storage.setItem("uavQuizStats", JSON.stringify(serializeForRemote(progress)));
}

