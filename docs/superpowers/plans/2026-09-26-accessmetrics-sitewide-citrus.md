# AccessMetrics 全站柑橘视觉统一实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task by task. Keep the task order, use a fresh focused worker for each independent task, and review its diff before proceeding. Check off each step as it is completed.

**Goal:** 将 AccessMetrics 全部应用页面和按钮统一为已选定的 C「柑橘自然感」视觉，同时让独立导出的 HTML 与 PDF 共用清爽、适合阅读和打印的报告设计；保持现有业务、权限及任务行为不变。

**Architecture:** 以现有 `globals.css` 和应用布局作为屏幕端设计系统入口，保留现有路由、组件边界、语义化 HTML 及页面业务逻辑。按共享外壳、页面组、报告导出逐步迁移，避免一次性替换造成页面例外继续堆积。屏幕报告沿用应用 C 风格；HTML/PDF 使用 `ReportDocument` 的同一内容结构与自包含纸面主题。完成行为回归后构建本地生产镜像、运行 Docker 健康与界面冒烟验证，再按现有预构建镜像流程发布 NAS。

**Tech Stack:** Next.js 16 App Router、React、TypeScript、CSS、Vitest、Playwright、Docker Compose、NAS 预构建镜像发布。

**Spec:** [2026-09-26-accessmetrics-sitewide-citrus-design.md](../specs/2026-09-26-accessmetrics-sitewide-citrus-design.md)

## 全局约束

- 严格按设计规范采用既定颜色：墨绿 `#1d3931`、森林绿 `#1d5145`、暖灰底 `#e9e7e0`、纸白 `#f8f6e7`、柑橘浅绿 `#e9edb8`、鼠尾草绿 `#d8e2ad`、暖黄 `#f4c578`、珊瑚红 `#bf563f`。不要再为各页面引入互相冲突的主色。
- 统一主按钮、次按钮、低强调文字操作和危险操作；统一尺寸、圆角、焦点环、悬停、禁用、加载态。保留 `button`/链接/表单的原生语义、可访问名称、`aria-busy` 及现有点击行为。
- 不新增 UI 框架、字体依赖、API、数据库迁移或配置项；不改登录、角色权限、扫描、AI Worker、复核、发布、删除或计费逻辑。
- 页面分组顺序执行；所有分组会修改共享 `globals.css`，不要让多个实现者并行改同一文件。每项实现都先增加/调整失败测试，再修改实现，并运行该项的聚焦验证。
- 不使用真实付费 AI 请求验证视觉或按钮；用现有集成/E2E fixture 覆盖交互与状态。这样不会为样式改动额外消耗 API 费用。
- 项目使用的 Next.js 16 API 与传统版本有差异。写代码前先查阅本仓库 `node_modules/next/dist/docs/` 中与改动相关的官方指南，并遵循弃用说明。
- NAS 发布前必须先通过本地完整测试和本地 Docker 镜像验证；NAS 变更只按现有文档做预构建镜像传输，先保留回滚标签，不重启 Caddy。

## 实施任务

### Task 1：建立共享设计 tokens、应用外壳与基础控件

**Files:**
- Modify: `src/app/globals.css`
- Modify: `src/app/layout.tsx`
- Modify: `src/components/status-badge.tsx`
- Modify: `src/components/locale-selector.tsx`
- Modify: `tests/e2e/login-intro.spec.ts`

- [ ] 先在 `tests/e2e/login-intro.spec.ts` 加入失败断言：登录页应用背景使用暖灰 token、主按钮使用森林绿 token；聚焦交互控件时能看到非零宽度的可见焦点轮廓。
- [ ] 运行该 E2E 用例并确认它因当前视觉值不符而失败。
- [ ] 在 `globals.css` 建立唯一的 C 风格颜色、文字、间距、边框、阴影、焦点及按钮状态 tokens；将现有按钮类映射到四种语义，不删除仍被页面使用的兼容类名。
- [ ] 调整 `layout.tsx` 的顶栏、内容容器、导航和状态/语言控件，使间距、对比度和窄屏折叠规则一致；保持按角色显示原有导航。
- [ ] 更新状态徽标和语言选择器的视觉，不改变其文本、locale 切换或权限语义。
- [ ] 重跑聚焦 E2E；确认角色导航与登录行为仍通过，然后提交：`feat: establish citrus visual system`。

### Task 2：统一登录、团队与首页/列表页

**Files:**
- Modify: `src/app/login/login-form.tsx`
- Modify: `src/app/team/page.tsx`
- Modify: `src/app/page.tsx`
- Modify: `src/app/scans/page.tsx`
- Modify: `src/app/reports/page.tsx`
- Modify: `src/app/home-client.tsx`
- Modify: `src/app/globals.css`
- Modify: `tests/e2e/login-intro.spec.ts`
- Modify: `tests/e2e/home.spec.ts`

- [ ] 为登录、团队、首页及扫描/报告列表增加聚焦的设计断言，先确认至少一条在旧样式下失败。
- [ ] 将公开登录介绍和登录表单纳入 C 风格，但维持两类访客的现有文案、登录入口和安全提示。
- [ ] 统一团队、首页、活动任务、报告库的页面标题层级、卡片/表格/空状态、操作按钮及窄屏布局。`/`、`/scans`、`/reports` 复用的 `home-client.tsx` 不得引入路由分支的重复风格覆盖。
- [ ] 确认访客/管理员导航、列表动作、空状态、删除确认及页面链接的既有行为均未改变。
- [ ] 运行 `login-intro` 与 `home` 聚焦 E2E 和相应单测，提交：`feat: restyle public and workspace pages`。

### Task 3：统一扫描、任务进度与人工复核页面

**Files:**
- Modify: `src/app/scans/new/new-scan-client.tsx`
- Modify: `src/app/scans/jobs/[jobId]/job-client.tsx`
- Modify: `src/app/scans/[runId]/run-client.tsx`
- Modify: `src/app/scans/[runId]/review/review-client.tsx`
- Modify: `src/components/incomplete-review.tsx`
- Modify: `src/app/globals.css`
- Modify: `tests/unit/review-page-style.test.ts`
- Modify: `tests/e2e/home.spec.ts`

- [ ] 先增加/调整扫描表单和复核页的结构/样式回归断言，并验证失败。
- [ ] 统一表单控件、扫描状态、统计卡片、页面/问题列表、复核标签与操作按钮；使用清晰的信息层级，而非把密集结果强行改成装饰性大卡片。
- [ ] 保留扫描进度、错误原因、停止/继续、复核判定、分页、未完成提示与加载/禁用状态的现有行为和可访问状态。
- [ ] 运行 `review-page-style` 单测和覆盖扫描/复核路径的 `home` E2E，提交：`feat: restyle scan and review workflows`。

### Task 4：统一 AI 配置与 Worker 监控

**Files:**
- Modify: `src/app/settings/ai/ai-settings-client.tsx`
- Modify: `src/app/settings/ai/worker/worker-monitor-client.tsx`
- Modify: `src/app/settings/ai/page.tsx`
- Modify: `src/app/settings/ai/worker/page.tsx`
- Modify: `src/components/ai-overlay-card.tsx`
- Modify: `src/app/globals.css`
- Modify: `tests/integration/ai-worker-monitor.test.ts`
- Modify: `tests/e2e/home.spec.ts`

- [ ] 为配置表单、服务卡片、运行/暂停/排队状态与 Worker 监控面板增加外观断言，并先确认预期失败。
- [ ] 使用统一 C 风格呈现模型服务、限额提示、配置动作，以及当前执行任务/暂停/排队/失败状态；让高密度运行信息保持易扫读。
- [ ] 不改变模型配置 CRUD、限流、Worker 调度/取消及 API 调用行为；明确的危险按钮仍使用危险语义。
- [ ] 运行 AI Worker 监控集成测试和设置页聚焦 E2E，提交：`feat: restyle AI settings and worker monitor`。

### Task 5：统一屏幕版报告与报告操作

**Files:**
- Modify: `src/app/reports/[runId]/page.tsx`
- Modify: `src/app/reports/[runId]/report-actions.tsx`
- Modify: `src/components/report-document.tsx`
- Modify: `src/components/ai-overlay-card.tsx`
- Modify: `src/app/globals.css`
- Modify: `tests/unit/report-document.test.ts`
- Modify: `tests/e2e/home.spec.ts`

- [ ] 增加屏幕报告标题、报告操作按钮与内容区的设计断言，先确认旧样式不满足。
- [ ] 统一屏幕版报告、人工结论、AI 辅助结果和发布/导出/删除等操作按钮为 C 风格；让主要阅读内容清楚、数据密集区不拥挤。
- [ ] 保留已有报告权限、发布/撤回、删除确认、HTML/PDF 下载及原始评分和结论。
- [ ] 运行报告文档单测、访问控制相关集成测试和报告 E2E，提交：`feat: restyle on-screen reports`。

### Task 6：让独立 HTML 与 PDF 共用清爽报告主题

**Files:**
- Modify: `src/lib/report-html.tsx`
- Modify: `src/components/report-document.tsx`
- Modify: `src/app/api/reports/[runId]/html/route.ts`
- Modify: `src/app/api/reports/[runId]/pdf/route.ts`
- Modify: `tests/unit/report-html.test.ts`
- Modify: `tests/unit/report-document.test.ts`
- Modify: `tests/integration/access-control.test.ts`
- Modify: `tests/e2e/home.spec.ts`

- [ ] 先增加失败测试，验证 standalone HTML 与 PDF 使用相同报告正文/颜色主题，且不含应用导航、登录/发布操作；HTML 的现有语言选择器仍可用但打印时隐藏。
- [ ] 将导出样式集中为自包含的纸面主题，沿用 `ReportDocument` 的共享结构；避免复制第二份报告正文或引入外部字体/样式依赖。
- [ ] 设置适合 A4 的字号、边距、颜色打印、页眉/页脚和断页规则；标题与正文、表格行、证据块尽量不被拆开，并按规范处理可展开详情。
- [ ] 增加真实 PDF 下载/签名头验证；从同一 fixture 导出 HTML 与 PDF，核对文本内容一致、PDF 可解析且主要区块没有异常分页。现有仅 mock PDF 的访问控制测试继续用于权限验证，不代替实际 PDF 渲染检查。
- [ ] 运行报告 HTML/PDF 聚焦单测、访问控制集成测试和下载 E2E，提交：`feat: unify clean HTML and PDF report exports`。

### Task 7：跨页面响应式、可访问性与完整回归

**Files:**
- Modify: `tests/e2e/login-intro.spec.ts`
- Modify: `tests/e2e/home.spec.ts`
- Modify: `tests/unit/review-page-style.test.ts`
- Modify: `tests/unit/report-html.test.ts`
- Modify: `tests/unit/report-document.test.ts`
- Modify: `src/app/globals.css`（仅修复上一轮暴露的共性问题）

- [ ] 在已经覆盖的页面 E2E 流程中加入 390px 与桌面视口下的横向溢出检查，并覆盖每种主要按钮状态、键盘焦点、加载/禁用状态和长内容布局。
- [ ] 覆盖登录、团队、首页、扫描列表/新建/任务/结果/复核、报告库/报告详情、AI 设置/Worker 监控共 12 个路由；动态路由使用现有确定性测试数据和本地 fixture。
- [ ] 对导出 HTML/PDF 检查共享正文、语言控件打印隐藏、页边距和内容断页；不对真实网站启动额外扫描，也不调用付费模型 API。
- [ ] 运行聚焦测试后，完整执行 `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm test:e2e` 与生产构建；确认没有业务行为/API/DB 变更。
- [ ] 修复仅与本次改造相关的失败后重复完整回归，提交：`test: verify sitewide citrus redesign`。

## 发布门槛（测试通过后执行）

1. 按项目部署文档构建 `linux/amd64` 的 `accesscheck-nas:local` 应用镜像；不改动未涉及的 egress-proxy 镜像。
2. 用独立 Compose 项目和一次性本地密钥运行该镜像；确认 `/api/health`、登录页、管理员/访客外壳、空数据页面以及核心样式在容器内可用。E2E 与单测负责覆盖完整业务流程，Docker 验证用于确认最终生产镜像/运行时，不宣称其替代全部回归。
3. 本地镜像构建或容器冒烟失败时停止，不连接 NAS、不覆盖远端镜像。
4. 通过后依照 [nas-prebuilt-deployment.md](../../ops/nas-prebuilt-deployment.md) 先为 NAS 当前应用镜像保留回滚标签，再通过局域网传输并加载预构建镜像，避免 NAS 上源码构建。
5. 仅重建需要更新的 Web 服务；本次纯 UI 更新不重启 Caddy、扫描 Worker、AI Worker 或 egress-proxy。检查健康状态、登录、代表性页面及 HTML/PDF 下载；失败则恢复原镜像并重建 Web 服务。
6. 部署成功后提供 NAS 站点地址供用户检查；不因部署成功就自动推送 GitHub，除非用户另行要求。

## 评审重点

- C 设计是否覆盖所有路由和所有按钮，而非只换登录页/全局配色；各页例外是否有明确的内容密度或可访问性理由。
- 主/次/文字/危险操作的视觉强弱是否一致，键盘焦点、加载、禁用及移动端行为是否可辨认。
- 登录角色导航、扫描和复核状态、AI Worker 任务控制、发布/删除权限是否保持原样。
- 独立 HTML 和 PDF 是否共享同一正文和纸面视觉，且不会混入应用导航/动作；PDF 实际渲染是否清楚并合理分页。
- Docker/NAS 发布是否只使用通过本地验证的预构建镜像、保留回滚镜像，且没有重启无关服务。
