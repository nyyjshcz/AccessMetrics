# 架构

浏览器端只提交请求和展示已授权 DTO；Next API 在服务端校验 session、role、CSRF、Origin 和幂等键。扫描 Worker 通过 SQLite job/page lease 领取任务，URL 安全层在 DNS 解析后拒绝私网、环回、链路本地、凭据和非 HTTP(S) 地址。Playwright 页面稳定后运行本地 axe，保存四类结果、frame 覆盖、清理后的节点和版本快照。评分模块使用整数分子/分母，导出器以 canonical JSON、manifest 和 hash 形成可追溯交付物。

研究链是 campaign plan → attempt log → freeze → source export → 固定种子抽样 → 双人 review/adjudication → review freeze → R4 candidate → final → R5/release。R5 练习、理解检查和五项交接由服务端按固定目录评分，六份 artifact 形成共同 bundle，再进入 gate receipt。任何真人门未通过都保持 `WAITING_EXTERNAL_INPUT`。
