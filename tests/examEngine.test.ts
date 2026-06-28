import test from "node:test";
import assert from "node:assert/strict";
import { buildExamQuestions, createExamRecord, gradeExam } from "../src/services/examEngine";
import { Question } from "../src/types";

const questions: Question[] = [
  { id: "q1", chapter: "飞行手册", type: "单选", stem: "1", options: [{ key: "A", text: "a" }], answer: "A" },
  { id: "q2", chapter: "飞行手册", type: "单选", stem: "2", options: [{ key: "B", text: "b" }], answer: "B" },
  { id: "q3", chapter: "气象", type: "单选", stem: "3", options: [{ key: "C", text: "c" }], answer: "C" }
];

test("buildExamQuestions respects chapter scope and count", () => {
  const examQuestions = buildExamQuestions(questions, {
    questionCount: 1,
    chapterScope: ["气象"],
    random: false,
    durationMinutes: 30,
    targetAccuracy: 70
  });
  assert.equal(examQuestions.length, 1);
  assert.equal(examQuestions[0].id, "q3");
});

test("gradeExam scores answers and reports weak chapters", () => {
  const result = gradeExam(questions, { q1: "A", q2: "A" });
  assert.equal(result.total, 3);
  assert.equal(result.correct, 1);
  assert.equal(result.accuracy, 33);
  assert.deepEqual(result.wrongQuestionIds, ["q2", "q3"]);
  assert.equal(result.weakChapters[0].chapter, "气象");
  assert.equal(result.weakChapters[1].chapter, "飞行手册");
  assert.equal(result.recommendations.length > 0, true);
});

test("createExamRecord preserves schema v2 compatible fields", () => {
  const result = gradeExam(questions, { q1: "A", q2: "B", q3: "C" });
  const record = createExamRecord(result, ["全部"], 1200, 123456);
  assert.equal(record.id, "exam-123456");
  assert.equal(record.total, 3);
  assert.equal(record.correct, 3);
  assert.equal(record.durationSeconds, 1200);
  assert.deepEqual(record.wrongQuestionIds, []);
});
