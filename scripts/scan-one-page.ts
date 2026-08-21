// Compatibility entry point named by the implementation plan. It shares the
// side-effect-free runner with scan-page.ts so one invocation performs one
// browser scan rather than executing two top-level mains.
import { runScanPageCli } from "./scan-page-cli";

void runScanPageCli("scan:one-page").catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
