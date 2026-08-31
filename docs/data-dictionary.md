# 当前运行数据说明

> **谁需要读：需要核对数据库字段或写数据分析的人。是否必读：按需查阅。** 它解释字段含义，不是项目入门教程，也不是数学负责人的主资料。

这不是一份把所有 SQLite 历史迁移表逐项罗列的数据库手册。它只解释当前本地两类访问密钥、扫描、复核和发布流程实际读取或写入的数据。数据库中仍保留一些早期 study、reviewer 与 R1 到 R5 相关表，以便旧数据库能够打开；它们**不是当前产品功能，也不应作为项目展示内容**。

## 一次扫描的主链路

```text
scan_jobs → scan_runs → job_pages / pages → rule_results → result_nodes
                                           └→ page_scores / site_scores
```

| 数据 | 当前用途 | 展示或计算时的关键事实 |
| --- | --- | --- |
| `sites` | 保存站点 origin 和显示名称。 | 一个站点可对应多次扫描；删除一项扫描不会删除共享站点身份。 |
| `scan_jobs` | 用户提交的扫描任务及其状态、页面上限、错误和 Worker 租约。 | `max_pages` 是上限，不是已发现或成功页数的承诺。尚未创建 run 的失败任务也会保留在这里。 |
| `scan_runs` | 一次可评分、可发布的扫描快照。 | 记录扫描、axe、规则目录与评分模型版本；`published=1` 后该 run 只读。 |
| `pages` | 某次任务实际发现的规范化页面 URL 与扫描状态。 | 重定向或重复页面会被合并；因此发现页数可能少于页面上限。 |
| `job_pages` | 任务与页面之间的发现顺序、尝试次数、页面级状态和错误。 | 用于解释“发现、成功、失败、未完成”之间的差异。 |
| `rule_results` | 每页、每条 axe 规则的 `pass`、`violation`、`incomplete`、`inapplicable` 结果。 | `node_count` 是规则命中的真实节点数。通过和不适用节点不另存为大量详细节点。 |
| `result_nodes` | `violation` 和 `incomplete` 的定位、清理后的 HTML、failure summary 与技术证据。 | 它是报告可展开证据的来源；其行数**不能**用来代表 pass / inapplicable 的节点数。 |
| `page_scores` | 单页四原则与总分的精确分子、分母和展示值。 | 分子、分母和模型版本比前端显示的小数更权威。 |
| `site_scores` | 一个 run 的汇总四原则与总分。 | 报告和结果页用它呈现原始自动扫描评分。 |

## incomplete 的人工与 AI 复核

```text
incomplete result_node
  ├─ manual_reviews       本地人工结论（优先）
  └─ ai_review_items      AI 辅助结论
       ↑
  ai_review_batches ← ai_provider_configs
```

| 数据 | 当前用途 | 关键不变量 |
| --- | --- | --- |
| `manual_reviews` | 保存本地人工对 incomplete 节点的结论和备注。 | 当前展示只读取 `sample_id IS NULL`、`review_context='ad_hoc'`、`reviewer='local'`、`is_current=1` 的本地结论。人工结论优先于 AI。 |
| `ai_provider_configs` | 保存 OpenAI-compatible 模型服务地址、模型名、加密后的 Key、并发与可选 RPM 策略。 | API Key 不返回给浏览器；页面只显示 Key 指纹。 |
| `ai_review_batches` | 一个 run 的全部 incomplete 项的 run-wide 批次和冻结的模型配置快照。 | 新 Worker 只领取 `run_id` 存在且没有 page/study 范围的批次。 |
| `ai_review_items` | 批次中每个 incomplete 节点的队列状态、租约、尝试、AI verdict 与错误。 | 结论只允许 `problem`、`not_problem`、`uncertain`；暂时错误会保留为可自动恢复的队列项。 |

读结果时采用唯一优先级：**人工结论 > AI 结论 > 原始 incomplete**。这不会修改原始 axe 规则结果或节点证据。

## 发布、导出与删除

| 数据 | 当前用途 | 边界 |
| --- | --- | --- |
| `exports` | 保存一个 run 的 HTML、PDF、JSON 导出元信息。 | 已发布 run 的报告对管理员和报告访客只读。 |
| `scan_runs.published` / `published_at` | 标记是否已发布。 | 已发布 run 不能复核、修改或删除。 |

删除未发布终态任务时，系统会在同一事务中清理该任务的 run、页面关联、规则结果、节点、评分、人工结论和 AI 批次/项目；不会删除共享 `sites` 或模型服务配置。被研究历史引用的数据则拒绝删除。

## 兼容保留的数据

`study_*`、`manual_review_batches`、`manual_review_samples`、`manual_review_adjudications`、`review_freezes`、`human_gate_*`、`r5_*`、旧 `users` / `sessions` 等表来自以前的研究或多 reviewer 方案。当前 Web 不用它们提供登录、角色或评审工作流；保留它们只是为了让既有 SQLite 数据库安全迁移和可追溯。

若要核对实现，请以 `src/lib/db.ts` 的迁移、`src/lib/repositories.ts`、`src/lib/incomplete-resolution.ts` 与 `src/lib/ai-overlay.ts` 为准。
