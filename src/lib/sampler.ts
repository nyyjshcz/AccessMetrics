import { sha256 } from "./canonical";

export const REVIEW_STRATA = [
  "violation:critical",
  "violation:serious",
  "violation:moderate",
  "violation:minor",
  "incomplete",
] as const;
export interface SamplingItem {
  resultNodeId: string;
  resultType: "violation" | "incomplete";
  impact?: string | null;
  ruleId: string;
}

export function selectWithinQuota(
  items: SamplingItem[],
  seed: string,
  stratum: string,
  quota: number,
) {
  const groups = new Map<string, SamplingItem[]>();
  for (const item of items) {
    if (!groups.has(item.ruleId)) groups.set(item.ruleId, []);
    groups.get(item.ruleId)!.push(item);
  }
  for (const group of groups.values())
    group.sort(
      (a, b) =>
        sha256(`${seed}|${a.resultNodeId}`).localeCompare(sha256(`${seed}|${b.resultNodeId}`)) ||
        a.resultNodeId.localeCompare(b.resultNodeId),
    );
  const ruleIds = [...groups.keys()].sort();
  const selected: Array<SamplingItem & { stratum: string }> = [];
  let round = 0;
  while (selected.length < quota) {
    let progressed = false;
    for (const ruleId of ruleIds) {
      const item = groups.get(ruleId)![round];
      if (item) {
        selected.push({ ...item, stratum });
        progressed = true;
        if (selected.length >= quota) break;
      }
    }
    if (!progressed) break;
    round++;
  }
  return selected;
}

export function sampleManualReview(items: SamplingItem[], populationDigest: string) {
  const seed = sha256(`${populationDigest}|manual-review-sampler-v1`).slice(0, 16);
  const byStratum = new Map<string, SamplingItem[]>();
  for (const stratum of REVIEW_STRATA) byStratum.set(stratum, []);
  for (const item of items) {
    const stratum =
      item.resultType === "incomplete" ? "incomplete" : `violation:${item.impact ?? "minor"}`;
    if (byStratum.has(stratum)) byStratum.get(stratum)!.push(item);
  }
  const capacity = Object.fromEntries(
    REVIEW_STRATA.map((stratum) => [stratum, byStratum.get(stratum)!.length]),
  );
  const targetSize = Math.min(40, items.length);
  const quota = Object.fromEntries(
    REVIEW_STRATA.map((stratum) => [stratum, Math.min(2, capacity[stratum])]),
  );
  let remaining = targetSize - Object.values(quota).reduce((a, b) => a + b, 0);
  const residual = Object.fromEntries(
    REVIEW_STRATA.map((stratum) => [stratum, capacity[stratum] - quota[stratum]]),
  );
  const residualTotal = Object.values(residual).reduce((a, b) => a + b, 0);
  const shares = REVIEW_STRATA.map((stratum) => ({
    stratum,
    raw: residualTotal && remaining > 0 ? (remaining * residual[stratum]) / residualTotal : 0,
  }));
  for (const share of shares) {
    const add = Math.min(residual[share.stratum], Math.floor(share.raw));
    quota[share.stratum] += add;
    remaining -= add;
  }
  while (remaining > 0) {
    const candidate = shares
      .filter((share) => quota[share.stratum] < capacity[share.stratum])
      .sort(
        (a, b) =>
          b.raw - Math.floor(b.raw) - (a.raw - Math.floor(a.raw)) ||
          REVIEW_STRATA.indexOf(a.stratum) - REVIEW_STRATA.indexOf(b.stratum),
      )[0];
    if (!candidate) break;
    quota[candidate.stratum]++;
    remaining--;
  }
  const selected: Array<SamplingItem & { stratum: string }> = [];
  for (const stratum of REVIEW_STRATA) {
    selected.push(...selectWithinQuota(byStratum.get(stratum)!, seed, stratum, quota[stratum]));
  }
  return { seed, targetSize, quota, selected };
}
