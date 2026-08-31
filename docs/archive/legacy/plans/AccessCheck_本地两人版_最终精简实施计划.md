# AccessCheck 本地两人版：最终精简实施计划

> **历史参考。** 本文记录某一阶段的实施计划，不描述当前代码、权限模型或运行命令。请先读 [文档地图](../../../README.md)。

## 总结

将项目收敛为本地小工具，固定主流程：

**新建扫描 → axe-core 扫描 → 查看结果 → 处理 incomplete → 生成报告 → 发布归档**

不保留登录、角色、双人审核、代表样本、formal study、R1–R5、人工抽样队列等研究型流程。已有旧表和旧 migration 可以留在数据库中，但不再进入主流程；本次不新增 migration。

本地两位使用者完全同权、无登录。已发布报告可匿名打开；因此部署时应仅暴露给可信本机或内网。

---

## 1. 先删除旧入口并整理基础启动逻辑

**目的：** 先让项目只剩“小工具”需要的概念，避免旧研究流程继续干扰页面、接口和测试。

- 删除管理员、Reviewer、双 Reviewer、角色 Cookie、登录页、权限判断和相关 API。
- 删除正式研究、study freeze、formal review、代表样本、分组抽样、R1–R5、人工工作台及其页面/API/测试/脚本；不保留兼容跳转，旧地址直接失效。
- 删除 `src/lib/review-workbench.ts` 及仅服务旧审核流程的组件和辅助逻辑。
- 保留 scanner、WCAG catalog、原始 axe 结果、原始评分核心、AI provider 加密能力和现有 SQLite 数据库。
- 修改 `src/lib/startup.ts`：
  - 删除 admin、reviewer、CSRF secret 的生产启动要求；
  - `SESSION_SECRET` 仅用于加密 AI Provider API Key；
  - 生产环境不得使用默认 `SESSION_SECRET`，开发环境可使用现有开发默认值。
- 同步清理 `.env.example`、README、`package.json` 和测试脚本中的角色、研究、审核文案与环境变量。

**数据库：** 不新增 migration；旧认证、study、review 相关表可保留但不再使用。

**验收：** 未配置 admin/reviewer/CSRF 环境变量时应用可启动；生产环境使用默认 `SESSION_SECRET` 时明确拒绝启动。

---

## 2. 重建导航与扫描任务主界面

**目的：** 用户不再需要理解“管理端、审核端、研究端”，只看扫描任务。

- 首页改为两个区域：
  - **活动任务**：未发布的扫描；
  - **已发布报告**：已归档任务及其报告入口。
- 顶部导航仅保留：
  - 新建扫描；
  - 活动任务；
  - 已发布报告；
  - AI 设置。
- 删除 `/admin/**`、Reviewer 和 study 页面。
- 新建扫描页保留 URL、扫描范围和基础限制；创建新扫描时不得因同 URL/site 已有已发布任务而拒绝创建。
- 单个扫描结果页固定四个页签：
  1. **概览**：扫描状态、页面数、总览、当前动态评分、下一步提示；
  2. **自动问题**：仅显示 axe `violation`，只读；
  3. **待判断**：仅显示 axe `incomplete`，可人工或 AI 处理；
  4. **报告**：完整统计、报告预览、导出与发布。
- 不再显示“代表样本”“当前建议队列”“全部待核对自动证据”等旧研究概念。

**主要修改：** 重写现有首页、扫描创建页、任务详情页及公共导航；删除旧 issues/review/report 分散页面。

**验收：** 从首页进入任一任务后，用户可在四个页签内完成全部流程，不需要进入任何 admin、reviewer 或 study 地址。

---

## 3. 建立唯一的 incomplete 最终结论规则

**目的：** 让同一个节点始终有一个清晰、可解释的最终状态。

新增 `src/lib/incomplete-resolution.ts`，集中提供结果读取与覆盖逻辑：

```text
人工 local/ad_hoc 结论 > 最新有效 AI 结论 > 原始 incomplete
```

- 人工审核只允许三个值：
  - `problem`
  - `not_problem`
  - `uncertain`
- 继续复用现有 `manual_reviews` 表：
  - 固定 `review_context='ad_hoc'`；
  - 固定 `reviewer='local'`；
  - 每节点只维护一条当前本地人工结论，后续编辑原地更新；
  - 不再创建 reviewer 身份、复核链、版本链或第二次人工检查。
- 历史旧人工审核记录不删除，但不进入新本地流程。
- AI 结论只读取有效、已完成 item；同一节点存在多个历史 AI batch 时，取最新完成的有效 verdict。
- 原始 `violation` 不进入人工或 AI 判断流程；仅 `incomplete` 可处理。
- 原始 axe JSON、`result_nodes`、原始 score 永不写回或覆盖。

评分继续复用 `ScoreOpportunity` 与 `exactBreakdown`：

```text
problem     → fail opportunity
not_problem → pass opportunity
uncertain / 原始 incomplete → 不创建 opportunity
```

AI 或人工解决 incomplete 时 impact 固定使用：

```ts
classifyImpact(node.effective_impact ?? ruleResult.impact) ?? "minor"
```

WCAG、原则映射和 scoring eligibility 继续从现有冻结 catalog 读取，模型和人工页面均不修改这些定义。

**验收：** 无人工/AI overlay 时评分与当前原始评分完全一致；人工结论必定覆盖 AI，AI 永不覆盖人工。

---

## 4. 保留薄 AI Resolver，并收敛 batch 行为

**目的：** AI 仅处理 incomplete，不成为第二套系统。

继续复用现有三张 AI 表和单进程 SQLite worker：

- `ai_provider_configs`
- `ai_review_batches`
- `ai_review_items`
- `src/worker/ai.ts`

只保留“整个 run 的 AI batch”：

- 不再创建 page batch；
- 不再创建 formal/study batch；
- 不再有 AI 工作台；
- 不新增表、不新增状态机、不新增队列服务。

### Batch 规则

- 同一个 run 任意时刻最多有一个 `queued` 或 `running` batch。
- 不增加数据库唯一约束；在 create、resume、retry API 的现有 SQLite 事务中查询并判断：
  - 若已有活动 batch，创建请求直接返回该 batch；
  - 其他 batch 不得进入 `queued`。
- 每次将 batch 重新置为 `queued` 前，统一重新查询并排除已有 `local/ad_hoc` 人工结论的节点：
  - create；
  - resume；
  - retry。
- 被人工处理的待处理 item 从本次活动队列移除；不调用模型。
- 不增加 Worker 逐节点二次人工检查：运行中人工编辑已被锁定，因此无需复杂并发处理。
- `queued`、`running`：锁定该 run 的人工编辑。
- `paused`、`completed`、`failed`、`cancelled`：恢复人工编辑。
- 已完成 AI 结论可在解锁后被人工覆盖。
- 模型失败、非法 JSON、非法 verdict、超时、429、5xx 均按现有重试机制处理；最终记录为 `failed`，不得伪装为 `uncertain`。
- 模型只允许返回 `problem`、`not_problem`、`uncertain` 及简短原因。

### AI Provider

保留 `/settings/ai`：

- 仅支持 OpenAI-compatible：
  - `GET /v1/models`
  - `POST /v1/chat/completions`
- Provider API Key 仅服务端解密读取。
- 保留已有 URL 安全规则：本机地址可 HTTP，其他地址必须 HTTPS；禁止 URL credentials 与自动 redirect。
- batch 继续冻结 provider snapshot、模型、请求参数、key fingerprint、prompt version、prompt hash 与 evidence version。

**验收：** 重复点击开始不会生成两个活动 batch；暂停后人工可编辑；恢复或重试时已有人工作结论的节点不会再被发送给模型。

---

## 5. 重做 AI evidence，但保持 best-effort

**目的：** 让 96K 本地模型获得足够上下文，同时不重复存储 axe 数据，也不因证据不完整阻断流程。

修改 `src/lib/scan-page.ts` 和 AI prompt 构建逻辑：

- 仅在 Playwright frame 仍存在时，使用原始 axe `node.target` 采集 evidence。
- 禁止从持久化 `target_json`、framePath 或扫描结束后的页面重新反推 DOM。
- `ai_evidence_json` 只保存页面事实，不重复保存：
  - axe rule；
  - failureSummary；
  - any/all/none；
  - 原始 axe JSON；
  - WCAG；
  - impact；
  - severity；
  - scoring eligibility；
  - 原始 target selector。
- evidence 内容包括：
  - 目标元素的 `outerHTML`，固定截断；
  - 标签、属性、ARIA、可访问名称、label 及关联元素；
  - 父元素与最多五层祖先；
  - 有限数量的相邻兄弟节点；
  - 页面 URL、标题、语言、heading、landmark、主要可见文字；
  - 清洗后的语义 DOM 摘要；
  - 可见性、焦点、布局、尺寸、CSS、颜色与可计算的 contrast；
  - `warnings`、截断标记和采集状态。
- 所有 evidence 合并后的上限为 **60,000 Unicode 字符**：
  - 不增加 tokenizer；
  - 按固定优先级保留目标元素、关联元素、祖先、页面结构和文本；
  - 超出时确定性截断并记录 warning。
- axe rule、failureSummary、any/all/none、原始定位信息在调用模型时从现有扫描数据读取并拼入提示词，不写回 evidence。
- evidence 一律 best-effort：
  - 字段缺失写 `null` 和 warning；
  - evidence 采集异常不得让 axe scan 失败；
  - 旧扫描没有 evidence 时仍可创建 AI batch，提示词标记 `evidence_not_captured`；
  - 信息不足时模型应返回 `uncertain`，不再返回 `RESCAN_REQUIRED`。

**验收：** evidence 缺字段时扫描仍成功；prompt 不含整页 raw HTML；`ai_evidence_json` 不复制 axe 原始规则数据；总字符数不超过 60,000。

---

## 6. 简化待判断页面与人工审核

**目的：** 人工能直接看网页并作出一次简单结论。

“待判断”页按节点分页展示，每项包含：

- 原网页链接；
- 页面标题和 URL；
- 目标元素；
- axe 规则说明、failureSummary、any/all/none；
- 当前最终状态及来源：人工、AI 或未处理；
- 三个按钮：`problem`、`not_problem`、`uncertain`；
- 可选备注；
- AI verdict、AI reason；
- 当前动态评分影响；
- 默认折叠的技术 evidence。

服务端人工保存接口在 batch 为 `queued/running` 时返回锁定错误；前端同时禁用按钮，但以后端判断为准。

**接口收敛：**

- `GET /api/scans?view=active|published`
- `POST /api/scans`
- `GET /api/runs/[runId]/incomplete`
- `POST /api/runs/[runId]/incomplete/[nodeId]/review`
- `GET/POST /api/runs/[runId]/ai-review`
- `POST /api/ai/batches/[batchId]`：`pause`、`resume`、`retry`
- 保留 AI provider 设置接口，删除 admin/reviewer/study/formal review 接口。
- 所有本地接口无登录、无角色、无 CSRF secret。

**验收：** 用户不需要理解分组、抽样或 Reviewer；打开原网页、看关键信息、选择三值结论即可完成一次人工判断。

---

## 7. 报告与发布归档

**目的：** 发布是任务的最终结束，而不是权限状态。

修改 `src/lib/report.ts`：

- 删除现有 `LIMIT 12`、代表节点 `slice` 及一切“用样本代替统计”的逻辑。
- 所有统计、评分、JSON 导出必须遍历该 run 的**全部**结果节点。
- HTML 可折叠长列表以便阅读，但折叠不得改变完整统计或导出内容。
- 报告明确区分：
  - 自动 violation；
  - 人工判定的 incomplete；
  - AI 判定的 incomplete；
  - 未处理或 uncertain 的 incomplete；
  - 动态评分与原始评分。
- 报告 JSON 导出包含全量节点及其最终结论来源。

发布规则：

- 仅扫描完成的 run 可发布。
- 存在 `queued/running` AI batch 时禁止发布；暂停、完成、失败后的 batch 不阻止发布。
- unresolved 或 `uncertain` 可以发布，报告必须如实统计。
- 发布时生成完整报告/导出，再设置 `published=1`。
- `published=1` 是最终状态：
  - 该 run 的人工审核、AI batch、报告修改和其他写操作全部禁止；
  - 不提供 unpublish、“恢复为活动任务”或重新打开编辑功能；
  - 已发布 run 从活动任务移入已发布报告；
  - 已发布报告匿名可打开。
- 已发布 run 只限制自身；创建同 URL/site 的新 scan job/run 始终允许。

**验收：** 发布后数据只读且仍可查看完整报告；同一网站可立即创建新的独立扫描；含 13 个以上节点的报告不会出现只统计前 12 个的情况。

---

## 8. 测试、脚本与最终质量门

删除旧研究、双 Reviewer、study export、代表样本、formal batch、登录鉴权相关测试与脚本；将 `test:all` 收敛为当前小工具所需测试。

新增或改写测试覆盖：

- 无 admin/reviewer/CSRF 配置时启动成功；生产默认 `SESSION_SECRET` 被拒绝。
- 无登录完成创建扫描、查看结果、人工判断、AI 判断、报告和发布。
- 单 run 同时最多一个 `queued/running` batch。
- create、resume、retry 统一跳过已有人工作结论的节点。
- `queued/running` 锁人工；其他状态解锁。
- 人工优先于 AI；AI 不覆盖人工；旧 AI 有效结论可作为人工未处理时的结果。
- AI 仅处理 incomplete；violation 始终只读。
- evidence 使用 frame 存活时的原始 target；best-effort 不影响扫描；无 raw HTML；60,000 字符上限。
- 无 overlay 的原始评分不变；三种结论对动态评分的映射正确。
- 报告统计与 JSON 导出覆盖全量节点，不再使用 12 条样本截断。
- 发布后 run 只读；发布不阻止同 URL 新扫描。
- 已发布报告可匿名打开。
- fake OpenAI-compatible provider 覆盖 AI worker、暂停、恢复、失败和重试；不伪造真实模型结果。

最终执行：

```text
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm test:all
```

## 固定假设

- 项目部署在可信本机或内网；无登录不提供网络级访问控制。
- `SESSION_SECRET` 由部署者在生产环境配置为非默认随机值。
- 旧数据库表、旧 migration 和旧扫描记录不迁移、不清洗、不伪造兼容结果；新流程只使用现有可复用数据结构。
- 若要重新检查已发布网站，一律创建新的扫描任务，不修改原任务。
