import { AiExplainPayload, AuthPayload, ProgressState, QuestionBank, User } from "../types";

export type Session = {
  token: string;
  user: User | null;
};

async function jsonRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || `请求失败：${response.status}`);
  return data as T;
}

export function authHeaders(token: string): HeadersInit {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function fetchQuestionBank(): Promise<QuestionBank> {
  const response = await fetch("/question-bank.json");
  if (!response.ok) throw new Error(`题库加载失败：${response.status}`);
  return response.json();
}

export function login(username: string, password: string): Promise<AuthPayload> {
  return jsonRequest<AuthPayload>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password })
  });
}

export function register(username: string, password: string): Promise<AuthPayload> {
  return jsonRequest<AuthPayload>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ username, password })
  });
}

export function me(token: string): Promise<{ ok: boolean; user: User; stats: unknown }> {
  return jsonRequest("/api/auth/me", { headers: authHeaders(token) });
}

export function logout(token: string): Promise<{ ok: boolean }> {
  return jsonRequest("/api/auth/logout", { method: "POST", headers: authHeaders(token) });
}

export function saveRemoteProgress(token: string, progress: ProgressState): Promise<{ ok: boolean; stats: unknown }> {
  return jsonRequest("/api/progress", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ stats: progress })
  });
}

export function explainQuestion(payload: {
  question: string;
  options: Array<{ key: string; text: string }>;
  answer: string;
  chapter: string;
}): Promise<AiExplainPayload> {
  return jsonRequest<AiExplainPayload>("/api/ai/explain", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function analyzeExam(payload: {
  total: number;
  answered: number;
  correct: number;
  pass_score?: number;
  chapter_stats: Record<string, { total: number; wrong: number }>;
  wrong_items: Array<{
    chapter: string;
    question: string;
    user_answer: string;
    correct_answer: string;
  }>;
}): Promise<AiExplainPayload> {
  return jsonRequest<AiExplainPayload>("/api/ai/exam-analysis", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}
