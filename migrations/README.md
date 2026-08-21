# 数据库迁移

迁移由 `src/lib/db.ts` 的有序版本函数执行，版本写入 `schema_migrations`，每个版本在事务中运行，重复执行幂等。运行 `pnpm db:migrate` 应用迁移，运行 `pnpm db:check` 检查外键、关键表和 WAL。生产迁移前必须备份数据库并在恢复副本上验证。
