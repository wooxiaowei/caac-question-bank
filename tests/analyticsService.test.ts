import test from "node:test";
import assert from "node:assert/strict";
import { buildDashboardStats } from "../src/services/analyticsService";
import { answerQuestion, toggleFavorite } from "../src/services/practiceEngine";
import { migrateProgress } from "../src/services/progressStore";
import { QuestionBank } from "../src/types";

const bank: QuestionBank = {
  title: "题库",
  subtitle: "测试",
  total: 2,
  chapters: [{ name: "飞行手册", count: 2 }],
  questions: [
    { id: "q1", chapter: "飞行手册", type: "单选", stem: "a", options: [{ key: "A", text: "ok" }], answer: "A" },
    { id: "q2", chapter: "飞行手册", type: "单选", stem: "b", options: [{ key: "B", text: "ok" }], answer: "B" }
  ]
};

test("dashboard stats aggregate progress", () => {
  let progress = migrateProgress({});
  progress = answerQuestion(progress, bank.questions[0], "A", new Date("2026-06-26T10:00:00+08:00").getTime());
  progress = answerQuestion(progress, bank.questions[1], "A", new Date("2026-06-26T11:00:00+08:00").getTime());
  progress = toggleFavorite(progress, "q1");
  const stats = buildDashboardStats(bank, progress, new Date("2026-06-26T12:00:00+08:00"));
  assert.equal(stats.total, 2);
  assert.equal(stats.answered, 2);
  assert.equal(stats.correct, 1);
  assert.equal(stats.wrong, 1);
  assert.equal(stats.favorites, 1);
  assert.equal(stats.chapterMastery[0].accuracy, 50);
});

