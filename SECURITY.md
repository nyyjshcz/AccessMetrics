# 安全边界与报告漏洞

本项目扫描的是公开网站，扫描目标视为不可信输入。生产 Worker 必须运行在非 root、seccomp、隔离网络和固定 egress proxy 约束下；不得把 `private-inputs/` 挂载到扫描容器，也不得把密钥、Cookie、未清理 HTML、人工 receipt 或签章件提交到 Git。

安全控制包括：

- 目标 URL 协议、凭据、localhost、私网、metadata、IPv4/IPv6 变体和重定向检查；
- admin/reviewer role-bound HttpOnly 会话、独立 CSRF、Origin 校验和安全响应头；
- axe/页面原文进入私有证据或受控导出前进行敏感字段与路径扫描；
- 发布只接受 verified/current/final_verified、R1–R5 evidence、通过的验证/构建证明和已批准的公开范围；
- 公开 ZIP、报告和 manifest 在发布前重新计算 hash，不信任客户端提交的 hash。

发现漏洞时，请不要把凭据、真实站点原文或个人信息贴到公开 issue。先在私有环境记录复现步骤、影响范围和脱敏证据，并联系项目负责人；修复前保持相关结果或发布状态为 fail-closed。
