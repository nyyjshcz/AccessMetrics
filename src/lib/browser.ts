import type { LaunchOptions } from "playwright";
import { config } from "./config";

/**
 * One launch policy is shared by the crawler and the axe scanner. Production
 * Chromium must have an explicit proxy; process-level proxy variables alone
 * are not sufficient to prove Chromium cannot bypass the egress policy.
 */
export function chromiumLaunchOptions({
  requireProxy = true,
}: { requireProxy?: boolean } = {}): LaunchOptions {
  const proxyServer = config.EGRESS_PROXY_URL;
  if (config.APP_ENV === "production" && requireProxy && !proxyServer)
    throw new Error("EGRESS_PROXY_URL is required in production");
  return {
    headless: true,
    ...(proxyServer ? { proxy: { server: proxyServer, bypass: "" } } : {}),
    args: [
      "--disable-quic",
      "--disable-background-networking",
      "--disable-features=WebRTC,WebRtcHideLocalIpsWithMdns",
    ],
  };
}
