import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { canonicalize, sha256 } from "@/lib/canonical";

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "accesscheck-study-chain-"));
process.env.DATABASE_URL = path.join(testRoot, "study.db");
process.env.PRIVATE_EVIDENCE_ROOT = path.join(testRoot, "private");
process.env.PUBLIC_EXPORT_ROOT = path.join(testRoot, "public");

const dbModule = await import("@/lib/db");
const repositories = await import("@/lib/repositories");
const study = await import("@/lib/study");
const studyExport = await import("@/lib/study-export");
const ai = await import("@/lib/ai-overlay");

describe("formal study freeze chain", () => {
  beforeAll(() => dbModule.migrate());
  afterAll(() => dbModule.closeDb());

  it("writes the fixed execution log, exact hashes, and reuses one freeze", () => {
    const slots = Array.from({ length: 10 }, (_, index) => index + 1);
    const plan = {
      campaignPlanVersion: "campaign-plan-v1",
      protocolHash: "p".repeat(64),
      sampleFrameHash: "f".repeat(64),
      baseline: {
        scannerVersion: "accesscheck-scanner-v1",
        axeVersion: "4.13.0",
        modelVersion: "accesscheck-score-v1",
      },
      targetSiteCount: 10,
      pageLimit: 1,
      retryPolicy: { maxAttempts: 1 },
      replacementPolicy: { predeclaredOnly: true },
      allowedFailureReasonCodes: ["offline"],
      slots: slots.map((slot) => ({
        slot,
        primaryCandidateId: `candidate-${slot}`,
        replacementCandidateIds: [],
        category: "public",
      })),
    };
    for (const slot of slots)
      repositories.upsertSite(
        `https://study-${slot}.example`,
        `study-${slot}`,
        "public",
        `candidate-${slot}`,
      );
    const { campaignId } = study.createCampaign(plan);
    const db = dbModule.getDb();
    db.prepare("UPDATE study_campaigns SET status='r1_approved' WHERE id=?").run(campaignId);
    for (const slot of slots) {
      const site = repositories.upsertSite(`https://study-${slot}.example`);
      const job = repositories.createScanJob(
        site.origin,
        { maxPages: 1, sameOriginOnly: true, respectRobots: true },
        "test",
        `study-freeze-${slot}`,
      );
      const run = repositories.createRun(job);
      const now = new Date().toISOString();
      db.prepare(
        "INSERT INTO study_run_attempts(id,campaign_id,slot,candidate_id,replacement_rank,attempt_no,run_id,trigger,terminal_status,usability_decision,decision_reason_code,started_at,completed_at,replacement_activated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      ).run(
        `attempt-study-${slot}`,
        campaignId,
        slot,
        `candidate-${slot}`,
        0,
        1,
        run.id,
        "test",
        "completed",
        "included",
        null,
        now,
        now,
        null,
      );
    }
    const first = study.freezeCampaign(campaignId);
    const second = study.freezeCampaign(campaignId);
    expect(second).toMatchObject({ freezeId: first.freezeId, reused: true });
    expect(first.executionLogHash).toMatch(/^[a-f0-9]{64}$/);
    const logPath = path.join(
      testRoot,
      "private",
      "study-campaigns",
      campaignId,
      "inclusion-exclusion-log.csv",
    );
    const logBytes = fs.readFileSync(logPath);
    expect(logBytes.toString("utf8").split(/\r?\n/)[0]).toBe(
      "campaign_id,slot,replacement_rank,candidate_id,run_id,started_at,terminal_status,usability_decision,reason_code,replacement_activated_at",
    );
    expect(sha256(logBytes)).toBe(first.executionLogHash);
    const stored = db.prepare("SELECT * FROM study_freezes WHERE id=?").get(first.freezeId) as any;
    expect(stored.status).toBe("registered");
    expect(stored.population_digest).toBe(sha256(canonicalize([])));
    expect(stored.run_set_hash).toBe(sha256(canonicalize(first.canonicalRuns)));

    const exported = studyExport.createStudyExport({
      studyFreezeId: first.freezeId,
      kind: "study_source",
    });
    expect(exported.status).toBe("verified");
    expect(exported.manifest_hash).toMatch(/^[a-f0-9]{64}$/);
    for (const file of [
      "manifest.json",
      "manifest.sha256",
      "data/study.json",
      "data/sites.csv",
      "data/runs.csv",
      "data/pages.csv",
      "data/rule_results.csv",
      "data/result_nodes.csv",
      "data/page_scores.csv",
      "data/site_scores.csv",
      "data/manual_reviews.csv",
      "schemas/study-export.schema.json",
      "configs/scoring-config.v1.json",
      "research/protocol.md",
    ])
      expect(fs.existsSync(path.join(exported.storage_relpath, file))).toBe(true);
    expect(fs.existsSync(path.join(exported.storage_relpath, "manual-reviews.json"))).toBe(false);
    const manifest = JSON.parse(
      fs.readFileSync(path.join(exported.storage_relpath, "manifest.json"), "utf8"),
    );
    expect(manifest.exportKind).toBe("study_source");
    expect(manifest.files.some((file: { path: string }) => file.path === "manifest.json")).toBe(
      false,
    );

    const provider = ai.saveAiProvider({
      label: "formal fixture provider",
      baseUrl: "http://127.0.0.1:1234/v1",
      model: "qwen-fixture",
      apiKey: "fixture-key",
    });
    const formalBatch = ai.createAiBatch({
      studyFreezeId: first.freezeId,
      providerConfigId: provider.id,
    });
    expect(formalBatch.batch.run_id).toBeNull();
    expect(formalBatch.batch.page_id).toBeNull();
    expect(formalBatch.batch.status).toBe("completed");
    const freezeStatusBeforeAiFinal = (
      db.prepare("SELECT status FROM study_freezes WHERE id=?").get(first.freezeId) as {
        status: string;
      }
    ).status;
    const aiFinal = studyExport.createStudyExport({
      studyFreezeId: first.freezeId,
      kind: "study_final_ai",
      expectedSourceExportId: exported.id,
    });
    expect(aiFinal.status).toBe("verified");
    expect(
      (
        db.prepare("SELECT status FROM study_freezes WHERE id=?").get(first.freezeId) as {
          status: string;
        }
      ).status,
    ).toBe(freezeStatusBeforeAiFinal);
    for (const file of [
      "ai/reviews.csv",
      "ai/evidence.jsonl",
      "ai/summary.json",
      "ai/score.json",
      "ai/config.json",
    ])
      expect(fs.existsSync(path.join(aiFinal.storage_relpath, file))).toBe(true);
    const summary = JSON.parse(
      fs.readFileSync(path.join(aiFinal.storage_relpath, "ai/summary.json"), "utf8"),
    );
    expect(summary).toMatchObject({
      total_incomplete: 0,
      processed_coverage: 100,
      resolution_coverage: 100,
    });
  });
});
