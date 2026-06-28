import test from "node:test";
import assert from "node:assert/strict";
import { migrateProgress } from "../src/services/progressStore";
import { answerQuestion, getPracticeQuestions, toggleFavorite, toggleWeak } from "../src/services/practiceEngine";
import { Question } from "../src/types";

const questions: Question[] = [
  { id: "q1", chapter: "飞行手册", type: "单选", stem: "alpha", options: [{ key: "A", text: "ok" }], answer: "A" },
  { id: "q2", chapter: "气象", type: "单选", stem: "bravo", options: [{ key: "B", text: "ok" }], answer: "B" },
  { id: "q3", chapter: "气象", type: "单选", stem: "charlie", options: [{ key: "C", text: "ok" }], answer: "C" }
];

test("answering wrong adds wrong count and answering correctly twice clears it", () => {
  let progress = migrateProgress({});
  progress = answerQuestion(progress, questions[0], "B", 1000);
  assert.equal(progress.questions.q1.wrongCount, 1);
  progress = answerQuestion(progress, questions[0], "A", 2000);
  assert.equal(progress.questions.q1.wrongCount, 1);
  progress = answerQuestion(progress, questions[0], "A", 3000);
  assert.equal(progress.questions.q1.wrongCount, 0);
  assert.equal(progress.questions.q1.correctStreak, 2);
});

test("favorite and weak flags toggle and filters work", () => {
  let progress = migrateProgress({});
  progress = toggleFavorite(progress, "q2");
  progress = toggleWeak(progress, "q3");
  const favorite = getPracticeQuestions({ questions, progress, chapter: "全部", mode: "sequence", filter: "favorite", search: "" });
  const weak = getPracticeQuestions({ questions, progress, chapter: "全部", mode: "sequence", filter: "weak", search: "" });
  assert.deepEqual(favorite.map((q) => q.id), ["q2"]);
  assert.deepEqual(weak.map((q) => q.id), ["q3"]);
});

test("frequent wrong mode sorts by wrong count", () => {
  let progress = migrateProgress({});
  progress = answerQuestion(progress, questions[0], "B", 1000);
  progress = answerQuestion(progress, questions[1], "A", 2000);
  progress = answerQuestion(progress, questions[1], "A", 3000);
  const list = getPracticeQuestions({ questions, progress, chapter: "全部", mode: "frequentWrong", filter: "all", search: "" });
  assert.equal(list[0].id, "q2");
});

