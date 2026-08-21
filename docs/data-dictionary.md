# 数据字典（摘要）

| 表                          | 用途                                       | 关键不变量                                                     |
| --------------------------- | ------------------------------------------ | -------------------------------------------------------------- |
| `sites`                     | 网站身份                                   | `origin` 唯一                                                  |
| `scan_jobs`                 | 用户提交和 Worker lease                    | 幂等键唯一、状态单向推进                                       |
| `scan_runs`                 | 一次冻结版本的扫描                         | 绑定 scanner/axe/catalog/model                                 |
| `pages`/`job_pages`         | 页面身份和发现顺序                         | `job_page_id`/`(run_id,normalized_url)` 唯一、完成页不重复扫描 |
| `rule_results`              | axe 四类规则结果                           | `(run,page,rule,result_type)` 唯一                             |
| `result_nodes`              | violation/incomplete 可追溯节点            | 清理 HTML、target hash、严重程度来源                           |
| `page_scores`/`site_scores` | 精确评分                                   | 整数分子/分母权威，REAL 只展示                                 |
| `study_*`                   | 研究 campaign/freeze/export                | hash、run set、population digest 绑定                          |
| `manual_*`                  | 抽样、复核、裁决                           | revision 和 current 指针，不覆盖旧记录                         |
| `human_gate_*`              | R1–R5 evidence/outbox                      | receipt hash 和私有路径                                        |
| `r5_sessions`               | 双 reviewer 的固定练习、理解检查、A–E 交接 | role+rcCommit 唯一；三类 artifact hash 后才能 finalized        |
