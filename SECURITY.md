# 安全边界与报告漏洞

AccessCheck Lishui 当前是本地两人版：应用没有用户身份认证或角色分级。能访问应用的人可以创建扫描、读取活动任务、配置 AI Provider、处理 incomplete、发布任务，并读取已发布报告；已发布报告接口明确允许匿名读取。因此应只绑定到可信本机或受控内网，不能把应用自身当作访问控制边界。

## 已实现的边界

- 扫描目标必须是长度不超过 2048 个字符、无 URL 用户名/密码的 HTTP 或 HTTPS URL。
- 应用拒绝 localhost、`.localhost`、云元数据主机名，以及解析到环回、私网、链路本地、保留、组播、文档网段或 IPv4-mapped IPv6 地址的目标；DNS 返回的全部地址都会检查。
- 爬虫默认限制在同源页面；浏览器的网络请求也逐个通过 URL 校验，跨源重定向会被拒绝。生产 Chromium 必须使用显式 `EGRESS_PROXY_URL`，不能依赖进程级代理变量来代替它。
- 新建扫描接口有进程内速率限制，并支持 `idempotency-key` 防止重复创建；这不是跨实例或网络级防护。
- 会改变数据的 API 在提供 `Origin` 时要求它与 `APP_BASE_URL` 同源；生产部署的 `APP_BASE_URL` 必须设置为用户实际访问的外部 HTTPS 源，否则同源保护配置不正确。未提供 `Origin` 的本地脚本请求仍可用，因此这不是身份认证。
- Next.js 配置启用 `X-Content-Type-Options`、`X-Frame-Options`、`Referrer-Policy`、`Permissions-Policy` 和限制性的 Content Security Policy。
- AI Provider 请求禁止自动跟随重定向；API Key 仅在服务端解密使用，日志会脱敏常见凭据字段。
- 公开包隐私检查逻辑会检查路径、符号链接、凭据/Token、Cookie、邮箱、手机号、私有路径和原始 HTML 等敏感内容；发布报告只允许已完成且未处于活动 AI 批处理的扫描，发布后任务只读。

这些控制不能替代网络隔离、容器沙箱、密钥管理或对目标网站的授权。生产 Worker 应运行在非 root、受限网络和合适的浏览器沙箱中；私有证据、数据库和 Provider Key 不得提交到 Git 或挂载为公开资源。

## 报告漏洞

请不要在公开 issue 中粘贴凭据、真实站点原文、Provider 响应或个人信息。先在私有环境记录复现步骤、影响范围和脱敏证据，再联系项目负责人；在修复前停止相关扫描或发布，并轮换已暴露的凭据。
