import { migrate } from "../src/lib/db";
import { startCampaignRun } from "../src/lib/study";
const index = process.argv.indexOf("--campaign");
const campaignId = index >= 0 ? process.argv[index + 1] : undefined;
if (!campaignId) throw new Error("usage: pnpm study:run -- --campaign <campaign-id>");
migrate();
console.log(JSON.stringify(startCampaignRun(campaignId, "study-runner"), null, 2));
