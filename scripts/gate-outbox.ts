import { config } from "../src/lib/config";
import { migrate } from "../src/lib/db";
import { writePendingEvidence } from "../src/lib/study";
migrate();
console.log(JSON.stringify({ written: writePendingEvidence(config.privateEvidenceRoot) }));
