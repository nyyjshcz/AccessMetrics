# Scoring Explained: How to Read a Score from 0 to 100

> **Who should read this: professors, project reviewers, and anyone who needs to explain a report. Required reading: only for the reviewer path.** The mathematics lead should use the [complete mathematics lead guide](./math-lead-guide.en.md) as the primary reference and does not need to read this document again.

[中文](./scoring-explained.md) | **English**

## The conclusion first

AccessCheck's score is a severity-weighted result of the **eligible opportunities (mapped to WCAG A or AA, marked as scoreable in the catalog, and counted only for `pass` or `violation` nodes) that can be judged as passing or problematic** in the scan. It is used to locate and compare risk within this scan's scope. It is **not** whole-site coverage, a manual-audit conclusion, or WCAG compliance certification.

## Counting units

| Unit | What it is | Easy to misread it as |
| --- | --- | --- |
| Page | A URL that the task actually found or attempted to scan. | A random sample or every page on the site. |
| Rule result | One result row for one axe rule on one page. | One problematic element. |
| Node | One page element matched by a rule. `node_count` is the count of matched elements. | The number of rule rows. |
| Scoring opportunity | An eligible node that can be judged as `pass` or `violation`. | The total number of DOM elements. |

`rule_results.node_count` stores the true node count for every result type. `result_nodes` stores detailed evidence only for violation and incomplete, so its row count cannot be used to count pass or inapplicable.

Here, `eligible` is the English shorthand for the scoring eligibility described above.

## Main formula

Let `E` be all determined, score-eligible node opportunities in this scan, and `N = |E|`. A passing node has weight 0; a problematic node is weighted by axe severity:

| Severity | Weight |
| --- | ---: |
| critical | 4 |
| serious | 3 |
| moderate | 2 |
| minor | 1 |

The impact severity comes from axe's result field, not from WCAG's A, AA, or AAA level; the WCAG level only participates in determining scoring eligibility.

The total score is:

```text
S = 100 × (4N − Σwᵢ) / (4N)
```

For example, with 8 pass, 1 serious, and 1 moderate: `N = 10`, `Σwᵢ = 5`, so `S = 87.5`. The implementation calculates with integer numerator and denominator and performs one half-up rounding operation to one decimal place at the end; do not average already displayed one-decimal page scores.

If there are no scoring opportunities, the score should be understood as **N/A (no computable data)**, not 0 or 100.

## Why this is not a “page average”

The site score is calculated after pooling all scoring opportunities in the run: pages with more nodes naturally have more weight. It is not a simple average of displayed page scores, nor an average of the four principle scores.

For example, if one page has 1 node and another has 99 nodes, the latter has a larger influence on the pooled total.

A node may map to multiple WCAG principles: it appears separately in the relevant principle diagnostic subscores, but is counted only once in the total. Therefore, the opportunity counts for the four principles may add up to more than the total opportunity count; this is by design.

## Which results enter the score

| Raw result | Treatment in raw score | Reason |
| --- | --- | --- |
| pass | Included, weight 0 | The automated check reached a passing conclusion. |
| violation | Included, deducted by severity | The automated check reached a problematic conclusion. |
| incomplete | Excluded | The automated rule cannot yet judge reliably. |
| inapplicable | Excluded | The rule does not apply to that node. |

Even a violation enters the score only when its rule is mapped to WCAG A or AA and marked as scoreable in the rule catalog. AAA-only, best-practice, unknown, or unmapped rules remain visible in the evidence but do not silently affect the score.

## Raw score and effective score after review

The system displays two perspectives:

- **Raw score**: calculated only from original pass and violation; incomplete does not directly deduct points.
- **Effective score**: when an original incomplete receives a valid conclusion, `problem` is treated as a problem and `not_problem` as a pass; `uncertain` remains excluded.

The first appearances of `problem`, `not_problem`, and `uncertain` are review conclusion values, not new scan results; they affect only the effective score and do not change the original scan results. Manual conclusions always take priority over AI, and AI conclusions take priority over an original unresolved incomplete. Whichever review is used, the original axe rule results and node evidence are never rewritten.

This also means that AI processing progress, incomplete coverage, and the final score are three different numbers. Coverage indicates how many uncertain items were processed; it does not represent AI accuracy or site accessibility quality.

## Boundaries for presentation

- You may say: “Among the pages actually scanned and eligible nodes in this scan, the current severity weights produce a score of X.”
- You should not say: “X% of this site is already WCAG-compliant” or “This site passed certification.”
- Check scan coverage, page failures, and the number of incomplete items before discussing the score.

Anyone who wants to recalculate the formula or understand offline descriptive statistics, sensitivity analysis, and agreement coefficients should continue to the [complete mathematics lead guide](./math-lead-guide.en.md).
