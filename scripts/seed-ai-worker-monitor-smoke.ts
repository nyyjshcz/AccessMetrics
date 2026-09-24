import crypto from "node:crypto";
import { migrate, getDb } from "../src/lib/db";
import { createRun, createScanJob, savePageResult, upsertSite } from "../src/lib/repositories";
import { createAiBatch, saveAiProvider } from "../src/lib/ai-overlay";

migrate();
const db = getDb();
const origin = `https://local-ai-monitor-${crypto.randomUUID()}.example`;
const site = upsertSite(origin, "Local AI Worker monitor smoke fixture");
const job = createScanJob(origin, {
  maxPages: 1,
  sameOriginOnly: true,
  respectRobots: true,
});
const run = createRun(job);
const pageId = `page_${crypto.randomUUID()}`;

db.prepare("INSERT INTO pages(id,site_id,canonical_url,first_seen_at) VALUES (?,?,?,?)").run(
  pageId,
  site.id,
  `${origin}/`,
  new Date().toISOString(),
);
savePageResult(run.id, pageId, {
  url: `${origin}/`,
  finalUrl: `${origin}/`,
  title: "Local AI Worker smoke fixture",
  status: 200,
  durationMs: 1,
  axe: {
    passes: [],
    violations: [],
    incomplete: [
      {
        id: "image-alt",
        impact: "serious",
        tags: ["wcag111"],
        description: "Image alternative text",
        help: "Images must have alternate text",
        helpUrl: "https://dequeuniversity.com/rules/axe/4.13/image-alt",
        nodes: [
          {
            html: '<img data-smoke="true">',
            target: ['img[data-smoke="true"]'],
            any: [],
            all: [],
            none: [],
          },
        ],
      },
    ],
    inapplicable: [],
  },
});

const provider = saveAiProvider({
  label: "Local fake provider",
  baseUrl: "http://127.0.0.1:9191/v1",
  model: "local-smoke-model",
  apiKey: "local-only-fake-provider-key",
  enabled: true,
});
const created = createAiBatch({ runId: run.id, providerConfigId: provider.id });

console.log(
  JSON.stringify({ runId: run.id, batchId: created.batch.id, itemCount: created.stats.total }),
);
