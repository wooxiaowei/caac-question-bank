# CAAC 理论题库练习系统

面向 CAAC 无人机理论考试的练习系统，提供章节刷题、错题整理、收藏/不熟标记、学习数据面板、账号进度同步和 AI 讲解。

当前线上地址：

- 主站：https://caac.gengau.com/
- 后台：https://caac.gengau.com/admin

## 技术栈

- 前端：React 19、Vite、TypeScript、lucide-react
- 后端：FastAPI、SQLite、httpx、Pydantic
- 部署：Docker Compose，多阶段 Docker 构建
- 数据：
  - 题库：`question-bank.json`
  - 用户/会话/进度：`data/users.db`
  - AI 配置：`data/config.json`

## 目录结构

```text
question_bank_site/
  src/
    main.tsx                     # React 应用入口和页面组件
    styles.css                   # 新版前端样式
    types.ts                     # 题库、进度、考试、用户等类型定义
    services/
      apiClient.ts               # 后端 API 调用
      analyticsService.ts        # Dashboard 统计
      practiceEngine.ts          # 答题、筛选、练习模式、错题规则
      progressStore.ts           # 进度 schema、迁移、localStorage 读写
  tests/                         # Node test 单元测试
  server.py                      # FastAPI 后端和静态文件服务
  admin.html / admin.js          # 旧后台，当前保留
  styles.css                     # 旧后台继续使用的样式
  question-bank.json             # 默认题库
  Dockerfile                     # Node 构建前端 + Python 运行后端
  docker-compose.yml             # 8010:80
```

## 核心功能

### 学习练习

- 章节题库练习
- 单选题作答
- 显示正确答案、错误反馈、题库解析
- AI 讲解当前题
- 登录后跨设备同步进度
- URL 保留搜索、章节、模式、筛选状态

### 练习模式

- 顺序练习
- 随机练习
- 只练错题
- 只练收藏
- 未答优先
- 高频错题优先

### 每题学习状态

每道题支持：

- 收藏
- 标记不熟
- 历史答题次数
- 错误次数
- 最近答案
- 连续答对次数

答错后会自动进入错题状态。默认连续答对 2 次后，错题状态自动清除。

### Dashboard

路径：`/dashboard`

显示：

- 总题量
- 已练题量
- 正确率
- 错题数
- 收藏数
- 不熟题数
- 最近 7 天练习量
- 章节掌握度
- 高频错题

没有学习数据时显示引导空状态。

### 后台

路径：`/admin`

当前后台仍使用旧版 `admin.html / admin.js`，用于：

- AI 接口配置
- AI 测试
- 题库上传替换
- 用户列表
- 重置用户密码
- 清空用户进度
- 删除用户

## 数据结构

### 题库结构

```json
{
  "title": "理论题库【多旋翼】",
  "subtitle": "多旋翼 / 超视距刷题题库",
  "generatedAt": "2026-06-26",
  "total": 1205,
  "chapters": [
    { "name": "飞行手册", "count": 44 }
  ],
  "questions": [
    {
      "id": "q0001",
      "sourceNumber": 1,
      "chapter": "飞行手册",
      "type": "单选",
      "stem": "可能需要处置的紧急情况不包括：",
      "options": [
        { "key": "A", "text": "飞控系统故障" }
      ],
      "answer": "A",
      "explanation": ""
    }
  ]
}
```

### 进度结构

当前进度版本为 `progressSchemaVersion = 2`。

旧版 `{ answer, correct, updated_at }` 会自动迁移到新版结构。

```ts
type ProgressState = {
  progressSchemaVersion: 2;
  questions: Record<string, QuestionProgress>;
  settings: {
    wrongClearStreak: number;
  };
  examRecords: ExamRecord[];
};

type QuestionProgress = {
  answerHistory: Array<{
    answer: string;
    correct: boolean;
    answeredAt: number;
  }>;
  attempts: number;
  wrongCount: number;
  correctStreak: number;
  favorite: boolean;
  weak: boolean;
  lastAnswer: string;
  lastCorrect: boolean | null;
  lastAnsweredAt: number;
};
```

每题最多保留最近 20 条答题历史，避免进度 JSON 无限膨胀。

## 本地开发

### 1. 安装前端依赖

```bash
cd question_bank_site
npm install
```

### 2. 启动后端

```bash
cd question_bank_site
python -m uvicorn server:app --host 127.0.0.1 --port 8010
```

### 3. 启动前端开发服务器

```bash
cd question_bank_site
npm run dev
```

Vite 会代理：

- `/api` -> `http://127.0.0.1:8010`
- `/question-bank.json` -> `http://127.0.0.1:8010`

### 4. 生产构建

```bash
npm run build
```

构建产物输出到：

```text
dist/
```

FastAPI 会优先服务 `dist/index.html` 和 `dist/app-assets/*`。

## 测试

```bash
npm run lint
npm run test
npm run build
python -m py_compile server.py
```

当前测试覆盖：

- 旧进度迁移到 schema v2
- 本地/远端进度合并
- 答题正确/错误逻辑
- 错题连续答对自动移除
- 收藏和不熟筛选
- 高频错题排序
- Dashboard 统计

## 部署

服务器路径：

```text
/opt/uav-question-bank
```

Docker Compose：

```bash
cd /opt/uav-question-bank
docker compose up -d --build
```

端口：

```text
8010:80
```

线上由狗云 Nginx 反代到源站：

```text
http://168.138.177.29:8010/
```

域名：

```text
https://caac.gengau.com
```

升级前备份示例：

```text
/tmp/uav-question-bank-backup-before-react.tgz
```

部署时必须保留：

```text
data/
.env
```

这两个包含用户数据、AI 配置和环境变量。

## 环境变量

`.env` 示例：

```env
ADMIN_PASSWORD=your-admin-password
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_API_KEY=your-api-key
AI_MODEL=gpt-4.1-mini
SESSION_DAYS=30
```

## API 概览

认证：

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/auth/logout`

进度：

- `GET /api/progress`
- `POST /api/progress`

AI：

- `POST /api/ai/explain`
- `POST /api/ai/exam-analysis`

后台：

- `POST /api/admin/login`
- `GET /api/admin/config`
- `POST /api/admin/config`
- `POST /api/admin/test-ai`
- `GET /api/admin/users`
- `POST /api/admin/users/{user_id}/reset-password`
- `POST /api/admin/users/{user_id}/clear-progress`
- `POST /api/admin/users/{user_id}/delete`
- `GET /api/admin/question-bank`
- `POST /api/admin/question-bank`

静态：

- `GET /question-bank.json`
- `GET /admin`
- React 路由 fallback：`/`、`/practice`、`/dashboard`

## 已知限制

- 模拟考试独立页尚未实现，当前计划放在 P2。
- 后台仍是旧版原生 HTML/JS，计划 P3 再迁移到 React。
- 后台 token 当前仍等于后台密码，计划 P4 改为独立 admin session。
- 进度目前仍以 JSON 形式保存到 SQLite，后续可拆分为结构化表。
- `npm run test` 当前通过 PowerShell 写入 `.test-build/package.json`，在 Linux CI 上建议改成跨平台 Node 脚本。

## 后续路线

P2：模拟考试

- `/exam` 独立页面
- 自定义题量、时间、章节范围
- 考试中隐藏答案
- 交卷后展示分数、错题、薄弱章节、复习建议
- 考试记录持久化

P3：后台升级

- 后台迁移 React
- 题库上传前校验和预览
- 用户进度详情
- 考试记录查看

P4：部署、安全和性能

- 静态资源缓存策略
- API 字段校验
- 后台独立 session
- 错误日志和基础监控
- 进度数据结构化存储

