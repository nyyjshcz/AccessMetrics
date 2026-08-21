# 运维

- 本地：`pnpm db:migrate`、`pnpm dev`、`pnpm worker`。
- 检查：`pnpm test:all`、`pnpm test:e2e`、`pnpm project:status`。
- 依赖基线：`pnpm dependency:preflight` 会实际执行 `PYTHON_BIN`（或系统 `python`/`python3`）；必须得到 Python 3.12.13，不能用 `PYTHON_VERSION` 环境变量冒充。
- 备份：`pnpm backup:create -- --output <绝对目录>`；恢复到新副本后运行 `pnpm backup:restore <备份绝对目录> <新目标绝对目录>`、在新目标设置 `DATABASE_URL` 后运行 `pnpm db:check`，再对恢复的私有根运行 `pnpm gates:verify`。
- 条件式接收模板：`pnpm deliverables:templates`；签署件、盖章件和个人信息永远放在 Git 外私有目录。
- 生产：使用 `compose.prod.yaml` + Caddy，私有 evidence 只挂载 Web，Worker/Caddy 不挂载；Worker 必须在 `scan-isolated` 内部网络，通过显式 `EGRESS_PROXY_URL` 出站，真实域名、TLS、密钥和镜像 digest 由外部负责人提供。
- 代理策略静态检查：`pnpm egress:check`；它验证端口白名单、全部解析地址拒绝私网/元数据/文档网段、IPv4-mapped IPv6 和直接使用已验证 IP 拨号的代理实现。真实公开 HTTP/HTTPS/WS/WSS 烟测仍需固定镜像和外部环境。
- 扫描只允许计划中的 HTTP(S) 公共站点；不要在生产环境关闭 SSRF、Origin、CSRF 或发布 CAS 检查。
