# AI Worker 生命周期收口与重跑语义实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 暂停、失败、换模型和删除扫描后不再发生隐式 AI 调用；保留可核查的失败与用量历史；让“继续未完成和失败项”与“全部重跑”真正成为两种不同操作。

**Architecture:** 沿用现有 SQLite 队列、API 调用审计、独立 AI Worker 和管理员监控页。补持久化删除栅栏、批次版本与每次领取唯一标识；所有领取、发请求、完成与重试均校验它们。修复现有批次创建/取消逻辑与监控统计，不再重建已完成的审计和监控基础设施。

**Tech Stack:** 当前项目的 Next.js、TypeScript、SQLite/better-sqlite3、Vitest、Docker Compose，以及本地构建的 `linux/amd64` 镜像。

**Spec:** `docs/superpowers/specs/2026-09-24-ai-worker-lifecycle-monitoring-design.md`

**Revision:** 2026-09-29。替代原计划中“配置变更时删除未完成/失败项”“暂停批次可走通用 retry”“重做监控页和审计迁移”等过时步骤；补充发布与扫描删除的互斥栅栏，并明确继续与全量重跑的不同语义。另明确暂停后失败历史仍可见、活动队列归零不等于失败数据被清除，以及暂停与删除扫描的不同结果。监控再区分“已进入发送阶段但结果未知”和“明确尚未发送”；人工终判只从当前可执行队列排除项目，不得从历史失败数和项目总数中抹去项目，并需单独显示已排除数量。

**Review update:** 2026-09-29。结合实现复核，补充请求 ID 绑定操作语义及空结果持久幂等、过期 Worker/租约不得计为当前调用、刷新失败明确标记旧数据。配置变更或批次替代后保留尚未发送的项目行，但它们不再属于可运行队列；监控必须按批次可执行状态区分当前队列与历史/已停止记录，不以改写历史项目状态来修饰数字。

**Review update 2:** 2026-09-29. A second scoped audit found that batch-detail aggregates still filtered manually excluded rows even though global history retained them. Per-batch status totals now include every retained row, with `excludedItems` reported separately; a regression assertion verifies the batch total and failure count do not shrink when an item is excluded.

**Review update 3:** 2026-09-29. An independent lifecycle review found four monitor semantics to close before release: legacy null send markers were presented as definitively unsent; settled HTTP responses were presented as unknown; uncertain-call copy blamed heartbeat even when lease/attempt identity was the cause; and pause/supersede reasons were not recorded accurately. Tests now reproduce each issue. The plan distinguishes response-received, possibly-sent, explicitly-not-sent, and legacy-unknown evidence; pause metadata clears only on explicit resume; replacement batches use the `superseded` reason.

**Review update 4:** 2026-09-29. A follow-up review exposed a critical retry race: late settlement of a superseded request could leave its item leased, while cancellation-timeout cleanup could move the cancelled batch to `failed`, allowing a retry. Added regressions for both late response and hard-timeout cleanup. Superseded items now release their old lease with an explicit reason; cancelled batches remain terminal and retry is rejected. Normal explicit retry after human resolution still finalizes correctly.

**Review update 5:** 2026-09-29. Final compatibility review found three edges: legacy rows could say `failed` while their stop reason was `superseded`/`provider_changed`, missing `send_started_at` could be misread as proof that an old request was never sent, and an explicit resume with no remaining work could leave stale pause metadata. Stop reason now keeps those legacy batches terminal; missing delivery evidence is recorded as unknown; a zero-work resume ends the batch and clears stop metadata. Added regressions for all three, including scan-deletion audit finalization.

**Review update 6:** 2026-09-29. A further concurrency review found that the provider-attempt audit could become terminal immediately before the corresponding item update; if supersession committed between those writes, the item could remain permanently leased as `running`. Attempt settlement and item settlement now share one immediate SQLite transaction, with regression coverage for both provider success and failure racing supersession; batch status updates are restricted so terminal batches cannot be reopened. Also distinguish a live Worker's confirmed cancellation before the durable send gate (`AI_ATTEMPT_NOT_SENT`) from old/timeout/deletion records whose delivery outcome is unknown. These regressions and the lifecycle/monitor/scan-deletion integration suites pass.

**Review update 7:** 2026-09-29. Independent re-review closed both settlement/send-evidence findings with no remaining P1/P2. Final local verification passed: 248 tests, lint, typecheck, changed-file format; `linux/amd64` image `accesscheck-ai-lifecycle:20260929-r9`; isolated Docker success + pause/restart (zero requests) + explicit resume (exactly one new request) + read-only monitor API/page. NAS read-only preflight found schema v33, zero active AI items/calls, and existing historical rows; a 237 MiB SQLite backup passed `integrity_check`. Because the live schema is v33, rollout order is now explicitly Web-only migration to v37 and verification before recreating AI Worker. Caddy, normal scan Worker, egress-proxy, and unrelated `cv-web` stay untouched.

**Progress:** Tasks 1–5 are complete; Task 5 is committed through `54b6141`, independently reviewed with no P1/P2 findings, and its focused tests pass 99/99. Task 6 implementation and independent re-review are complete; the final settlement-race regressions pass. All local gates are green (248 tests, lint, typecheck, changed-file format, r9 `linux/amd64` build and isolated Docker smoke). NAS backup and read-only preflight are complete; remaining work is to record the actual running-image rollback tag, transfer the tested image over LAN, upgrade Web from DB schema v33 to v37 and verify data, then recreate only AI Worker and run read-only health checks. Repository-wide format check previously flagged 186 unrelated pre-existing files; do not reformat those.

## 全局约束

### 操作语义（不可互相替代）

| 操作                     | 栅栏提交后的新 API 请求/重试                                                    | 批次与项目历史                                                               | 后续允许的动作                                             |
| ------------------------ | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 暂停 AI 复核             | 立即禁止领取、发送和所有自动/通用重试；已发出的那一次请求只能等待结算或中止确认 | 保留批次、已成功/失败项目、错误原因和调用记录；queued 项目保留但不算活动队列 | 原模型快照有效时由用户明确继续，只处理未成功项             |
| 切换、停用或删除模型配置 | 旧快照立即停止，不自动迁移或重试                                                | 保留旧批次、失败与调用历史；旧 queued 项目留作历史                           | 用户明确选择新模型后，选择“继续未完成和失败项”或“全部重跑” |
| 删除活动扫描任务         | 先写删除栅栏、停止并等待/中止在途请求；之后绝不再发送                           | 仅删除该扫描关联的 AI 批次、项目和队列行；真实 API 用量审计去标识后保留      | 不可恢复该扫描或其 AI 队列                                 |
| 继续未完成和失败项       | 只在用户明确提交后开始新周期                                                    | 成功项及旧失败/尝试记录保留                                                  | 新批次仅纳入尚未成功且未人工终判的项目                     |
| 全部重跑                 | 只在用户明确确认后开始新批次                                                    | 旧批次与调用历史保留                                                         | 重跑完整 AI 候选范围，包含此前成功项，不含人工终判项       |

- 暂停不会删除失败项，也不会把失败“洗成”排队/成功；暂停后实时队列数下降是因为项目不再可执行，不代表失败记录消失。暂停时已有的终态失败记录不得减少；已经在途的单次请求仍可在结算时更新它自己的结果，但不能引出下一次请求。监控和批次详情必须继续显示已失败数及其原因，历史累计与当前可执行队列分别展示。
- “不再发新请求”指停止栅栏提交之后不允许任何新的 provider dispatch；SQLite 无法撤回已经发送到外部服务商的 HTTP 请求，因此它只能显示为取消中/结果待定，直到该次尝试结算。此例外不得触发下一次重试。

- 扫描任务是可执行 AI 批次的父级。删除扫描时先提交跨容器可见的停止栅栏，再中止在途请求，最后可重试地清理该扫描的批次和项目；仅保留去标识化真实 API 调用审计。
- 扫描删除栅栏与报告发布必须互斥并由 SQLite 写事务确定先后：删除栅栏先提交则发布必须失败；发布先完成则删除必须在写栅栏前拒绝。不能留下“删除已请求但因随后发布而永远删不掉”的任务。
- 模型配置修改、停用、删除及切换都不得物理删除旧批次的待处理项、失败项、错误原因或调用历史。人工结论使旧项目不可执行，也只做带原因的排除标记。父扫描删除是唯一清理这些项目的正常路径。
- `paused`、`failed`、`cancelled` 均不自动恢复。Worker 重启仅接续仍有效的活动批次；不能清零尝试数。暂停后的通用 retry 返回冲突，只有明确的“继续”能再次启动未成功项目。
- 每个项目在每个**显式处理周期**最多三次实际 API 请求，含首次调用。新周期保留旧失败及调用记录。暂停、取消、删除会阻止待触发的退避重试；请求可能已经到达服务商，不能承诺不计费。
- 同一扫描同一时刻最多一个可发送请求的批次。新批次不得在旧批次本机在途请求确认结束/中止或硬超时并完成栅栏收尾前开始发送。旧响应不能修改新批次结果。
- “继续未完成和失败项”不重复已成功项目；“全部重跑”包含原 AI 候选范围内已成功项目，明确产生新批次与新费用；人工最终结论始终排除。即使模型、扫描、提示词均未变，一次新的明确“全部重跑”也生成新批次。同一按钮请求的重复提交仅执行一次。
- `remaining` 必须关联一个当前有效的来源批次；缺少来源或来源已过期时明确拒绝，绝不能退化成全量处理。请求幂等检查、来源新鲜度、人工终判及候选范围必须在取得 SQLite 写锁后的同一事务中读取和决定，以便并发重放返回同一结果、并发新动作不会覆盖过期范围。
- 复核页的进度与 `remaining` 来源必须指向扫描最新批次，不能因管理员切回以前用过的模型而展示旧批次并隐藏最新批次的继续入口。
- 被模型配置失效或被新批次替代的旧批次中，未发送的 `queued` 项目保留原行供审计与显式续做，但旧批次不再可领取；它们不得计入当前可执行队列。暂停批次的 queued 项目同样保留以供显式恢复，不能自动发送。
- 当前运行统计与历史累计分开；一次重试是一次调用，不是新增复核项目。监控仍使用现有管理员页面，任何 GET/刷新都只读。
- 不更改扫描评分、规则判断、报告结构、权限或 API key 配置。不得记录密钥、提示词、页面正文、完整 URL、完整模型响应；仅展示服务商真实返回的 token/费用，缺失则为“未知”。
- 按 `AGENTS.md`，修改 Next.js 页面或路由前先阅读对应的 `node_modules/next/dist/docs/` 指南。验证使用本地假模型，不创建真实扫描或触发真实 AI 调用。

## 审核重点与实施顺序

先补失败用例，再动实现；按任务边界分工，数据库字段及状态契约由主实现者先定稿，UI 和测试可以在契约确定后并行。每项完成后审查状态转换、并发边界、调用次数和敏感信息。特别检查：Worker 重启恢复、暂停与退避重试、同名 Worker 过期租约、配置变更与迟到响应、扫描删除跨容器竞态。不得用“删掉旧项目”让计数看起来正确。

## Review Focus

- 同一按钮请求因网络重试重复提交，或复用 request ID 改了模式/模型：只精确重放原批次/空结果，语义变化必须冲突（Task 5）。
- 配置变更/新批次替代后，旧批次中尚未发送的项目仍可审计和显式续做，但绝不能进入当前可运行队列（Tasks 3、5、6）。
- Worker 心跳过期、尝试 ID 与项目租约不匹配或租约到期：不显示为已确认的当前 API 调用、不占活动槽位；若已有发送标记则显示“可能已发出、结果待确认”；只有明确记录 `AI_ATTEMPT_NOT_SENT` 才显示“发送前停止”，旧记录缺少发送/响应证据时显示“发送状态未知”（Task 6）。
- 暂停后活动队列不再计入其 queued 行，但批次失败数、项目错误原因及已发生的真实调用审计必须保持原值并可见；重复刷新不得清空这些历史（Tasks 2、6）。
- 监控刷新失败仍保留上次结果时，必须标明数据过期并提供最后成功更新时间（Task 6）。
- 历史批次/项目累计与当前选中批次队列分开统计；刷新页面不改变队列或产生调用（Tasks 5、6）。
- Worker 必须在一个 SQLite 写事务中同时提交本次 attempt 的终态审计和精确租约项目的终态/释放状态；attempt 状态变更触发批次停止时，不能留下永久 `running` 项目或把已停止批次重新设为 `queued/running`（Task 7）。
- 只有当前 Worker 在发送栅栏前确认中止，才可记录 `AI_ATTEMPT_NOT_SENT`；通用租约超时、Worker 消失、扫描删除清理不得据此推断旧请求未发送，证据不足仍须显示未知（Tasks 6–7）。

## Task 1：锁定现有故障并补状态/栅栏字段

**Files:** `src/lib/db.ts`，`src/lib/ai-overlay.ts` 的批次/项目类型，`tests/scoring/ai-overlay.test.ts`，`tests/integration/ai-lifecycle.test.ts`。

**Interfaces:** 下一版迁移仅加本修复需要的字段：批次 `revision`、`stop_reason`/`stop_requested_at`、本次按钮动作的幂等键及可选来源批次；项目 `active_attempt_id`/批次版本及人工排除原因；扫描任务 `deletion_requested_at`。字段命名可以按现有约定调整，但必须保证旧库升级与重复迁移安全。现有 `ai_api_attempts`、`ai_worker_instances` 与监控表不重建。

- [x] 先写旧库升级、字段默认值、索引/唯一约束和幂等迁移的失败测试；检查已存在批次可读取。
- [x] 跑 `pnpm exec vitest run tests/scoring/ai-overlay.test.ts tests/integration/ai-lifecycle.test.ts`，确认新断言因缺字段或错误行为失败。
- [x] 加迁移 034 与最小类型更新。唯一尝试标识每次领取生成；版本在暂停、取消、切换、删除和显式重启时递增。审计不引入敏感字段。
- [x] 重跑聚焦测试，确认迁移与旧数据兼容；单独提交这一状态契约。

## Task 2：停止隐式恢复，修正暂停、失败与继续

**Files:** `src/lib/ai-overlay.ts`，`src/app/api/ai/batches/[batchId]/route.ts`，`src/worker/ai.ts`，`tests/scoring/ai-overlay.test.ts`，`tests/integration/ai-lifecycle.test.ts`，`tests/unit/ai-worker-runtime.test.ts`。

**Interfaces:** `resume` 仅可显式恢复快照仍有效的暂停批次；`retry` 仅处理可显式继续的失败批次，不能作用于暂停/取消批次。两者仅重排非成功项目，并开启新的、最多三次的周期；旧周期与失败原因不可抹掉。

- [x] 先反转 `ai-overlay.test.ts` 约 1195、1227、1259 行期待失败批次自动激活的旧断言：三次用尽后重复 Worker 轮询及重启均无第四次调用，失败与尝试历史不变。加入“可能已发送但结果未知”的重启场景，不能隐式重付费。
- [x] 加 API 与假服务商测试：暂停批次请求 `retry` 返回 409 且无调用；暂停栅栏提交后，延迟退避、`Retry-After` 到期、Worker 轮询/重启、租约恢复均不能再发起请求；暂停前已有的终态 failed 项、原因和尝试/调用审计不得减少。若有请求已在途，只允许这一次原尝试结算并更新自身项目状态，不允许派生新尝试。仅同快照显式继续可处理未成功项目，成功项不再请求；快照失效后继续被拒绝；网络/5xx/无效响应/429（含 `Retry-After`）均不越过每周期三次上限。
- [x] 移除 `processNextAiItem` 中能重开 `failed/paused/cancelled` 批次及清零尝试数的恢复路径。仅活动批次允许从明确可安全接续的队列恢复；退避前和发送前再校验持久化状态。
- [x] 跑上述三个测试文件，核对调用次数、状态与错误历史；提交。

## Task 3：配置变更/人工结论停止执行，但保留旧项目

**Files:** `src/lib/ai-overlay.ts`，`src/app/api/ai/providers/[providerId]/route.ts`，`tests/scoring/ai-overlay.test.ts`，`tests/integration/ai-lifecycle.test.ts`。

**Interfaces:** 配置更改/停用/删除产生 `cancelled/superseded` 与脱敏停止原因/时间；项目行与原失败原因、调用审计均保留。旧批次中尚未发送的 queued 项目不再可领取，但仍是未成功历史，可由新的明确 `remaining` 续做；不能为了让统计归零而删除或伪造失败记录。人工终判只排除后续 AI 执行，不删除旧复核证据。

- [x] 先反转 `ai-lifecycle.test.ts` 约 163/262 行、`ai-overlay.test.ts` 约 1337/2210 行把旧项目数变成 0 的断言；改为旧批次所有项目及失败原因仍可查，调用审计仍可查，旧批次不可领取。
- [x] 修复 `cancelProviderWork`、`cancelBatchWork`、`removeHumanResolvedQueueItems` 的物理删除路径；使用状态/排除标记和批次栅栏，不依赖清空队列制造终态。核查新创建批次时不会领取被人工终判的项目。
- [x] 覆盖配置响应正在到达时取消、无关配置编辑、同一扫描切换配置等路径；确认取消后旧批次无新调用，尚未发送的项目行保留但不进入当前队列，仍可由新配置的 `remaining` 显式续做；运行聚焦测试并提交。

## Task 4：唯一租约与跨容器删除栅栏

**Files:** `src/lib/ai-overlay.ts`，`src/lib/repositories.ts`，`src/worker/ai.ts`，`src/app/api/scans/[jobId]/route.ts`，`src/app/api/runs/[runId]/publish/route.ts`，`tests/integration/ai-lifecycle.test.ts`，`tests/integration/scans-api.test.ts`，`tests/scoring/ai-overlay.test.ts`，以及发布/删除竞态集成测试。

**Interfaces:** 领取生成唯一 `active_attempt_id` 并记录当时 `revision`；完成/失败/取消的条件更新同时匹配二者与活动批次/扫描状态。仅靠相同 `workerId` 或槽位不够。删除扫描为“提交删除栅栏 → 中止/等待 → 清理并去标识化审计”的幂等流程。

- [x] 先写同名 Worker 的旧租约过期、重新领取、旧响应迟到的失败测试；旧响应不得完成项目、改变新结果或安排重试。写旧批次取消后新模型等待旧在途结束/硬超时并栅栏收尾才发送的调用顺序测试。另覆盖发布/删除两种事务先后：删除栅栏先提交时发布被拒绝；发布先提交时删除拒绝且不写删除标记。
- [x] 用独立数据库连接模拟“项目已领取、删除栅栏提交、另一容器准备发送”；删除后新增 provider 请求数必须为 0。删除中途失败再执行应能继续清理；其它扫描数据不受影响，历史审计没有扫描/批次/项目/站点关联。
- [x] 实现条件更新、停止信号、硬超时与两阶段删除；在 HTTP 发送前读取已提交的删除/暂停/配置栅栏。发布最终写入必须在同一事务内检查父扫描存在且没有删除栅栏；删除与发布由事务提交顺序决定胜者。迟到调用只完善自身脱敏审计，不能复活任务。
- [x] 跑 `pnpm exec vitest run tests/integration/ai-lifecycle.test.ts tests/integration/scans-api.test.ts tests/scoring/ai-overlay.test.ts`；提交。

## Task 5：两种明确范围、独立批次和幂等按钮

**Files:** `src/lib/ai-overlay.ts`，`src/lib/db.ts`，`src/app/api/runs/[runId]/ai-review/route.ts`，`src/components/ai-overlay-card.tsx`，`src/lib/i18n.ts`，`tests/integration/ai-lifecycle.test.ts`，`tests/scoring/ai-overlay.test.ts`，相关 UI 测试。

**Interfaces:** 管理员 POST 明确传 `mode: "remaining" | "all"`、当前模型配置、每次按钮动作的 `requestId`；`sourceBatchId` 对 `remaining` 必填且必须是该扫描最新批次，对 `all` 忽略。服务端在同一 SQLite 写事务中验证来源、计算范围并创建；不信任浏览器给的项目数。幂等账本绑定 `(run_id, requestId, mode, provider snapshot, effective source)`：重复相同请求返回原批次/空结果，参数不同复用同一 ID 则冲突；空范围不创建批次，但必须持久化空结果。新的明确 `all` 动作即使配置相同也创建新批次。对旧客户端做有界兼容或明确拒绝，不允许含糊地把两种模式合并。语义固定为：继续只处理尚未成功项目；“全部重跑”新建批次并包含此前已成功项目。

- [x] 先反转同模型“总是复用旧批次”的旧测试；增加同一请求 ID 并发重放仍返回同一批次、第二次明确全量重跑生成不同批次且含已成功项目的测试。
- [x] 增加缺失/错误/过期来源批次拒绝、来源校验与范围读取和创建之间发生并发动作的测试；确认范围计算不会落在 SQLite 写锁外。增加相同 ID 换模式/模型时冲突、空结果改变后仍精确重放的测试。增加换模型 `remaining` 只含旧批次未成功/失败项目、换模型 `all` 含完整非人工终判范围，以及 A→B 后再选回 A 时仍能继续最新 B 批次未完成项的测试。二者各有独立进度与调用记录；旧批次原项目/错误不删除。若没有待续项目，重复请求均返回明确空范围结果，不创建零项目批次、不排队、不触发 API 调用。
- [x] 改造确定性 `makeBatchKey`/`createAiBatch` 语义，区分按钮请求去重和新批次身份。服务端先取消旧活动批次并满足 Task 4 的在途交接规则，然后让新批次可执行。
- [x] UI 按状态呈现：暂停且快照有效时 `继续任务`，恢复原批次且只处理未成功项；失败时提供显式续做；配置已变或旧批次已取消时提供 `按当前模型继续未完成和失败项` 与 `按当前模型全部重跑 N 项`。复核状态/进度与来源必须基于最新扫描批次，而不是选中模型的旧历史批次；即使用户切回旧模型，也能继续最新批次的未完成项。无有效来源批次时不得显示可将 remaining 误当全量的按钮。后者必须重跑完整可执行 AI 候选范围，包含以前成功项；全量按钮确认数须与实际非人工候选范围一致，并说明可能新增费用；成功启动/排队的反馈不得误称“已存在且未重复创建”；并显示旧批次失败数及易懂的停止原因。中英文文字一致，按钮样式沿用当前全站规范。
- [x] 跑聚焦测试、`pnpm typecheck` 与相关 UI/集成检查；提交。历史调用方应保留类型收窄，不用宽泛断言掩盖空结果分支；另加类型级回归断言：即使显式请求先被保存为一个带 `mode/requestId` 的变量，调用结果仍须包含“空范围”分支，不能因重载顺序误推断为必定创建批次。

## Task 6：修正现有监控页，不再把历史行称为当前排队

**Files:** `src/app/api/ai/worker/route.ts`，`src/app/settings/ai/worker/worker-monitor-client.tsx`，`src/lib/ai-overlay.ts`，`src/lib/i18n.ts`，`tests/integration/ai-worker-monitor.test.ts`，相关 AI 生命周期测试。

**Interfaces:** 当前队列只统计仍可执行的 `queued/running` 批次项目；暂停、取消、完成、失败批次的项目不计入当前队列，跨批次总量另起“历史累计”字段。历史项目总数和状态数覆盖所有保留项目，包括被人工终判标记排除的项目；另给出已排除数量，且排除只影响可执行队列。只有 Worker 心跳未过期、尝试仍为 running 且已记录 `send_started_at`、尝试 ID 等于项目 `active_attempt_id`、项目租约尚未过期时，才算“当前在途 API 调用”并占 Worker 活动槽位。批次暂停/取消会阻止任何新发送，但不代表已发送请求已结束；这类仍满足上述条件的请求必须保留在当前在途列表并标注“取消中”，直到精确尝试结束/中止。失联 Worker、尝试不匹配或租约过期的记录归入待确认区：HTTP 状态码证明已收到服务商响应；有发送标记但无响应时显示“可能已发出、结果待确认”；只有错误码明确为 `AI_ATTEMPT_NOT_SENT` 才显示“发送前停止”；旧记录无发送标记且无响应证据时显示“发送状态未知”。以上待确认记录均不占槽位。近期调用审计保留发送阶段及响应证据。取消批次中保留的 queued 项目显示为历史未发送项，不得呈现为当前排队。刷新失败时保留旧数据显示，但醒目标注数据过期和最后成功更新时间。批次列表展示停止原因/时间；删除扫描后的审计标为历史、去标识。

- [x] 先构造同一扫描多个历史批次的失败测试，确认当前队列只统计可执行批次，不等于所有 `ai_review_items` 行之和；取消批次中的 queued 行只作为历史未发送项展示，仍可供显式 remaining 使用；历史 API 请求总数仍按真实调用累计。另覆盖 Worker 心跳过期、发送未开始、尝试 ID 不匹配或租约过期时只显示为待确认，不计入当前调用和活动槽位；暂停/取消后已进入发送阶段且仍持有有效租约的原请求显示为“取消中”在途调用，直至它结算。暂停后既有终态失败记录/详情不得减少，实时 queued/running 计数按停止后的可执行状态归零；在途请求结算只更新原尝试，不创建后续请求。
- [x] 覆盖监控 API 刷新失败：旧数据仍可见，但 UI 显示过期提示和最后成功时间；确认轮询/重复 GET 不改变批次或触发 API 调用。
- [x] 活动请求与近期审计均展示安全项目标识、尝试序号/重试周期及停止状态；增加去标识删除历史、匿名/访客拒绝、敏感字段缺席和重复 GET 无副作用测试。
- [x] 修正现有路由的全表 `GROUP BY status` 与 UI 标签，不新建第二套监控基础设施。监控页/扫描复核页所示当前进度均按选中或最新相关批次，扫描级汇总按扫描项目去重。
- [x] 跑聚焦测试并通过隔离本地 Docker 栈只读检查管理员监控页；管理员看到历史 queued 与当前队列零分开展示，且 API、页面及 provider 用量一致。
- [x] 完成独立代码复核、复跑监控/lifecycle 套件并提交 Task 6 监控修正。

## Task 7：端到端验证与 NAS 发布门禁

**Files:** 上述测试、必要时现有 `compose.local-validation.yaml` / `compose.ai-monitor-smoke.yaml`；部署文件仅在镜像引用确需更改时调整。

- [x] 跑聚焦五套测试（129/129）及完整测试（248/248），再跑 `pnpm lint`、`pnpm typecheck` 和所有变更文件的 Prettier 检查；不因旧测试固定错误行为而跳过或删掉它们。
- [x] 用唯一 Compose 项目名、独立数据库/卷与假模型验证 Web + AI Worker 的代表性完整流程，不复用或停止本机其他 Compose 项目：一次成功调用落库；暂停第二批次后重启 AI Worker，确认新假请求仍为 0、活动队列为 0 而历史保留；管理员明确继续后恰好新增一次假模型调用；监控 API 与页面显示批次、历史和实际返回用量。三次失败、Retry-After、配置变更和删除扫描等分支由完整 SQLite 集成测试覆盖；不调用真实模型或真实扫描。
- [x] 最终复核修复后构建独立 `linux/amd64` 镜像 `accesscheck-ai-lifecycle:20260929-r9`，并复验 Docker 健康、成功调用、暂停/重启栅栏、显式继续及只读页面检查。
- [x] NAS 只读预检确认数据库版本 33、无活动 AI 项目/调用；在 `/vol1/AccessCheck/app/data/backups/accesscheck-pre-ai-worker-r9-20260929.db` 创建并验证完整性备份（`integrity_check=ok`）。
- [ ] 将 NAS 当前 Web/AI Worker 正在使用的镜像 ID 保留为精确回滚标签，经局域网传输已验证镜像；只更新 Web，让它完成 v33→v37 迁移并先检查新迁移记录、SQLite 完整性与既有批次/调用数量。
- [ ] Web 迁移验证通过后才重建 AI Worker；不在 NAS 构建、不重启 Caddy、普通 Worker、egress-proxy 或无关服务。
- [ ] NAS 上只做容器/健康、迁移完整性、管理员监控权限及只读统计检查，不新建真实 AI 批次。若 Web 在 v33→v37 后健康检查失败，优先恢复旧应用镜像并保留兼容的新增列/表；这些迁移为添加式，不能因代码回滚就自动把数据库倒回快照，以免丢失备份之后的写入。仅当迁移/数据完整性实际损坏时，才停掉所有写入服务、确认快照之后没有需要保留的新数据并执行数据库恢复。报告实际验证结果和未验证风险。
