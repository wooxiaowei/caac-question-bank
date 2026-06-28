import test from "node:test";
import assert from "node:assert/strict";
import { migrateProgress, mergeProgress } from "../src/services/progressStore";

test("migrates legacy progress into schema v2", () => {
  const progress = migrateProgress({
    q1: { answer: "A", correct: false, updated_at: 1000 },
    q2: { answer: "B", correct: true, updated_at: 2000 }
  });
  assert.equal(progress.progressSchemaVersion, 2);
  assert.equal(progress.questions.q1.wrongCount, 1);
  assert.equal(progress.questions.q1.correctStreak, 0);
  assert.equal(progress.questions.q2.correctStreak, 1);
  assert.equal(progress.questions.q2.lastAnsweredAt, 2_000_000);
});

test("merge keeps newer answer and preserves local flags", () => {
  const local = migrateProgress({
    progressSchemaVersion: 2,
    questions: {
      q1: {
        answerHistory: [],
        attempts: 1,
        wrongCount: 0,
        correctStreak: 1,
        favorite: true,
        weak: false,
        lastAnswer: "A",
        lastCorrect: true,
        lastAnsweredAt: 2000
      }
    },
    settings: { wrongClearStreak: 2 },
    examRecords: []
  });
  const merged = mergeProgress(local, {
    progressSchemaVersion: 2,
    questions: {
      q1: {
        answerHistory: [],
        attempts: 1,
        wrongCount: 1,
        correctStreak: 0,
        favorite: false,
        weak: true,
        lastAnswer: "B",
        lastCorrect: false,
        lastAnsweredAt: 1000
      }
    },
    settings: { wrongClearStreak: 2 },
    examRecords: []
  });
  assert.equal(merged.questions.q1.lastAnswer, "A");
  assert.equal(merged.questions.q1.favorite, true);
});

