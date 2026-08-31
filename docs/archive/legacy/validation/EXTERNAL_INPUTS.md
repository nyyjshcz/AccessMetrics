# 运行时与部署输入（历史参考）

> 本文保留的是旧的集中输入说明。当前本地配置请看根目录 README；当前运行和部署要求请看[运维说明](../../../operations.md)、[部署说明](../../../ops/deployment.md)和[安全边界](../../../安全边界.md)。

AccessCheck Lishui 是一个带两级访问范围的自托管工具：管理员处理扫描与发布，访客只读取已发布报告。主流程是：

`新建扫描 → axe 扫描 → 查看结果 → 处理 incomplete → 生成报告 → 发布归档`

## 本地运行

复制 `.env.example` 为 `.env.local`，设置随机的 `SESSION_SECRET`，以及不同的 `ADMIN_ACCESS_KEY` 和 `VISITOR_ACCESS_KEY`。前者用于 AI Provider Key 加密和会话签名；后两者分别登录管理员和访客范围。数据库、私有证据和公开导出目录由 `DATABASE_URL`、`PRIVATE_EVIDENCE_ROOT` 和 `PUBLIC_EXPORT_ROOT` 指定；这些目录和密钥不要提交到 Git，也不要通过静态文件服务暴露。

扫描只面向公开、且使用者有权检查的 HTTP/HTTPS 网站。默认只爬取同源页面并尊重 robots.txt；可在新建扫描时设置页面上限（1–15）。本地扫描、人工处理、AI 处理、报告导出和发布均可直接从应用界面完成。

## 可选 AI 输入

需要 AI 处理 incomplete 项目时，在 `/settings/ai` 添加 OpenAI-compatible Provider，填写 Base URL、模型和 API Key。Key 由服务端使用 `SESSION_SECRET` 加密保存，不要写入 Git、日志或公开导出。Provider 地址必须符合应用的 URL 规则：仅 HTTP/HTTPS、不得包含凭据；非 localhost 地址必须使用 HTTPS，调用不会自动跟随重定向。

## 生产或共享网络部署

生产部署使用管理员/访客访问密钥作为应用访问边界，但仍应配置 TLS、真实域名、与外部 HTTPS 访问源完全一致的生产 `APP_BASE_URL`、Docker secret 形式的三把密钥和独立的数据/证据目录。生产扫描 Worker 还必须配置 `EGRESS_PROXY_URL`；代理、容器隔离和实际部署环境属于部署者的外部输入。没有这些条件时，不要把本地服务直接暴露到公网。具体步骤见 [部署说明](../../../ops/deployment.md)。

凭据、Cookie、真实站点原文、人工备注及其他敏感材料只放在 Git 之外的受控目录。若需要重新检查已发布网站，请创建新的扫描任务；已发布任务保持只读。
