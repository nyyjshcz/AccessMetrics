import fs from "node:fs";
import path from "node:path";
import { migrate } from "../src/lib/db";
import { createCampaign } from "../src/lib/study";
import { positionalArgs } from "./cli-args";
const index = process.argv.indexOf("--plan");
const file = index >= 0 ? process.argv[index + 1] : positionalArgs()[0];
if (!file)
  throw new Error("usage: pnpm study:campaign:create -- --plan research/campaign-plan.json");
migrate();
const plan = JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
if (String(plan.protocolHash).startsWith("WAITING_"))
  throw new Error("R1 未确认，不能创建正式 campaign");
console.log(JSON.stringify(createCampaign(plan), null, 2));
