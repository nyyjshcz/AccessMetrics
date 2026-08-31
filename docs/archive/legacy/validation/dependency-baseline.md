# 依赖基线

> **历史参考。** 这是某次依赖检查的快照，不作为当前安装或部署说明。请使用 [运维说明](../../../operations.md)。

| 项目 | 计划版本 | 当前运行时 |
|---|---:|---:|
| Node.js | 24.19.0 | 24.19.0 |
| pnpm | 11.20.0 | 11.19.0（桌面运行时固定版本） |
| Python | 3.12.13 | 3.12.13 |
| Next.js | 16.3.0 | package.json 已锁定 |
| Playwright | 1.62.0 | package.json 已锁定 |
| axe-core | 4.13.0 | package.json 已锁定 |

pnpm 11.19.0 是当前桌面运行时可用的稳定版本，和计划要求的 11.20.0 只有补丁版本差异；依赖安装后会把实际 lockfile 和浏览器版本追加到本文件。若精确包版本不可解析，预检必须失败并在 `docs/decisions/` 记录决策，不能静默改用 latest。

## 已验证快照

- `pnpm-lock.yaml` 已提交依赖解析结果；所有直接 Node 依赖均为 exact version。
- `pnpm exec playwright install chromium` 已成功安装 Chromium 151.0.7922.34（Playwright build 1234）以及对应 headless shell/FFmpeg/Winldd。
- `pnpm dependency:preflight` 已逐项查询 npm 元数据，确认当前包版本存在且不是 prerelease。
- 运行平台：Windows x64；Node `v24.19.0`；Python `3.12.13`；pnpm `11.19.0`。
- 生产 Playwright 容器 `mcr.microsoft.com/playwright:v1.62.0-noble`、文档渲染镜像和固定 Smokescreen commit 尚未在本桌面环境拉取；因此公网生产扫描和发布仍保持 `WAITING_EXTERNAL_INPUT`，不能把本地验证冒充生产验证。
