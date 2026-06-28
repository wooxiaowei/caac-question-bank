import os
import shutil
import hashlib
import hmac
import json
import secrets
import sqlite3
import time
from pathlib import Path
from typing import Any

import httpx
from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel


BASE_DIR = Path(__file__).resolve().parent
DIST_DIR = BASE_DIR / "dist"
DATA_DIR = Path(os.getenv("DATA_DIR", BASE_DIR / "data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)
CONFIG_FILE = DATA_DIR / "config.json"
QUESTION_BANK_FILE = DATA_DIR / "question-bank.json"
DB_FILE = DATA_DIR / "users.db"
DEFAULT_QUESTION_BANK_FILE = BASE_DIR / "question-bank.json"
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", os.getenv("BASIC_AUTH_PASSWORD", "admin"))
SESSION_DAYS = int(os.getenv("SESSION_DAYS", "30"))
DEFAULT_CONFIG = {
    "openai_base_url": os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1"),
    "openai_api_key": os.getenv("OPENAI_API_KEY", ""),
    "ai_model": os.getenv("AI_MODEL", "gpt-4.1-mini"),
}

if not QUESTION_BANK_FILE.exists() and DEFAULT_QUESTION_BANK_FILE.exists():
    shutil.copyfile(DEFAULT_QUESTION_BANK_FILE, QUESTION_BANK_FILE)

app = FastAPI(title="UAV Question Bank")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


def no_cache_file(path: Path, media_type: str | None = None) -> FileResponse:
    return FileResponse(
        path,
        media_type=media_type,
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            "Pragma": "no-cache",
            "Expires": "0",
        },
    )


class ExplainRequest(BaseModel):
    question: str
    options: list[dict[str, str]]
    answer: str
    chapter: str = ""
    mode: str = "explain"


class ExamWrongItem(BaseModel):
    chapter: str = ""
    question: str = ""
    user_answer: str = ""
    correct_answer: str = ""


class ExamAnalysisRequest(BaseModel):
    total: int
    answered: int
    correct: int
    pass_score: int = 90
    chapter_stats: dict[str, dict[str, int]] = {}
    wrong_items: list[ExamWrongItem] = []


class LoginRequest(BaseModel):
    password: str


class UserAuthRequest(BaseModel):
    username: str
    password: str


class ProgressRequest(BaseModel):
    stats: dict[str, Any] = {}


class AdminPasswordResetRequest(BaseModel):
    password: str


class AiConfigRequest(BaseModel):
    openai_base_url: str = "https://api.openai.com/v1"
    openai_api_key: str = ""
    ai_model: str = "gpt-4.1-mini"


def read_config() -> dict[str, str]:
    if CONFIG_FILE.exists():
      try:
          import json
          data = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
          return {**DEFAULT_CONFIG, **{k: str(v) for k, v in data.items()}}
      except Exception:
          return DEFAULT_CONFIG.copy()
    return DEFAULT_CONFIG.copy()


def write_config(config: dict[str, str]) -> None:
    CONFIG_FILE.write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8")


def db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                salt TEXT NOT NULL,
                created_at INTEGER NOT NULL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                expires_at INTEGER NOT NULL,
                created_at INTEGER NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS progress (
                user_id INTEGER PRIMARY KEY,
                stats_json TEXT NOT NULL DEFAULT '{}',
                updated_at INTEGER NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        """)


init_db()


def normalize_username(username: str) -> str:
    username = username.strip().lower()
    if len(username) < 3 or len(username) > 32:
        raise HTTPException(status_code=400, detail="用户名需要 3-32 个字符。")
    if not all(ch.isalnum() or ch in "._-" for ch in username):
        raise HTTPException(status_code=400, detail="用户名只能包含字母、数字、点、下划线或短横线。")
    return username


def validate_password(password: str) -> None:
    if len(password) < 6 or len(password) > 72:
        raise HTTPException(status_code=400, detail="密码需要 6-72 个字符。")


def hash_password(password: str, salt: str) -> str:
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 120_000).hex()


def public_user(row: sqlite3.Row) -> dict[str, Any]:
    return {"id": row["id"], "username": row["username"], "created_at": row["created_at"]}


def create_session(user_id: int) -> str:
    token = secrets.token_urlsafe(32)
    now = int(time.time())
    expires_at = now + SESSION_DAYS * 86400
    with db() as conn:
        conn.execute(
            "INSERT INTO sessions(token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
            (token, user_id, expires_at, now),
        )
    return token


def current_user(authorization: str | None) -> sqlite3.Row:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="请先登录。")
    token = authorization.removeprefix("Bearer ").strip()
    now = int(time.time())
    with db() as conn:
        row = conn.execute(
            """
            SELECT users.*
            FROM sessions
            JOIN users ON users.id = sessions.user_id
            WHERE sessions.token = ? AND sessions.expires_at > ?
            """,
            (token, now),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=401, detail="登录已过期，请重新登录。")
        return row


def read_user_progress(user_id: int) -> dict[str, Any]:
    with db() as conn:
        row = conn.execute("SELECT stats_json FROM progress WHERE user_id = ?", (user_id,)).fetchone()
    if not row:
        return {}
    try:
        data = json.loads(row["stats_json"])
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def write_user_progress(user_id: int, stats: dict[str, Any]) -> None:
    now = int(time.time())
    raw = json.dumps(stats, ensure_ascii=False, separators=(",", ":"))
    with db() as conn:
        conn.execute(
            """
            INSERT INTO progress(user_id, stats_json, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET stats_json = excluded.stats_json, updated_at = excluded.updated_at
            """,
            (user_id, raw, now),
        )


def progress_summary(stats: dict[str, Any]) -> dict[str, int]:
    answered = len(stats)
    wrong = 0
    latest = 0
    for item in stats.values():
        if isinstance(item, dict):
            if not item.get("correct"):
                wrong += 1
            latest = max(latest, int(item.get("updated_at") or 0))
    return {
        "answered": answered,
        "correct": answered - wrong,
        "wrong": wrong,
        "latest_answer_at": latest,
    }


def check_admin(auth: str | None) -> None:
    if not ADMIN_PASSWORD:
        raise HTTPException(status_code=500, detail="服务器未配置后台密码。")
    if auth != f"Bearer {ADMIN_PASSWORD}":
        raise HTTPException(status_code=401, detail="后台密码错误或未登录。")


def public_config(config: dict[str, str]) -> dict[str, Any]:
    return {
        "openai_base_url": config.get("openai_base_url", ""),
        "ai_model": config.get("ai_model", ""),
        "api_key_configured": bool(config.get("openai_api_key", "")),
    }


def option_text(options: list[dict[str, str]]) -> str:
    lines = []
    for option in options:
        key = str(option.get("key", "")).strip()
        text = str(option.get("text", "")).strip()
        if key and text:
            lines.append(f"{key}. {text}")
    return "\n".join(lines)


async def chat_completion(messages: list[dict[str, str]]) -> str:
    config = read_config()
    base_url = config.get("openai_base_url", "https://api.openai.com/v1").rstrip("/")
    api_key = config.get("openai_api_key", "")
    model = config.get("ai_model", "gpt-4.1-mini")
    if not api_key:
        raise HTTPException(status_code=500, detail="服务器未配置 OPENAI_API_KEY。")
    url = f"{base_url}/chat/completions"
    payload: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "temperature": 0.2,
        "max_tokens": 900,
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=60) as client:
        response = await client.post(url, headers=headers, json=payload)
    if response.status_code >= 400:
        text = response.text[:500]
        raise HTTPException(status_code=502, detail=f"AI 接口失败：{response.status_code} {text}")
    data = response.json()
    return data["choices"][0]["message"]["content"].strip()


@app.get("/api/health")
def health():
    config = read_config()
    return {
        "ok": True,
        "model": config.get("ai_model", ""),
        "base_url": config.get("openai_base_url", ""),
        "configured": bool(config.get("openai_api_key", "")),
    }


@app.post("/api/auth/register")
def register(req: UserAuthRequest):
    username = normalize_username(req.username)
    validate_password(req.password)
    salt = secrets.token_hex(16)
    password_hash = hash_password(req.password, salt)
    now = int(time.time())
    try:
        with db() as conn:
            cursor = conn.execute(
                "INSERT INTO users(username, password_hash, salt, created_at) VALUES (?, ?, ?, ?)",
                (username, password_hash, salt, now),
            )
            user_id = int(cursor.lastrowid)
            user = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    except sqlite3.IntegrityError as exc:
        raise HTTPException(status_code=409, detail="用户名已存在。") from exc
    token = create_session(user_id)
    return {"ok": True, "token": token, "user": public_user(user), "stats": {}}


@app.post("/api/auth/login")
def user_login(req: UserAuthRequest):
    username = normalize_username(req.username)
    with db() as conn:
        user = conn.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
    if not user:
        raise HTTPException(status_code=401, detail="用户名或密码错误。")
    password_hash = hash_password(req.password, user["salt"])
    if not hmac.compare_digest(password_hash, user["password_hash"]):
        raise HTTPException(status_code=401, detail="用户名或密码错误。")
    token = create_session(int(user["id"]))
    return {"ok": True, "token": token, "user": public_user(user), "stats": read_user_progress(int(user["id"]))}


@app.get("/api/auth/me")
def auth_me(authorization: str | None = Header(default=None)):
    user = current_user(authorization)
    return {"ok": True, "user": public_user(user), "stats": read_user_progress(int(user["id"]))}


@app.post("/api/auth/logout")
def auth_logout(authorization: str | None = Header(default=None)):
    if authorization and authorization.startswith("Bearer "):
        token = authorization.removeprefix("Bearer ").strip()
        with db() as conn:
            conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
    return {"ok": True}


@app.get("/api/progress")
def get_progress(authorization: str | None = Header(default=None)):
    user = current_user(authorization)
    return {"ok": True, "stats": read_user_progress(int(user["id"]))}


@app.post("/api/progress")
def save_progress(req: ProgressRequest, authorization: str | None = Header(default=None)):
    user = current_user(authorization)
    if len(json.dumps(req.stats, ensure_ascii=False)) > 2_000_000:
        raise HTTPException(status_code=413, detail="进度数据过大。")
    write_user_progress(int(user["id"]), req.stats)
    return {"ok": True, "stats": req.stats}


@app.post("/api/admin/login")
def admin_login(req: LoginRequest):
    if req.password != ADMIN_PASSWORD:
        raise HTTPException(status_code=401, detail="后台密码错误。")
    return {"ok": True}


@app.get("/api/admin/config")
def admin_get_config(authorization: str | None = Header(default=None)):
    check_admin(authorization)
    return {"ok": True, "config": public_config(read_config())}


@app.post("/api/admin/config")
def admin_save_config(req: AiConfigRequest, authorization: str | None = Header(default=None)):
    check_admin(authorization)
    config = {
        "openai_base_url": req.openai_base_url.strip().rstrip("/") or "https://api.openai.com/v1",
        "openai_api_key": req.openai_api_key.strip(),
        "ai_model": req.ai_model.strip() or "gpt-4.1-mini",
    }
    write_config(config)
    return {"ok": True, "config": public_config(config)}


@app.post("/api/admin/test-ai")
async def admin_test_ai(authorization: str | None = Header(default=None)):
    check_admin(authorization)
    content = await chat_completion([
        {"role": "system", "content": "你是简洁的接口测试助手。"},
        {"role": "user", "content": "回复：AI 接口测试成功"},
    ])
    return {"ok": True, "content": content[:300], "config": public_config(read_config())}


@app.get("/api/admin/users")
def admin_users(authorization: str | None = Header(default=None)):
    check_admin(authorization)
    with db() as conn:
        rows = conn.execute(
            """
            SELECT users.id, users.username, users.created_at, progress.stats_json, progress.updated_at,
                   COUNT(sessions.token) AS session_count
            FROM users
            LEFT JOIN progress ON progress.user_id = users.id
            LEFT JOIN sessions ON sessions.user_id = users.id AND sessions.expires_at > ?
            GROUP BY users.id
            ORDER BY users.created_at DESC
            """,
            (int(time.time()),),
        ).fetchall()
    users = []
    for row in rows:
        try:
            stats = json.loads(row["stats_json"] or "{}")
            if not isinstance(stats, dict):
                stats = {}
        except Exception:
            stats = {}
        users.append({
            "id": row["id"],
            "username": row["username"],
            "created_at": row["created_at"],
            "progress_updated_at": row["updated_at"] or 0,
            "session_count": row["session_count"],
            **progress_summary(stats),
        })
    return {"ok": True, "users": users}


@app.post("/api/admin/users/{user_id}/reset-password")
def admin_reset_user_password(user_id: int, req: AdminPasswordResetRequest, authorization: str | None = Header(default=None)):
    check_admin(authorization)
    validate_password(req.password)
    salt = secrets.token_hex(16)
    password_hash = hash_password(req.password, salt)
    with db() as conn:
        cursor = conn.execute(
            "UPDATE users SET password_hash = ?, salt = ? WHERE id = ?",
            (password_hash, salt, user_id),
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="用户不存在。")
        conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
    return {"ok": True}


@app.post("/api/admin/users/{user_id}/clear-progress")
def admin_clear_user_progress(user_id: int, authorization: str | None = Header(default=None)):
    check_admin(authorization)
    with db() as conn:
        exists = conn.execute("SELECT id FROM users WHERE id = ?", (user_id,)).fetchone()
        if not exists:
            raise HTTPException(status_code=404, detail="用户不存在。")
        conn.execute("DELETE FROM progress WHERE user_id = ?", (user_id,))
    return {"ok": True}


@app.post("/api/admin/users/{user_id}/delete")
def admin_delete_user(user_id: int, authorization: str | None = Header(default=None)):
    check_admin(authorization)
    with db() as conn:
        cursor = conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="用户不存在。")
        conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
        conn.execute("DELETE FROM progress WHERE user_id = ?", (user_id,))
    return {"ok": True}


@app.get("/api/admin/question-bank")
def admin_question_bank(authorization: str | None = Header(default=None)):
    check_admin(authorization)
    import json
    data = json.loads(QUESTION_BANK_FILE.read_text(encoding="utf-8"))
    return {
        "ok": True,
        "title": data.get("title", ""),
        "subtitle": data.get("subtitle", ""),
        "total": data.get("total", len(data.get("questions", []))),
        "chapters": data.get("chapters", []),
        "sourceFile": data.get("sourceFile", ""),
        "generatedAt": data.get("generatedAt", ""),
    }


@app.post("/api/admin/question-bank")
async def admin_upload_question_bank(file: UploadFile = File(...), authorization: str | None = Header(default=None)):
    check_admin(authorization)
    if not file.filename.lower().endswith(".json"):
        raise HTTPException(status_code=400, detail="请上传 JSON 题库文件。")
    raw = await file.read()
    try:
        import json
        data = json.loads(raw.decode("utf-8"))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"JSON 解析失败：{exc}") from exc
    if not isinstance(data.get("questions"), list):
        raise HTTPException(status_code=400, detail="题库 JSON 必须包含 questions 数组。")
    data["total"] = len(data["questions"])
    QUESTION_BANK_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return {
        "ok": True,
        "title": data.get("title", ""),
        "total": data["total"],
        "chapters": data.get("chapters", []),
    }


@app.post("/api/ai/explain")
async def explain(req: ExplainRequest):
    if not req.question.strip():
        raise HTTPException(status_code=400, detail="题目不能为空。")
    prompt = f"""你是无人机 CAAC 多旋翼/超视距理论考试辅导老师。
请用中文帮助学生理解这道单选题，要求：
1. 先给结论：正确答案是什么，为什么。
2. 逐项解释 A/B/C/D，说明错在哪里或对在哪里。
3. 提炼一个易记口诀或考点。
4. 不要编造法规条文编号，不确定就说按考试常见理解。

章节：{req.chapter or "未标注"}
题目：{req.question}
选项：
{option_text(req.options)}
正确答案：{req.answer}
"""
    content = await chat_completion([
        {"role": "system", "content": "你擅长把考试题讲得短、准、好记。"},
        {"role": "user", "content": prompt},
    ])
    return {"ok": True, "model": read_config().get("ai_model", ""), "content": content}


@app.post("/api/ai/exam-analysis")
async def exam_analysis(req: ExamAnalysisRequest):
    if req.total <= 0:
        raise HTTPException(status_code=400, detail="考试题量不能为空。")
    wrong_count = max(req.total - req.correct, 0)
    unanswered = max(req.total - req.answered, 0)
    rate = round(req.correct / req.total * 100)
    chapter_lines = []
    for chapter, stat in sorted(req.chapter_stats.items(), key=lambda item: item[1].get("wrong", 0), reverse=True):
        total = int(stat.get("total", 0))
        wrong = int(stat.get("wrong", 0))
        if total:
            chapter_lines.append(f"- {chapter}: 共 {total} 题，错 {wrong} 题")
    wrong_lines = []
    for item in req.wrong_items[:20]:
        wrong_lines.append(
            f"- [{item.chapter or '未标注'}] {item.question[:90]} | 你的答案: {item.user_answer or '未答'} | 正确答案: {item.correct_answer}"
        )
    prompt = f"""请作为 CAAC 无人机多旋翼超视距理论考试教练，分析这份模拟考试答卷。

考试概况：
- 总题量：{req.total}
- 已作答：{req.answered}
- 未作答：{unanswered}
- 正确：{req.correct}
- 错误：{wrong_count}
- 得分率：{rate}%
- 及格线：{req.pass_score} 分

章节错题分布：
{chr(10).join(chapter_lines) or "- 暂无错题"}

典型错题：
{chr(10).join(wrong_lines) or "- 暂无错题"}

请用中文输出，要求：
1. 先给一句总体判断。
2. 分析薄弱章节和可能原因。
3. 给 3-5 条后续复习建议，要具体可执行。
4. 如果已及格，也指出冲刺满分的重点；如果未及格，给出优先补救顺序。
5. 不要编造法规条款编号。
"""
    content = await chat_completion([
        {"role": "system", "content": "你是严谨、简洁、擅长考后诊断的无人机理论考试辅导老师。"},
        {"role": "user", "content": prompt},
    ])
    return {"ok": True, "model": read_config().get("ai_model", ""), "content": content}


@app.get("/question-bank.json")
def question_bank():
    return FileResponse(QUESTION_BANK_FILE, media_type="application/json")


@app.get("/admin")
@app.get("/admin/")
def admin_page():
    return no_cache_file(BASE_DIR / "admin.html")


@app.get("/{path:path}")
def index(path: str = ""):
    safe_root_files = {"admin.html", "admin.js", "styles.css"}
    clean_path = path.strip("/")
    if clean_path:
        root_target = (BASE_DIR / clean_path).resolve()
        parts = Path(clean_path).parts
        if root_target.is_relative_to(BASE_DIR):
            if clean_path in safe_root_files and root_target.exists() and root_target.is_file():
                return FileResponse(root_target)
            if parts and parts[0] == "assets" and root_target.exists() and root_target.is_file():
                return FileResponse(root_target)
    if DIST_DIR.exists():
        dist_target = (DIST_DIR / clean_path).resolve() if clean_path else DIST_DIR / "index.html"
        if clean_path and dist_target.is_relative_to(DIST_DIR) and dist_target.exists() and dist_target.is_file():
            return FileResponse(dist_target)
        index_file = DIST_DIR / "index.html"
        if index_file.exists():
            return no_cache_file(index_file)
    target = (BASE_DIR / clean_path).resolve() if clean_path else BASE_DIR / "index.html"
    if clean_path:
        parts = Path(clean_path).parts
        if target.is_relative_to(BASE_DIR):
            if clean_path in safe_root_files and target.exists() and target.is_file():
                return FileResponse(target)
            if parts and parts[0] == "assets" and target.exists() and target.is_file():
                return FileResponse(target)
    return no_cache_file(BASE_DIR / "index.html")
