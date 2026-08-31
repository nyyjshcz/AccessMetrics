# R1–R5 证据目录

> **历史参考。** R1–R5 门禁不是当前产品流程的一部分；该目录只为追溯早期材料而保留。当前项目入口见 [文档地图](../../../README.md)。

每个真人门的 receipt 由 role-bound API 写入数据库和 outbox；文件写入由 `pnpm tsx scripts/gate-outbox.ts` 幂等完成。此目录不放伪造 receipt。[旧版外部输入说明](../validation/EXTERNAL_INPUTS.md)记录尚未由负责人提交的门和真实资料。
