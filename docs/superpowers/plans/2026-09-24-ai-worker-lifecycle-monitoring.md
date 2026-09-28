# AI Worker 生命周期收口与重跑语义实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 暂停、失败、换模型和删除扫描后不再发生隐式 AI 调用；保留可核查的失败与用量历史；让“继续未完成和失败项”与“全部重跑”真正成为两种不同操作。

**Architecture:** 沿用现有 SQLite 队列、API 调用审计、独立 AI Worker 和管理员监控页。补持久化删除栅栏、批次版本与每次领取唯一标识；所有领取、发请求、完成与重试均校验它们。修复现有批次创建/取消逻辑与监控统计，不再重建已完成的审计和监控基础设施。

**Tech Stack:** 当前项目的 Next.js、TypeScript、SQLite/better-sqlite3、Vitest、Docker Compose，以及本地构建的 `linux/amd64` 镜像。

**Spec:** `docs/superpowers/specs/2026-09-24-ai-worker-lifecycle-monitoring-design.md`

**Revision:** 2026-09-29。替代原计划中“配置变更时删除未完成/失败项”“暂停批次可走通用 retry”“重做监控页和审计迁移”等过时步骤；补充发布与扫描删除的互斥栅栏，并明确继续与全量重跑的不同语义。

## 全局约束

- 扫描任务是可执行 AI 批次的父级。删除扫描时先提交跨容器可见的停止栅栏，再中止在途请求，最后可重试地清理该扫描的批次和项目；仅保留去标识化真实 API 调用审计。
- 扫描删除栅栏与报告发布必须互斥并由 SQLite 写事务确定先后：删除栅栏先提交则发布必须失败；发布先完成则删除必须在写栅栏前拒绝。不能留下“删除已请求但因随后发布而永远删不掉”的任务。
- 模型配置修改、停用、删除及切换都不得物理删除旧批次的待处理项、失败项、错误原因或调用历史。人工结论使旧项目不可执行，也只做带原因的排除标记。父扫描删除是唯一清理这些项目的正常路径。
- `paused`、`failed`、`cancelled` 均不自动恢复。Worker 重启仅接续仍有效的活动批次；不能清零尝试数。暂停后的通用 retry 返回冲突，只有明确的“继续”能再次启动未成功项目。
- 每个项目在每个**显式处理周期**最多三次实际 API 请求，含首次调用。新周期保留旧失败及调用记录。暂停、取消、删除会阻止待触发的退避重试；请求可能已经到达服务商，不能承诺不计费。
- 同一扫描同一时刻最多一个可发送请求的批次。新批次不得在旧批次本机在途请求确认结束/中止或硬超时并完成栅栏收尾前开始发送。旧响应不能修改新批次结果。
- “继续未完成和失败项”不重复已成功项目；“全部重跑”包含原 AI 候选范围内已成功项目，明确产生新批次与新费用；人工最终结论始终排除。即使模型、扫描、提示词均未变，一次新的明确“全部重跑”也生成新批次。同一按钮请求的重复提交仅执行一次。
- 当前运行统计与历史累计分开；一次重试是一次调用，不是新增复核项目。监控仍使用现有管理员页面，任何 GET/刷新都只读。
- 不更改扫描评分、规则判断、报告结构、权限或 API key 配置。不得记录密钥、提示词、页面正文、完整 URL、完整模型响应；仅展示服务商真实返回的 token/费用，缺失则为“未知”。
- 按 `AGENTS.md`，修改 Next.js 页面或路由前先阅读对应的 `node_modules/next/dist/docs/` 指南。验证使用本地假模型，不创建真实扫描或触发真实 AI 调用。

## 审核重点与实施顺序

先补失败用例，再动实现；按任务边界分工，数据库字段及状态契约由主实现者先定稿，UI 和测试可以在契约确定后并行。每项完成后审查状态转换、并发边界、调用次数和敏感信息。特别检查：Worker 重启恢复、暂停与退避重试、同名 Worker 过期租约、配置变更与迟到响应、扫描删除跨容器竞态。不得用“删掉旧项目”让计数看起来正确。

## Task 1：锁定现有故障并补状态/栅栏字段

**Files:** `src/lib/db.ts`，`src/lib/ai-overlay.ts` 的批次/项目类型，`tests/scoring/ai-overlay.test.ts`，`tests/integration/ai-lifecycle.test.ts`。

**Interfaces:** 下一版迁移仅加本修复需要的字段：批次 `revision`、`stop_reason`/`stop_requested_at`、本次按钮动作的幂等键及可选来源批次；项目 `active_attempt_id`/批次版本及人工排除原因；扫描任务 `deletion_requested_at`。字段命名可以按现有约定调整，但必须保证旧库升级与重复迁移安全。现有 `ai_api_attempts`、`ai_worker_instances` 与监控表不重建。

- [ ] 先写旧库升级、字段默认值、索引/唯一约束和幂等迁移的失败测试；检查已存在批次可读取。
- [ ] 跑 `pnpm exec vitest run tests/scoring/ai-overlay.test.ts tests/integration/ai-lifecycle.test.ts`，确认新断言因缺字段或错误行为失败。
- [ ] 加迁移 034 与最小类型更新。唯一尝试标识每次领取生成；版本在暂停、取消、切换、删除和显式重启时递增。审计不引入敏感字段。
- [ ] 重跑聚焦测试，确认迁移与旧数据兼容；单独提交这一状态契约。

## Task 2：停止隐式恢复，修正暂停、失败与继续

**Files:** `src/lib/ai-overlay.ts`，`src/app/api/ai/batches/[batchId]/route.ts`，`src/worker/ai.ts`，`tests/scoring/ai-overlay.test.ts`，`tests/integration/ai-lifecycle.test.ts`，`tests/unit/ai-worker-runtime.test.ts`。

**Interfaces:** `resume` 仅可显式恢复快照仍有效的暂停批次；`retry` 仅处理可显式继续的失败批次，不能作用于暂停/取消批次。两者仅重排非成功项目，并开启新的、最多三次的周期；旧周期与失败原因不可抹掉。

- [ ] 先反转 `ai-overlay.test.ts` 约 1195、1227、1259 行期待失败批次自动激活的旧断言：三次用尽后重复 Worker 轮询及重启均无第四次调用，失败与尝试历史不变。加入“可能已发送但结果未知”的重启场景，不能隐式重付费。
- [ ] 加 API 与假服务商测试：暂停批次请求 `retry` 返回 409 且无调用；同快照显式继续只处理 queued/failed/interrupted，成功项不再请求；快照失效后继续被拒绝；网络/5xx/无效响应/429（含 `Retry-After`）均不越过每周期三次上限。
- [ ] 移除 `processNextAiItem` 中能重开 `failed/paused/cancelled` 批次及清零尝试数的恢复路径。仅活动批次允许从明确可安全接续的队列恢复；退避前和发送前再校验持久化状态。
- [ ] 跑上述三个测试文件，核对调用次数、状态与错误历史；提交。

## Task 3：配置变更/人工结论停止执行，但保留旧项目

**Files:** `src/lib/ai-overlay.ts`，`src/app/api/ai/providers/[providerId]/route.ts`，`tests/scoring/ai-overlay.test.ts`，`tests/integration/ai-lifecycle.test.ts`。

**Interfaces:** 配置更改/停用/删除产生 `cancelled/superseded` 与脱敏停止原因/时间；项目行维持原最终状态或标记为不可执行。人工终判只排除后续 AI 执行，不删除旧复核证据。

- [ ] 先反转 `ai-lifecycle.test.ts` 约 163/262 行、`ai-overlay.test.ts` 约 1337/2210 行把旧项目数变成 0 的断言；改为旧批次所有项目及失败原因仍可查，调用审计仍可查，旧批次不可领取。
- [ ] 修复 `cancelProviderWork`、`cancelBatchWork`、`removeHumanResolvedQueueItems` 的物理删除路径；使用状态/排除标记和批次栅栏，不依赖清空队列制造终态。核查新创建批次时不会领取被人工终判的项目。
- [ ] 覆盖配置响应正在到达时取消、无关配置编辑、同一扫描切换配置等路径；运行聚焦测试并提交。

## Task 4：唯一租约与跨容器删除栅栏

**Files:** `src/lib/ai-overlay.ts`，`src/lib/repositories.ts`，`src/worker/ai.ts`，`src/app/api/scans/[jobId]/route.ts`，`src/app/api/runs/[runId]/publish/route.ts`，`tests/integration/ai-lifecycle.test.ts`，`tests/integration/scans-api.test.ts`，`tests/scoring/ai-overlay.test.ts`，以及发布/删除竞态集成测试。

**Interfaces:** 领取生成唯一 `active_attempt_id` 并记录当时 `revision`；完成/失败/取消的条件更新同时匹配二者与活动批次/扫描状态。仅靠相同 `workerId` 或槽位不够。删除扫描为“提交删除栅栏 → 中止/等待 → 清理并去标识化审计”的幂等流程。

- [ ] 先写同名 Worker 的旧租约过期、重新领取、旧响应迟到的失败测试；旧响应不得完成项目、改变新结果或安排重试。写旧批次取消后新模型等待旧在途结束/硬超时并栅栏收尾才发送的调用顺序测试。另覆盖发布/删除两种事务先后：删除栅栏先提交时发布被拒绝；发布先提交时删除拒绝且不写删除标记。
- [ ] 用独立数据库连接模拟“项目已领取、删除栅栏提交、另一容器准备发送”；删除后新增 provider 请求数必须为 0。删除中途失败再执行应能继续清理；其它扫描数据不受影响，历史审计没有扫描/批次/项目/站点关联。
- [ ] 实现条件更新、停止信号、硬超时与两阶段删除；在 HTTP 发送前读取已提交的删除/暂停/配置栅栏。发布最终写入必须在同一事务内检查父扫描存在且没有删除栅栏；删除与发布由事务提交顺序决定胜者。迟到调用只完善自身脱敏审计，不能复活任务。
- [ ] 跑 `pnpm exec vitest run tests/integration/ai-lifecycle.test.ts tests/integration/scans-api.test.ts tests/scoring/ai-overlay.test.ts`；提交。

## Task 5：两种明确范围、独立批次和幂等按钮

**Files:** `src/lib/ai-overlay.ts`，`src/app/api/runs/[runId]/ai-review/route.ts`，`src/components/ai-overlay-card.tsx`，`src/lib/i18n.ts`，`tests/integration/ai-lifecycle.test.ts`，`tests/scoring/ai-overlay.test.ts`，相关 UI 测试。

**Interfaces:** 管理员 POST 明确传 `mode: "remaining" | "all"`、当前模型配置、可选 `sourceBatchId`、每次按钮动作的 `requestId`。服务端验证来源批次确属该扫描且不是过期选择，不信任浏览器给的项目数，按扫描复核范围和人工终判重算。重复 `requestId` 返回同一批次；新的明确 `all` 动作即使配置相同也创建新批次。对旧客户端做有界兼容或明确拒绝，不允许含糊地把两种模式合并。语义固定为：继续只处理尚未成功项目；“全部重跑”新建批次并包含此前已成功项目。

- [ ] 先反转同模型“总是复用旧批次”的旧测试；增加同一请求重放仍同一批次、第二次明确全量重跑生成不同批次且含已成功项目的测试。
- [ ] 增加换模型 `remaining` 只含旧批次未成功/失败项目、换模型 `all` 含完整非人工终判范围的测试。二者各有独立进度与调用记录；旧批次原项目/错误不删除。若没有待续项目，返回明确空范围结果，不排队。
- [ ] 改造确定性 `makeBatchKey`/`createAiBatch` 语义，区分按钮请求去重和新批次身份。服务端先取消旧活动批次并满足 Task 4 的在途交接规则，然后让新批次可执行。
- [ ] UI 按状态呈现：暂停且快照有效时 `继续任务`，恢复原批次且只处理未成功项；失败时提供显式续做；配置已变或旧批次已取消时提供 `按当前模型继续未完成和失败项` 与 `按当前模型全部重跑 N 项`。后者必须重跑完整可执行 AI 候选范围，包含以前成功项；全量按钮确认包含已成功项目与可能新增费用，并显示旧批次失败数及停止原因。中英文文字一致，按钮样式沿用当前全站规范。
- [ ] 跑聚焦测试与相关 UI 测试；提交。

## Task 6：修正现有监控页，不再把历史行称为当前排队

**Files:** `src/app/api/ai/worker/route.ts`，`src/app/settings/ai/worker/worker-monitor-client.tsx`，`src/lib/i18n.ts`，`tests/integration/ai-worker-monitor.test.ts`。

**Interfaces:** 现有 `itemSummary` 只表示当前可执行批次的项目；历史累计另起字段并明确标签。近期真实调用可显示安全项目标识、尝试序号、模型、状态、耗时和服务商实际报告的用量。批次列表展示停止原因/时间；删除扫描后的审计标为历史、去标识。

- [ ] 先构造同一扫描多个历史批次的失败测试，确认当前项目数不等于所有 `ai_review_items` 行之和；历史 API 请求总数仍按真实调用累计。
- [ ] 增加活动项目/尝试标识、停因、去标识历史调用、匿名/访客拒绝、敏感字段缺席和重复 GET 无副作用测试。
- [ ] 修正现有路由的全表 `GROUP BY status` 与 UI 标签，不新建第二套监控基础设施。监控页/扫描复核页所示当前进度均按选中或最新相关批次，扫描级汇总按扫描项目去重。
- [ ] 跑 `pnpm exec vitest run tests/integration/ai-worker-monitor.test.ts` 并手动只读检查页面；提交。

## Task 7：端到端验证与 NAS 发布门禁

**Files:** 上述测试、必要时现有 `compose.local-validation.yaml` / `compose.ai-monitor-smoke.yaml`；部署文件仅在镜像引用确需更改时调整。

- [ ] 跑 `pnpm exec vitest run tests/scoring/ai-overlay.test.ts tests/integration/ai-lifecycle.test.ts tests/integration/scans-api.test.ts tests/integration/ai-worker-monitor.test.ts tests/unit/ai-worker-runtime.test.ts`，再跑 `pnpm lint`、`pnpm typecheck`。不因旧测试固定错误行为而跳过或删掉它们。
- [ ] 本地用独立数据库/卷与假模型跑 Web + AI Worker 的完整小型流程：成功、三次失败、暂停且退避中、显式继续、同模型全量重跑、换模型仅续做、配置删除、删除扫描、监控刷新。记录每阶段真实假请求次数及当前/历史数字；不触发真实模型或新真实扫描。
- [ ] 本地构建并验证 `linux/amd64` 应用镜像。仅上述门禁通过后，再备份并校验 NAS 数据库、记录现有 Web/AI Worker 镜像回滚标签，经局域网传输本地镜像并只重建 `web` 与 `ai-worker`；不在 NAS 构建、不重启 Caddy、普通 Worker 或 egress-proxy。
- [ ] NAS 上只做容器/健康、迁移完整性、管理员监控权限及只读统计检查，不新建真实 AI 批次。失败时恢复原镜像；若数据库迁移已执行，必须按经过验证的备份/恢复方案处理，不能只回滚旧代码并假设旧库兼容。报告实际验证结果和未验证风险。
