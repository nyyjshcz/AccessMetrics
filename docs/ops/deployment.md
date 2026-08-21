# 本地与生产运行

本地：`pnpm db:migrate` 后启动 `pnpm dev` 和 `pnpm worker`。生产：先在干净候选 commit 构建并生成 validation/build attestation，再用 `docker compose up`；不挂载 Docker socket。部署前必须通过公开包隐私检查、R5 和 clean-clone 验证。SQLite 目标规模是 10–20 个网站、约 100–300 个成功页面，不承诺一千亿行；超出该边界应迁移到分区式采集与分析系统。
