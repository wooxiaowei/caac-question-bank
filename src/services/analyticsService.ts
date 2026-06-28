import { ALL_CHAPTER, DashboardStats, ProgressState, Question, QuestionBank } from "../types";

function dateLabel(offset: number, now: Date): string {
  const date = new Date(now);
  date.setDate(now.getDate() - offset);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

export function buildDashboardStats(bank: QuestionBank, progress: ProgressState, now = new Date()): DashboardStats {
  const questionProgress = progress.questions;
  const answered = Object.values(questionProgress).filter((item) => item.attempts > 0).length;
  const correct = Object.values(questionProgress).filter((item) => item.lastCorrect === true).length;
  const wrong = Object.values(questionProgress).filter((item) => item.wrongCount > 0).length;
  const favorites = Object.values(questionProgress).filter((item) => item.favorite).length;
  const weak = Object.values(questionProgress).filter((item) => item.weak).length;

  const recentDays = Array.from({ length: 7 }, (_, idx) => {
    const offset = 6 - idx;
    const label = dateLabel(offset, now);
    const date = new Date(now);
    date.setDate(now.getDate() - offset);
    const start = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    const end = start + 86400_000;
    let count = 0;
    let dayCorrect = 0;
    for (const item of Object.values(questionProgress)) {
      for (const record of item.answerHistory) {
        if (record.answeredAt >= start && record.answeredAt < end) {
          count += 1;
          if (record.correct) dayCorrect += 1;
        }
      }
    }
    return { label, count, correct: dayCorrect };
  });

  const byChapter = new Map<string, Question[]>();
  for (const question of bank.questions) {
    const list = byChapter.get(question.chapter) || [];
    list.push(question);
    byChapter.set(question.chapter, list);
  }
  const chapterMastery = [...byChapter.entries()].map(([chapter, questions]) => {
    let chapterAnswered = 0;
    let chapterCorrect = 0;
    for (const question of questions) {
      const item = questionProgress[question.id];
      if (item?.attempts) {
        chapterAnswered += 1;
        if (item.lastCorrect) chapterCorrect += 1;
      }
    }
    return {
      chapter: chapter || ALL_CHAPTER,
      total: questions.length,
      answered: chapterAnswered,
      correct: chapterCorrect,
      accuracy: chapterAnswered ? Math.round((chapterCorrect / chapterAnswered) * 100) : null
    };
  });

  return {
    total: bank.total || bank.questions.length,
    answered,
    correct,
    wrong,
    favorites,
    weak,
    accuracy: answered ? Math.round((correct / answered) * 100) : 0,
    recentDays,
    chapterMastery
  };
}

