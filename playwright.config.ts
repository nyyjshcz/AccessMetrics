import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30000,
  use: { baseURL: "http://127.0.0.1:3100", trace: "retain-on-failure" },
  webServer: {
    command: "pnpm start --hostname 127.0.0.1 --port 3100",
    url: "http://127.0.0.1:3100/api/health",
    reuseExistingServer: true,
    timeout: 120000,
    env: {
      HOSTNAME: "127.0.0.1",
      PORT: "3100",
      APP_ENV: "test",
      APP_BASE_URL: "http://127.0.0.1:3100",
      DATABASE_URL: "./data/e2e-accesscheck-local.db",
      PRIVATE_EVIDENCE_ROOT: "./data/e2e-private",
      PUBLIC_EXPORT_ROOT: "./data/e2e-exports",
      SESSION_SECRET: "e2e-session-secret-01234567890123456789",
      ADMIN_ACCESS_KEY: "e2e-admin-access-key-01234567890123456789",
      VISITOR_ACCESS_KEY: "e2e-visitor-access-key-01234567890123456789",
      DNS_RESOLVER_MODE: "system",
      SCAN_TEST_ALLOW_PRIVATE_ADDRESSES: "1",
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
