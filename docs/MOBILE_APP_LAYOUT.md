# 移动端 App 化布局说明

本文档记录 CAAC 理论题库练习系统当前移动端 App 化改造的真实状态，便于后续维护、测试和继续优化。

## 目标

移动端不再只是桌面端缩放版，而是采用接近学习 App 的使用体验：

- 顶部固定 App Header
- 底部固定 Tab Bar
- 中间内容区独立滚动
- 筛选、答题卡等复杂控件使用 Bottom Sheet
- 练习、错题、考试、Dashboard 在手机端使用单列卡片流
- 桌面端仍保留原有顶部导航、侧栏和多栏布局

## 适用范围

重点覆盖前台页面：

- `/login` 登录页
- `/dashboard` 学习总览
- `/practice` 练习页
- `/wrongbook` 错题本
- `/exam` 模拟考试页
- 考试报告页

旧后台：

- `/admin`
- `admin.html`
- `admin.js`
- 根目录 `styles.css`

后台只做基础移动适配，不做完整 App 化。

## 主要实现文件

```text
src/main.tsx
src/styles.css
styles.css
```

### src/main.tsx

新增或调整的移动端组件：

- `MobileTopBar`
- `MobileTabBar`
- `BottomSheet`

接入点：

- `App` 根组件中渲染移动端顶部栏、底部栏和练习筛选弹层。
- `PracticePage` 新增 `onOpenFilters`，移动端通过“筛选 / 模式”入口打开 Bottom Sheet。
- `ExamPage` 新增 `answerSheetOpen` 状态，移动端通过“答题卡”按钮打开答题卡 Bottom Sheet。

### src/styles.css

负责前台移动端 App 化布局：

- 固定 100dvh App Shell
- 顶部 App Header
- 底部 Tab Bar
- Bottom Sheet
- Dashboard 单列信息流
- 练习页刷题卡片和底部操作区
- 错题本移动端卡片流
- 模拟考试移动端答题卡弹层
- 登录页 App 启动页风格

### 根目录 styles.css

负责旧后台移动端基础适配：

- 后台侧栏在移动端改为顶部横向导航
- 表格区域内部横向滚动
- 表单、卡片、用户列表改为单列
- 保持旧后台功能不变

## 移动端 App Shell

移动端断点主要在 `max-width: 980px` 以内启用。

核心布局：

```css
.app-shell {
  height: 100dvh;
  display: grid;
  grid-template-rows: var(--mobile-header-h) minmax(0, 1fr) var(--mobile-tabbar-h);
  overflow: hidden;
}
```

内容区域：

```css
.workspace-shell {
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  -webkit-overflow-scrolling: touch;
}
```

这样可以避免 body 全局滚动失控，同时让中间内容区域像 App 页面一样独立滚动。

## 顶部 MobileTopBar

组件位置：

```text
src/main.tsx -> MobileTopBar
```

功能：

- 显示当前页面标题
- 显示当前页面说明
- 练习页右侧按钮为“筛选”
- 非练习页右侧显示用户名或同步状态
- 左侧按钮在练习页打开筛选，在其他页面保留菜单入口

标题映射：

| route | title |
| --- | --- |
| dashboard | 学习总览 |
| practice | 刷题练习 |
| wrongbook | 错题本 |
| exam | 模拟考试 |

## 底部 MobileTabBar

组件位置：

```text
src/main.tsx -> MobileTabBar
```

Tab 项：

| Tab | Route |
| --- | --- |
| 首页 | `/dashboard` |
| 练习 | `/practice` |
| 错题 | `/wrongbook` |
| 考试 | `/exam` |
| 我的 | 当前暂时指向 `/dashboard` |

说明：

- 当前“我的”还没有独立页面，暂时复用 Dashboard。
- 点击区域不小于 48px。
- 使用 fixed/sticky 底部栏视觉，内容区域已预留底部空间。

## BottomSheet

组件位置：

```text
src/main.tsx -> BottomSheet
```

用途：

- 练习页筛选
- 模拟考试答题卡

交互规则：

- `open=false` 时不渲染
- 打开后覆盖当前页面
- 点击遮罩或关闭按钮关闭
- 弹层主体内部滚动
- 不影响业务数据结构

样式关键点：

```css
.bottom-sheet-layer {
  position: fixed;
  inset: 0;
  z-index: 80;
}

.bottom-sheet {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  max-height: min(82dvh, 720px);
  border-radius: 24px 24px 0 0;
}
```

## 练习页移动端

桌面端：

- 保持左侧栏 + 主答题区
- 筛选、章节、统计仍在侧栏中

移动端：

- 顶部显示 App Header
- 中间内容是题目卡片流
- 题干和选项全宽显示
- 选项按钮更高，适合手指点击
- 收藏、不熟、答题历史仍保留
- AI 讲解、答案解析在题目下方
- 上一题 / 下一题在题目卡片底部变为 sticky 操作条
- 搜索、章节、模式、筛选进入 Bottom Sheet

关键入口：

```tsx
<button className="mobile-practice-filter-chip" onClick={props.onOpenFilters}>
  筛选 / 模式
</button>
```

筛选弹层复用：

- `PracticeToolbar`
- `ChapterSidebar`

没有重写筛选逻辑，只移动了移动端交互入口。

## Dashboard 移动端

桌面端：

- 保持多栏数据看板

移动端：

- 改为 App 首页信息流
- 页面单列排列
- 学习概览、统计卡使用横向滑动卡片
- 章节掌握度、趋势、考试记录、复习任务以卡片流展示
- 内容区独立滚动

移动端重点样式：

- `.dashboard-v2`
- `.dashboard-left-rail`
- `.dashboard-center`
- `.dashboard-right-rail`
- `.overview-card-grid`
- `.dashboard-card-modern`

## 错题本移动端

桌面端：

- 保持左中右三栏布局

移动端：

- 改为单列复习流
- 错题、复习计划、相似题、薄弱点按卡片顺序展示
- 筛选项改为横向可滑动区域
- 统计卡片横向滑动

当前限制：

- 错题本筛选还没有单独抽成 Bottom Sheet。
- 目前采用顶部横向标签/卡片滑动方式，已避免挤压和横向溢出。

## 模拟考试移动端

桌面端：

- 保持左侧考试设置/概览
- 中间题目
- 右侧答题卡

移动端：

- 题目区域优先显示
- 答题卡不常驻占屏
- 正式考试中通过“答题卡”按钮打开 Bottom Sheet
- 上一题、暂存、答题卡、下一题、交卷在底部操作区
- 交卷按钮保留明显风险色

关键状态：

```tsx
const [answerSheetOpen, setAnswerSheetOpen] = useState(false);
```

正式考试答题卡弹层：

```tsx
<BottomSheet open={answerSheetOpen} title={"答题卡"} onClose={() => setAnswerSheetOpen(false)}>
  <ExamAnswerPanel ... />
</BottomSheet>
```

说明：

- `ExamAnswerPanel` 仍是同一个业务组件。
- 桌面端仍显示常驻答题卡。
- 移动端通过 CSS 隐藏常驻答题卡，只在 Bottom Sheet 中展示。

## 登录页移动端

移动端登录页不走 App Shell。

原因：

- 登录页更像 App 启动页
- 不需要底部 Tab Bar
- 未登录状态不应展示应用主导航

移动端样式：

- `height: 100dvh`
- 独立滚动
- 柔和浅绿色渐变背景
- 居中登录卡片
- 输入框和按钮大尺寸

## 断点策略

当前主要断点：

| 断点 | 用途 |
| --- | --- |
| `max-width: 1180px` | 桌面窄屏和平板过渡 |
| `max-width: 980px` | 启用移动端 App Shell |
| `max-width: 768px` | 手机布局强化 |
| `max-width: 640px` | 小屏内容密度调整 |
| `max-width: 480px` | 小屏手机细节优化 |
| `max-width: 430px` | 430/390/375 等设备修正 |

重点验收宽度：

- 360px
- 375px
- 390px
- 430px

## 滚动规则

移动端前台：

- `body` 不作为主滚动容器
- `.app-shell` 固定 `100dvh`
- `.workspace-shell` 独立滚动
- Bottom Sheet 内部独立滚动

保留内部横向滚动的区域：

- Dashboard 部分小统计卡
- Dashboard 记录表
- 错题本筛选/统计标签
- 旧后台表格

这些横向滚动不会撑出浏览器级横向滚动条。

## 验收结果

已执行：

```bash
npm run lint
npm run test
npm run build
```

结果：

- lint 通过
- test 通过，9 个测试全部通过
- build 通过

浏览器验证：

- `360px`
- `390px`
- `430px`

验证页面：

- `/practice`
- `/dashboard`
- `/wrongbook`
- `/exam`
- `/login`

结果：

- 无浏览器级横向滚动
- 前台主页面 App Header 正常显示
- 底部 Tab Bar 正常显示
- 内容区可独立滚动
- 练习筛选 Bottom Sheet 可打开
- Dashboard 内容区可滚动
- 登录页独立显示，不展示底部 Tab Bar

## 服务器同步状态

当前移动端 App 化版本已同步到服务器：

```text
168.138.177.29
/opt/uav-question-bank
Docker service: uav-question-bank
```

部署验证通过：

- `/`
- `/practice`
- `/dashboard`
- `/exam`
- `/wrongbook`
- `/admin`

均返回 HTTP 200。

## 后续优化建议

建议后续继续做：

1. 给“我的”新增独立页面，而不是暂时跳转 Dashboard。
2. 错题本筛选也改成 Bottom Sheet，进一步减少顶部信息密度。
3. 模拟考试设置页可以进一步拆成 App 式步骤流。
4. 增加真实移动端截图到 `docs/screenshots/mobile/`。
5. 为 Bottom Sheet 增加 ESC 关闭和焦点管理。
6. 为 320px 极窄屏做一次额外检查。

## 注意事项

- 不要在移动端恢复 body 全局滚动，否则底部 Tab Bar 容易遮挡内容。
- 不要给主容器使用 `width: 100vw`，容易在 Windows/移动浏览器上造成横向溢出。
- 不要把桌面侧栏直接显示在手机端，复杂筛选应进入 Bottom Sheet。
- 不要删除旧后台的 `admin.html`、`admin.js`、根目录 `styles.css`。
- 不要修改 `progressSchemaVersion = 2` 或题库数据结构来实现 UI 效果。
