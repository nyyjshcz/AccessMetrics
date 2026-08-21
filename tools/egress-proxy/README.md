# 受控出站代理接口

`proxy.mjs` 是可审计的本地包装实现：HTTP/HTTPS forward、CONNECT 和 `ws://` Upgrade 共用 `DestinationPolicy`，解析全部地址、拒绝任一私网/保留/元数据地址，并由 dialer 直接连接本次已验证 IP，同时保留 Host/SNI。`pnpm egress:check` 会验证核心策略。

正式公网扫描仍必须把本目录锁定到经过安全评审的固定 Smokescreen/stripe-goproxy commit 和不可变镜像 digest，并完成真实 Chromium 的 HTTP/HTTPS/WS/WSS 烟测。应用层 `validateTargetUrl` 和这个原型代理都不能在缺少固定生产 digest 时替代外部安全复核；因此当前正式公网部署仍保持阻塞。
