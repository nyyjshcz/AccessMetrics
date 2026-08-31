# 薄 AI Overlay 最终实施计划：逐条自审记录

> **历史参考。** 本文是 AI 方案演进时的自审记录；当前行为以 [架构](../../../architecture.md) 和代码为准。

日期：2026-08-25  
审计对象：当前 `codex/thin-ai-overlay` 工作区  
审计原则：只核对最终实施计划，不把 fixture、fake provider 或模型草稿当成正式研究证据；发现外部输入缺失时保持 `WAITING_EXTERNAL_INPUT`。

## 结论

薄 AI Overlay 的代码、数据库、页面、worker、评分和 `study_final_ai` 导出链已经按最终计划落地。原始 axe JSON、原始 `result_nodes` 事实、原始分数、人工审核、WCAG catalog、study freeze、human `study_final` 和既有 study CSV contract 没有被替换或另建平行系统。

本轮自审额外修正了四个边界：

1. 创建 formal AI batch 前，重新从 study freeze 的 canonical run population 计算 digest 和数量；不一致直接要求重新建立 freeze。
2. 终态 `failed` batch 不能被“继续”按钮绕过，必须显式“重试失败项”，保留失败语义。
3. 页面范围优先读取该页面 batch，run 范围读取 run batch；卡片显示 batch 已冻结的模型快照。
4. 增加真实 Playwright incomplete 节点的 evidence 断言，以及 frozen population 失配、失败续跑和重试边界测试。

## 逐条核对表

| 计划要求 | 实现位置 | 自动化核对 | 状态 |
| --- | --- | --- | --- |
| 只做薄 overlay，不建第二套评分/研究系统 | `src/lib/ai-overlay.ts`、`src/lib/run-score.ts`、`src/lib/study-export.ts` | `pnpm db:check`；scoring/integration 全量测试 | PASS |
| `result_nodes` 只有三个 evidence 字段；只增加三张 AI 表 | `src/lib/db.ts` migration 027、`scripts/db-check.ts` | schema 测试断言 AI 表精确为三张；db-check 无缺表/索引 | PASS |
| 旧扫描没有完整 evidence 必须 `RESCAN_REQUIRED`，不从持久化 target 反推 | `src/lib/ai-overlay.ts` 的 `ensureEvidence/queryIncompleteNodes` | `tests/scoring/ai-overlay.test.ts` 旧节点测试 | PASS |
| incomplete 在 Playwright frame 尚存在时按原始 axe `node.target` 采集 | `src/lib/scan-page.ts` 的 `collectAiEvidence` | `tests/integration/scan-fixture.test.ts` 真实 fixture 产生 incomplete，并检查 target/hash/version | PASS |
| evidence best-effort；字段可为 null、warnings 不阻断 axe 扫描 | `src/lib/scan-page.ts` 的安全采集和异常兜底 | scan fixture 与扫描全量回归 | PASS |
| evidence 不复制 rule/impact/WCAG/scoring 信息；运行时从现有结果和 catalog 读取 | `src/lib/repositories.ts`、`src/lib/ai-overlay.ts`、`src/lib/run-score.ts` | fixture 断言 evidence 不含 rule/impact/wcag；catalog check | PASS |
| provider 只走 OpenAI-compatible `/v1/models`、`/v1/chat/completions` | `src/lib/ai-overlay.ts`、`/admin/settings/ai` 及 provider routes | fake OpenAI-compatible provider 测试；Next build | PASS |
| URL、redirect、API Key 和 snapshot 安全边界 | `validateAiProviderUrl`、`redirect: "error"`、AES-GCM 加密和 provider snapshot | URL policy 与 fake provider 测试 | PASS |
| 固定 prompt 只能产生 problem/not_problem/uncertain；非法响应失败重试，不能冒充 uncertain | `AI_PROMPT_VERSION`、`parseVerdict`、`processNextAiItem` | fake provider、失败/重试测试 | PASS |
| lease、自动保存、暂停/继续、重启恢复、幂等和失败重试 | `src/worker/ai.ts`、`claimNextAiItem`、`retryAiBatch` | scoring worker 测试；`UNIQUE(batch_id,result_node_id)` schema 断言 | PASS |
| overlay 只处理原始 incomplete；problem=fail、not_problem=pass、uncertain 不建 opportunity | `src/lib/run-score.ts` | 三值映射测试、原始 score/overlay opportunity 测试 | PASS |
| AI resolved incomplete 使用指定 impact 公式，WCAG/scoringEligible 仍来自 catalog | `aiImpactForResolvedIncomplete`、`catalogEntryWithTags` | scoring 测试与 catalog check | PASS |
| 页面/run 共用同一批次模型；正式研究一个 freeze 一个 formal batch，run/page 为 NULL | `createAiBatch`、`formalBatchForStudy`、AI routes | formal batch null scope/idempotence 测试；本轮 population digest 失配测试 | PASS |
| formal batch 直接读取 frozen population，population 变化要求重新 freeze | `queryIncompleteNodes` 的 `canonicalPopulation` digest/数量复核 | `STUDY_POPULATION_CHANGED` 测试 | PASS |
| 页面只增加 provider 设置和现有 scan 卡片；详情展示 evidence/verdict/reason/动态 impact | `src/app/admin/settings/ai/page.tsx`、`src/components/ai-overlay-card.tsx`、issues page | Next build；E2E 原有流程仍通过 | PASS |
| `study_final_ai` 是独立分支，不要求 human review freeze/R2/R3/R4，不改变 study_freezes.status | `src/lib/study-export.ts` 独立分支 | `tests/integration/study-chain.test.ts` 检查无人工门且 status 不变 | PASS |
| study_final_ai 只新增五个 AI 文件并纳入 manifest/hash，不改既有 CSV contract | `writeAiStudyArtifacts`、`fileManifest`、manifest validator | study-chain 导出文件和 manifest 测试；`contract:check` | PASS |
| total_incomplete=0 时两类 coverage 均为 100%；uncertain 可导出，failed 阻止导出 | `batchStats`、study_final_ai 门槛 | 空 population、formal export 和 failed 状态测试 | PASS |
| 原始 axe、原始 score、人工审核、catalog、human study_final 保持不变 | repository raw snapshot 分离、可选 overlay、human export 分支未改写 | integration/scoring/export 回归；`pnpm test:all` | PASS |

## 本轮质量门结果

使用仓库规定的捆绑运行时（Node 24.19.0、pnpm 11.19.0、Python 3.12.13）执行：

- `pnpm lint`：通过；
- `pnpm format:check`：通过；
- `pnpm typecheck`：通过；
- `pnpm test:all`：通过；其中 integration 8 个文件/26 个测试、scoring 8 个文件/39 个测试、全量 16 个文件/65 个测试；
- Python 分析和可执行 notebook：通过；
- Next production build：通过，仅保留既有 middleware/tracing/standalone 非失败警告；
- Playwright E2E：3 个测试通过；
- `pnpm db:check`、`pnpm contract:check`、`pnpm catalog:check`、`pnpm docs:check`、`pnpm handoff:check`：均通过。

## 仍然等待的外部输入

以下内容没有被伪造，也不应由 fake provider 或 fixture 替代：

- 真实 Qwen 3.8-27B（或其他负责人选定的 OpenAI-compatible provider）Base URL、模型和 API Key；
- 真实研究站点、访问许可、R1–R5 双负责人确认、正式 study source/freeze 数据；
- 生产服务器、域名、密钥、egress proxy、Docker/镜像和 Playwright/文档渲染器 digest；
- LibreOffice/Poppler 的正式视觉 QA 和负责人签收。

因此当前项目状态仍是 `WAITING_EXTERNAL_INPUT`。收到真实输入后，按[旧版外部输入说明](../validation/EXTERNAL_INPUTS.md)记录并使用 `pnpm project:resume` 幂等续跑。
