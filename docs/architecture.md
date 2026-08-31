# 当前架构

> **谁需要读：代码负责人。是否必读：代码维护时必读，其他人选读。** 读完你会知道 Web、两个 Worker、SQLite 和报告如何协作。

## 一句话概览

AccessCheck 由一个 Next.js Web 应用、一个扫描 Worker、一个 AI Worker 和一个 SQLite 数据库组成。Web 负责授权、展示和创建任务；两个 Worker 只领取队列中的工作；所有报告都从数据库中的可追溯结果即时生成。

这里要区分两种状态：扫描未完成的页面是页面本身的扫描状态，表示页面没有成功完成扫描；需进一步判断项是 axe 的 `incomplete` 结果，表示规则无法自动可靠下结论。前者是页面覆盖状态，后者是规则或节点级复核状态，两者不是一回事。

## 运行组件

| 组件 | 责任 | 不负责什么 |
| --- | --- | --- |
| Web | 登录、角色授权、扫描/AI/发布 API、结果页面、HTML/PDF/JSON 报告 | 不在浏览器内扫描网页，也不把模型密钥发给浏览器。 |
| 扫描 Worker | 领取扫描任务、校验目标、发现同站页面、调用 Playwright 与 axe、写入结果 | 不处理 AI 队列。 |
| AI Worker | 领取 run-wide 的 incomplete 复核批次、调用已冻结的模型配置、保存辅助结论 | 不改变原始 axe 结果，也不扫描网页。 |
| SQLite | 保存任务、运行、页面、规则、节点、人工/AI 结论和发布状态 | 不作为大型多租户数据库使用。 |

本地运行 pnpm dev 会一起启动 Web、扫描 Worker 和 AI Worker。若数据库中有未完成队列，它们会继续处理；演示前应先确认没有不希望继续的扫描或 AI 批次。

## 访问与角色

服务器配置三把不同的密钥：

| 配置 | 用途 |
| --- | --- |
| ADMIN_ACCESS_KEY | 管理员登录密钥。管理员可创建扫描、配置 AI、复核、发布和删除未发布终态任务。 |
| VISITOR_ACCESS_KEY | 报告访客登录密钥。访客只能读取已发布报告。 |
| SESSION_SECRET | 服务器内部密钥，用于签名 HttpOnly 登录 Cookie，也用于保护保存的 AI Provider Key。不会显示给用户。 |

每个 API 都要求已签名会话；管理 API 要求管理员角色。浏览器带有 Origin 的写请求还必须来自当前应用 Origin。已发布运行保持只读。

## 扫描数据流

1. 管理员提交公开网站首页和本次页面上限。
2. Web 创建 scan job，扫描 Worker 领取它。
3. Worker 在 DNS 解析后验证目标地址，拒绝私网、环回、凭据 URL 和非 HTTP(S) 地址。
4. Worker 在同一站点范围内发现页面，以 Playwright 打开稳定页面并运行 axe-core。
5. 每个页面产生规则结果和节点级证据；成功、失败、重定向合并和扫描未完成页面都会记录。
6. Worker 写入 run 的原始分数和完成状态，Web 随后从数据库读取这些结果并生成报告。

页面上限只是一次任务的最大尝试范围。实际完成页面数取决于网站可发现的独立页面、重定向合并和页面错误。

## 结果与评分数据

核心关系可理解为：

scan job → scan run → pages → rule results → result nodes

其中：

- scan job 是排队任务；
- scan run 是一次可评分、可发布的扫描；
- pages 保存页面覆盖与扫描状态，包括扫描未完成的页面；
- rule results 保存每页规则级统计和 node_count；
- result nodes 保存 violation / incomplete 的详细证据；
- 人工与 AI 结论只附着于 axe `incomplete` 节点，也就是需进一步判断项，不附着于扫描未完成页面这一页面状态。

通过和不适用节点不需要持久化为大量 result nodes，它们的真实数量来自 rule results 的 node_count。这样统计完整而存储不会被无意义的通过节点淹没。

评分算法及其边界见 [评分解释](./scoring-explained.md)。

## AI 辅助复核数据流

1. 管理员从已保存的模型服务中选择一个配置。
2. Web 为当前 run 的全部 incomplete 项创建一个批次，并冻结当时的模型、地址、Key 指纹、并发与限速策略。
3. AI Worker 只领取新的 run-wide 批次；旧的 page、formal 或 study 批次不会被新版 Worker 执行。
4. AI 结论保存为 problem、not_problem 或 uncertain，并附带简短理由。
5. 读取结果时按人工 > AI > 原始 incomplete 的顺序计算有效结论。原始 axe 数据永不被覆盖。

模型服务暂时不可用或 429 限流时，单项会保持在可自动恢复的等待队列中；批次不会因为单项暂时错误而要求人工逐项继续。

## 报告与发布

未发布运行只能由管理员在管理界面预览。发布后：

- scan run 及其复核数据变为只读；
- 管理员与报告访客可读取同一份 HTML、PDF 或 JSON 报告；
- HTML 报告从当前数据库结果生成，先展示评分、覆盖范围和高优先级事项，再按需展开节点证据；
- 报告明确标出自动问题、需进一步判断项目、人工结论与 AI 结论，不把它们混为一谈。

## 安全和部署边界

生产扫描 Worker 必须通过显式的 EGRESS_PROXY_URL 出站；Web 为 PDF 渲染可使用独立的浏览器出站路径。生产部署使用 compose.prod.yaml、Caddy、三把 Docker secret 和独立数据目录，完整步骤见 [部署说明](./ops/deployment.md)。

系统的目标是小规模、可追溯的评估，不是开放式爬虫、通用 AI 平台或大型多租户 SaaS。
