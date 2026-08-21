# R1–R5 证据目录

每个真人门的 receipt 由 role-bound API 写入数据库和 outbox；文件写入由 `pnpm tsx scripts/gate-outbox.ts` 幂等完成。此目录不放伪造 receipt。`EXTERNAL_INPUTS.md` 记录尚未由负责人提交的门和真实资料。
