import {
  assertDnsResolver,
  assertPrivateEvidenceRoot,
  assertProductionProxy,
  assertProductionSecrets,
} from "./config";

/** Checks required before the Web process can accept requests. */
export function assertWebStartup() {
  assertPrivateEvidenceRoot();
  assertProductionSecrets();
}

/** Checks required by the isolated scanning worker before it consumes jobs. */
export function assertScanWorkerStartup() {
  assertProductionProxy();
  assertDnsResolver();
}
