import { runScanPageCli } from "./scan-page-cli";

void runScanPageCli("scan:page").catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
