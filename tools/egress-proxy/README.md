# 受控出站代理接口

生产扫描不能直接把主机名交给普通 HTTP 客户端。部署时将此目录替换为经过安全评审的固定 Smokescreen/stripe-goproxy commit 构建包装层：HTTP、CONNECT、WebSocket 使用同一个 DestinationPolicy，解析全部地址、拒绝任一私网地址，并由 dialer 直接连接本次已验证 IP，同时保留 Host/SNI。当前仓库的 TypeScript `validateTargetUrl` 是应用层第一道检查，不能单独宣称防住 DNS rebinding；没有固定的代理镜像 digest 时，正式公网扫描保持阻塞。
