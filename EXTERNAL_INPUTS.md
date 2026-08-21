# 外部输入与真人确认（唯一阻塞清单）

当前状态：`WAITING_EXTERNAL_INPUT`。自动化实现、fixture、数据库、扫描、评分、导出、研究脚手架和发布 fail-closed 校验已经完成；以下事项必须由真实负责人或外部单位提供，AI 不得伪造。

- [ ] R1：计算机负责人和数学负责人分别用本人 reviewer 会话确认研究协议、样本框、campaign slots、扫描许可、版本三元组、评分预注册和可信标准来源；提交绑定 hash 的 receipt。
- [ ] 真实研究网站清单、官方 URL、纳入理由、许可/公开依据和替补顺序；不要把 fixture 当正式样本。
- [ ] R2/R3：两位 reviewer 对服务端固定抽样节点独立复核、对分歧裁决，并冻结 review set/adjudication hash。
- [ ] R4：两位负责人核对中文目录、模型/敏感性、报告候选、数字追溯、frame 覆盖和局限，提交 candidateBundle 绑定的 receipt。
- [ ] R5：两位负责人 checkout 准确 rcCommit，分别完成端到端练习、理解检查和 A–E 接手确认；由服务端生成共同 artifact bundle 和 receipts。
- [ ] 生产部署：服务器、域名/DNS、TLS、镜像仓库、固定 Playwright/渲染器/代理 digest、密钥和接收单位信息。

收到真实输入后，在仓库根目录运行 `pnpm project:resume`。命令会先验证自动化产物和外部 evidence 的 hash；未齐全时继续返回 `WAITING_EXTERNAL_INPUT`，不会重做或覆盖正式数据。口令、token、签章和签署件只放 Git 外的私有根目录。
