# Complete Mathematics Lead Guide

> **Who should read this: the mathematics lead. Required reading: yes.** This is the sole primary source for the mathematics section. After reading it, you should be able to explain the scoring formula, statistical definitions, and AI-review boundaries, and recalculate results from the code and examples.

[中文](./数学负责人完整理解指南.md) | **English**

> Audience: colleagues responsible for mathematics, statistics, and the boundaries of conclusions in the project.
> Purpose: to let you understand AccessCheck Lishui completely, from data and formulas through statistical interpretation to limitations on conclusions; this is not a memorization-oriented interview script.
> Basis: follow the currently runnable code, especially src/lib/score.ts, src/lib/run-score.ts, and analysis/analyze.py. Historical research materials are background only and cannot replace the current implementation.

## Terminology card

| Term | Plain-language explanation |
| --- | --- |
| axe-core | The engine that runs automated accessibility rule checks on browser pages. |
| WCAG A, AA | WCAG success-criterion levels; this project uses them for rule mapping and scoring-eligibility decisions. |
| node | One page element actually checked by a rule. |
| rule result | One result row for one rule on one page, including the result type and node count. |
| opportunity | One node that can be included in scoring. |
| impact | The severity supplied by axe, such as minor, moderate, serious, or critical. |
| scoring_eligible | The rule is mapped to WCAG A or AA, marked scoreable in the catalog, and the node result is pass or violation. |
| pooled score | A score calculated by combining scoring opportunities from all pages into one pool; it is not an average of page scores. |
| overlay | A manual or AI review conclusion layered onto the original result without rewriting the original axe result. |

## 1. Describe the project in one sentence first

AccessCheck Lishui is a locally run web accessibility checking tool:

1. The user enters a site's home page and the maximum number of pages to scan in this run;
2. the program discovers accessible HTML pages within the same site;
3. it opens pages with Playwright and checks accessibility issues with axe-core;
4. it saves each rule's node count, reviewable node evidence, page status, and scoring results;
5. incomplete items that axe cannot judge automatically can receive supporting conclusions from a human or AI;
6. it generates a readable, reviewable, publishable report.

Its purpose is not to give a website a mysterious score, but to turn explainable automated-check results into a reproducible descriptive score weighted by severity while preserving evidence and boundaries.

## 2. Understand the scope, and do not confuse it with other scopes

The repository contains two layers that must be kept strictly separate.

| Layer | Is it currently the main program's runtime logic? | What you need to understand |
| --- | --- | --- |
| Local scanning and reporting tool | Yes | How data is produced, how the current score is calculated, how AI/humans change the effective score, and how reports should be interpreted |
| Offline research analysis in the analysis directory | It is reproducible supporting analysis, but not the everyday web-operation page | Aggregate statistics, sensitivity analysis, manual-review agreement, and export-integrity checks |
| Research materials in research and study | No, not facts about the current local tool's runtime | They can explain project evolution; do not present research workflows, old formulas, or sample designs as current web functionality |

The current project should not be described as a formal WCAG certification system, and one local scan should not be described as a random-sample survey. It is an audit tool based on axe-core automated detections that permits human and AI assistance with uncertain items.

## 3. Data flow from user action to mathematical result

    Enter URL and the page limit for this run
        ↓
    URL validation and same-origin crawling
        ↓
    Page-level axe scan
        ↓
    rule_results (rule-result rows, storing node_count)
    result_nodes (per-node evidence for violation / incomplete)
        ↓
    raw score
        ↓
    Effective conclusions for incomplete from humans / AI
        ↓
    effective score
        ↓
    Page, site, principle dimensions, and report display

The local start command is pnpm dev. It starts the web app, scanning Worker, and AI Worker together. Common pages are:

- Home: /, for viewing active tasks and published reports;
- New scan: /scans/new;
- A scan: /scans/[runId];
- AI provider settings: /settings/ai.

The mathematics lead does not need to own browser-automation implementation, but must know that results do not appear from nowhere: every final scoring opportunity comes from a rule result on a specific page. Code and tests are not required reading; consult them only when checking definitions or recalculating a result.

## 4. What exactly is the “sample” of this scan?

### 4.1 The page limit does not guarantee how many pages are scanned

The maximum-page field is the upper bound for crawling in this run. It is not a promise that this many pages will successfully be obtained, nor a sample size. Current input allows 1 to 15 pages; the page form defaults to 10 pages; the server configuration default maximum is 15 pages. The crawler may stop early because:

- there are no more candidate links within the same-origin scope;
- the crawl depth or total duration is exceeded;
- robots rules disallow access;
- a redirected link duplicates an existing page;
- the address is not scannable HTML, does not use an allowed protocol, or is filtered by resource type;
- fetching, rendering, or scanning a page fails.

Thus, when 9 pages are discovered, 6 succeed, and 1 fails, the other two pages are usually still queued, skipped, deduplicated, or excluded by crawl rules from the final page records; this does not mean that two random samples were missing. Discovered, successful, failed, and incomplete page-record states are page-level states and are not required to add up to the page limit.

### 4.2 Statistical inferences that cannot be made

The scanned pages are a convenience set determined by site-link structure, crawl rules, and technical accessibility, not a probability sample randomly drawn from all site pages. Therefore, current results cannot directly establish:

- the site's true overall compliance rate;
- the population proportion for a city, a type of site, or all users;
- confidence intervals, significance tests, or causal conclusions;
- axe's overall accuracy, false-positive rate, or false-negative rate.

To make such claims later, a population, sampling frame, random or stratified sampling design, inclusion/exclusion criteria, and a human gold standard would need to be defined separately; the current program does none of this automatically.

## 5. The most important counting units: rules, nodes, and opportunities

These three concepts are most easily misread.

| Name | Data location | Meaning | Can it be directly treated as another unit? |
| --- | --- | --- | --- |
| Page | pages | A discovered or attempted-to-scan URL | Not an independent random observation |
| Rule result | rule_results | One result row for one axe rule on one page | Not the number of problematic nodes |
| Node count | rule_results.node_count | The number of elements on the page falling into that rule result, and the current scoring granularity | Not the number of per-node evidence rows |
| Node evidence | result_nodes | The specific element, HTML fragment, and locator information for violation / incomplete nodes | Not the total node count for every result category |
| Scoring opportunity | Converted from eligible nodes | One node that can be judged as passing or failing | The denominator unit in the formula |

For example, if one rule triggers on 30 nodes on one page, the data contains one rule_results row, but the overall score has 30 node opportunities, not 1.

### 5.1 Why result_nodes row count cannot count all nodes

To save storage, the program persists per-node evidence only for violation and incomplete. It does not write individual result_nodes rows for pass or inapplicable. Their true counts are in rule_results.node_count.

Therefore:

- sum rule_results.node_count for total nodes across all result categories;
- read result_nodes for the specific elements, HTML fragments, and locator information of violation / incomplete;
- treating result_nodes row count as the total of all pass/failure nodes systematically undercounts pass and inapplicable.

Report code and runtime scoring both follow this rule. When checking a count, the mathematics lead must first ask: is this reporting rule rows or nodes?

## 6. Which results actually enter the current score

axe result types include pass, violation, incomplete, and inapplicable. The current treatment is:

| Raw type or status | Included in raw score? | Raw meaning |
| --- | --- | --- |
| pass | Included, weight 0 | The automated check passed |
| violation | Included, deducted by severity | The automated check judged it problematic |
| incomplete | Excluded | The automated rule cannot conclude; awaiting human or AI assistance |
| inapplicable | Excluded | The rule does not apply to the node |

Also, not every violation is eligible for scoring. The rule must be mapped by the frozen WCAG catalog to WCAG A or AA and marked scoring_eligible. Best-practice, AAA-only, unknown, or unmapped rules remain visible in evidence and reports, but do not enter the score numerator or denominator.

This means that the total number of problems shown in a report and the number of problems that lower the score need not match. They answer different questions:

- total reported problems: what did the scan see?
- scored problems: which WCAG A/AA automated results enter the score under the current definition?

## 7. Current main scoring formula

### 7.1 Definition

Let E be the set of all scoring-eligible node opportunities in this run that can already be judged as passing or failing. Let N = |E|.

For each opportunity i, define severity weight w_i:

| Result | w_i |
| --- | --- |
| pass | 0 |
| minor | 1 |
| moderate | 2 |
| serious | 3 |
| critical | 4 |

The current main score is:

    S = 100 × (4N − Σw_i) / (4N)

Equivalently:

    S = 100 × (1 − Σw_i / (4N))

The higher the score, the fewer the automatically detected problems accumulated under the current severity weights within this included node set.

To calculate exactly with integers internally, the code scales all weights above by 10:

    minor = 10, moderate = 20, serious = 30, critical = 40, maximum weight = 40

This scaling does not change the final mathematical result. The implementation stores the numerator and denominator as integers and rounds once for display at the end, avoiding floating-point and per-page-rounding errors.

### 7.2 A hand-calculation example

One scan has 8 scoreable pass, 1 serious violation, and 1 moderate violation.

    N = 10
    Σw_i = 3 + 2 = 5
    S = 100 × (4×10 − 5) / (4×10)
      = 100 × 35 / 40
      = 87.5

Note: this is not “80% of nodes passed, so 80 points.” It is a weighted result in which each failed node loses a different amount according to severity.

### 7.3 Handling missing severity

A violation may lack a direct node impact. The current code determines its scoring severity in this order:

1. the node's own impact;
2. the impact of its rule result;
3. minor by default if neither exists.

The report retains the source of that impact. Mathematically, this prevents a determined violation from disappearing from the denominator merely because a severity field is missing; interpretively, explain honestly that this is the project's conservative default, not an additional fact supplied by axe.

### 7.4 When there is no scoreable data

If N = 0, the actual run's overall score should display N/A (no computable data), not 0 or 100. With no eligible, determined scoring opportunities, no percentage-scale value is defined.

## 8. The site score is not an average of page scores

The site total directly pools eligible opportunities from the full run:

    S_site = 100 × (4ΣN_page − ΣW_page) / (4ΣN_page)

It is not:

    (displayed score on page 1 + displayed score on page 2 + …) / number of pages

There are two reasons:

1. Node counts can differ greatly between pages, while a simple average gives a one-node page the same weight as a page with hundreds of nodes;
2. page display scores have already been rounded to one decimal place, so averaging them introduces additional error.

When describing aggregation, say “calculated by pooling all eligible node opportunities,” not “the average page score.”

## 9. Four-principle scores: what they are and are not

The project displays four subscores for the WCAG principles Perceivable, Operable, Understandable, and Robust. Each opportunity carries one or more principle labels.

- A node is counted once in the total score;
- if a node maps to multiple principles, it may appear in each related principle diagnostic subscore;
- therefore, the four principle opportunity counts may sum to more than the overall opportunity count;
- the four-principle scores locate which types of problems are more prominent; do not average the four displayed scores to “recalculate” the total.

### 9.1 A code/documentation difference you must know

scoring/scoring-config.v1.json and scoring/model-spec.md contain descriptions of 40/30/20/10 principle weights, but the current runtime main scoring function does not use those principle weights for the overall score. The current overall score depends only on node-severity weights and node opportunity counts.

Therefore, external explanations must follow the runtime code:

- Correct: the total is a severity-weighted pooled score over all eligible nodes;
- Incorrect: the total is a weighted combination of the four principles at 40/30/20/10.

This is a “documentation and implementation difference” to watch during maintenance, not a formula that can be filled in from older documentation.

## 10. raw score and effective score

The project deliberately retains two scores.

| Score | Data used | Does it change original axe results? |
| --- | --- | --- |
| raw score | Original pass and violation; incomplete excluded | No |
| effective score | Original results plus valid human/AI conclusions for incomplete | No, conclusions are layered as an overlay |

For an original incomplete node, the effective-score mapping is:

| Effective conclusion | Converted scoring opportunity |
| --- | --- |
| problem | Treated as violation, using original effective impact, rule impact, or the minor default |
| not_problem | Treated as pass, weight 0 |
| uncertain | Still excluded from scoring |
| No conclusion yet | Still excluded from scoring |

After AI or human processing of incomplete:

- raw score does not change;
- effective score may change;
- the original incomplete total is not rewritten;
- the report should express both “original machine result” and “current effective conclusion,” and must not pretend that AI replaced the original axe fact.

### 10.1 Human priority

If multiple conclusions exist for the same node, current priority is:

    current local human conclusion > conclusion from the latest completed AI batch > original incomplete (unresolved)

Human review can override AI because AI is only supporting judgment. Do not describe an AI conclusion as the final manual-audit conclusion.

### 10.2 What is the coverage metric?

For T original incomplete nodes:

    processed coverage = (problem + not_problem + uncertain) / T × 100%
    resolution coverage = (problem + not_problem) / T × 100%

If T = 0, the code displays 100%, meaning “there were no items to process,” not “model recognition accuracy was 100%.”

These two metrics describe only progress in processing uncertain items. They do not represent accessibility quality, AI accuracy, or statistical confidence.

## 11. How to read numbers in the report

Reports contain at least four different kinds of numbers:

| Report number | Correct meaning | Common incorrect reading |
| --- | --- | --- |
| Page count | Discovered or completed page records | All pages on the site |
| Rule count | Number of distinct rule-result rows | Number of problematic elements |
| Node count | Sum of rule_results.node_count | Every result type can be counted directly from the detailed node table |
| raw / effective score | Weighted scores under two explicit data definitions | “The site is officially certified compliant” |

For violation and incomplete, the report can list selector, HTML fragment, help link, and other evidence; complete per-node HTML for pass and inapplicable is not persisted. “No detail” here is a storage policy, not a node count of 0.

If a page has frame coverage limited or coverage_limited, this means that areas such as cross-origin frames were not fully covered. It cannot be reinterpreted as pass and must not be silently included as a “problem-free page.”

## 12. Statistical parts of offline research analysis

analysis/analyze.py is an offline analysis script for validated export data. It differs from one web scan and focuses on descriptive aggregation across multiple runs or sites.

### 12.1 Data-integrity checks come first

Before calculating statistics, the script verifies:

1. manifest.json;
2. manifest.sha256;
3. the SHA-256 of every exported payload file.

If validation fails, the output should not continue to be treated as trustworthy statistical results. The mathematics lead should view this as part of reproducibility: first demonstrate that inputs were not silently modified, then discuss means or correlations.

### 12.2 Overall score and site distribution

The overall score in offline output also pools all eligible opportunities. Sites with more nodes naturally have more weight in the pooled overall.

In distribution statistics, site score is each site's one-decimal displayed score, from which the script calculates:

- sample size n;
- mean mean;
- median median;
- first and third quartiles Q1 and Q3;
- minimum and maximum.

Quartiles use linear interpolation at position (n − 1)p, with Q1 p = 0.25 and Q3 p = 0.75. They describe the middle-position range of sorted data and cannot be treated as a population proportion or accuracy. Because they use site scores displayed to one decimal place, recalculate using the same definition; do not mix the exact pooled overall with the displayed-score distribution.

These are descriptive statistics: mean and median describe the distribution's center, Q1 and Q3 describe the approximate range of its middle half, and minimum and maximum describe observed boundaries. They cannot establish external population proportions, accuracy, or statistical significance; if the export set is not a random sample, do not interpret its mean as an external population mean.

### 12.3 Category comparisons, severity, and common rules

The offline script also calculates:

- categoryComparison: descriptive comparison of one-decimal site scores by the categories in data/sites.csv;
- severitySummary: aggregation of violation nodes by effective impact;
- commonRules: aggregation of violation and incomplete nodes by rule ID;
- sampleSummary.populationSize: currently defined as the number of violation nodes plus incomplete nodes.

They are suitable for asking “Which rules and severity levels are more common in these exports?” They are not suitable for asking “What is the true occurrence rate of a rule across all sites in the city?”

## 13. Sensitivity analysis tests ranking robustness, not significance

The currently executable TypeScript and Python implementations always calculate three severity-weight scenarios:

| Scenario | critical | serious | moderate | minor |
| --- | ---: | ---: | ---: | ---: |
| A, main model | 4 | 3 | 2 | 1 |
| B | 5 | 3 | 2 | 1 |
| C | 4 | 2.5 | 1.5 | 1 |

The same sites are recalculated with exact scores and ranked under each scenario. Ranking rules are:

1. score from high to low;
2. when scores are exactly equal, stable alphabetical ordering by site ID;
3. competition ranking in the output, such as 1, 1, 3.

The script also calculates pairwise Spearman rank correlation between scenarios. It measures how similar relative rankings are between two scenarios, not the difference in scores themselves. For ties, it first uses average ranks and then calculates Pearson correlation for the rank vectors; if fewer than 2 sites are comparable or rankings do not vary, the result is null. It cannot establish a population proportion, accuracy, or statistical significance.

Interpret it as follows:

- a higher Spearman value: relative site rankings are more stable under these deliberately specified severity-weight changes;
- a lower Spearman value: rankings are more sensitive to weight choice, so conclusions should be more cautious;
- it does not prove the model is correct, establish causality, or constitute statistical significance;
- compare only sites present in both scenarios; do not treat missing sites as 0.

### 13.1 Another historical configuration difference to note

scoring/sensitivity-configs.json contains richer scenario names such as equal-principle, page-macro-average, and density, but the currently executable src/lib/sensitivity.ts and analysis/analyze.py do not consume or run those configurations. Only the three severity scenarios A/B/C above are actually produced now.

Therefore, the existence of a scenario name in the JSON file alone is not evidence that the project has run that sensitivity experiment.

## 14. Manual-review agreement: historical research exports only

Historical offline research workflows may contain a manual-reviews.json with two reviewers. The current script forms a pair only when one node has complete reviews from both the computer and math roles. Cohen's κ measures the classification agreement between two reviewers after removing agreement expected by chance; it cannot establish a population proportion, axe accuracy, or statistical significance.

Let the number of complete pairs be n_pairs, and let the classification label be l.

Observed agreement rate:

    A = n_agree / n_pairs

The Cohen's kappa implementation is:

    P_o = A
    P_e = Σ_l [n_computer(l) × n_math(l)] / n_pairs²
    κ = (P_o − P_e) / (1 − P_e)

If there are no complete pairs, or P_e = 1, the script returns null rather than fabricating a number.

Its proper interpretation is limited to:

- the degree of label agreement between the two reviewers on these reviewed nodes;
- not axe's accuracy;
- not the false-positive rate for all sites, the whole city, or all nodes;
- not machine-learning-model generalization performance.

Labels in old research data may be confirmed, not_an_issue, and uncertain; the current local page uses problem, not_problem, and uncertain. Their meanings are similar but their data workflows differ. When explaining them, do not incorrectly say that the historical double-review mechanism runs automatically for every current local scan.

## 15. AI and rate control are not statistical models

The current AI Worker handles only incomplete. The provider can configure the maximum number of simultaneous in-flight requests, and some free OpenRouter models can select a 20 requests/minute throttling policy. These are task-throughput, server-rate-limit, and cost-control settings; they are not part of the scoring formula and cannot improve the statistical representativeness of the original axe results.

Distinguish especially between:

- AI returning problem/not_problem/uncertain, a supporting judgment for one uncertain node;
- completed, failed, and queued AI-batch counts, which are run-monitoring numbers;
- AI processing coverage, which is not accuracy;
- server 429 responses, network errors, or malformed responses, which are operational events, not mathematical results.

## 16. Rigorous ways to describe project conclusions

The following contrast is useful.

| Can say | Should not say |
| --- | --- |
| The score calculated under the current severity weights is X among the pages covered by this scan and eligible nodes | The site officially passed WCAG certification |
| The score is calculated from pooled eligible pass and violation nodes | X% of the site's pages are absolutely accessible |
| incomplete is not directly included in raw score; human/AI conclusions can change effective score | AI has proved that these problems do or do not truly exist |
| Four-principle scores diagnose different types of risk | The total is a simple or fixed-weight average of the four displayed principle scores |
| Means, medians, and rankings from offline exports describe the export set | These statistics represent all unsampled sites |
| Sensitivity analysis tests the robustness of relative rankings to severity weights | Sensitivity analysis proves the scoring model is objectively correct |

## 17. Minimum exercises the mathematics lead should recalculate personally

Completing these items shows that you do more than “read the formula.”

1. Hand-calculate 87.5 for 8 pass, 1 serious, and 1 moderate;
2. construct two pages: one with 1 critical and the other with 99 pass. Explain why the pooled site score is not the simple average of the two page scores;
3. explain why a multi-principle node appears in two principle subscores but is counted only once in overall;
4. explain the difference between raw score and effective score, including why manual review overrides AI;
5. when pass-node count and result_nodes row count disagree, explain where to check the count;
6. when you see N/A, explain that there were no scoring opportunities, not that the score was 0;
7. when you see a Spearman value for an export batch, explain what conclusion it can and cannot support;
8. when you see a manual agreement rate or κ, state its sample scope accurately.

## 18. Recalculation and audit entry points

Prefer checking through the API, report JSON, or tests; do not manually modify the SQLite database.

Common commands:

    pnpm dev
    pnpm exec vitest run tests/scoring/score.test.ts tests/scoring/ai-overlay.test.ts
    pnpm score:recalculate <runId>
    pnpm test:all

To read-only check node counts in the database, the core idea is to sum rule_results.node_count rather than count only result_nodes:

    SELECT result_type, SUM(node_count) AS nodes
    FROM rule_results
    WHERE run_id = ?
    GROUP BY result_type;

    SELECT impact, SUM(node_count) AS nodes
    FROM rule_results
    WHERE run_id = ? AND result_type = 'violation'
    GROUP BY impact;

Current run results can be read through GET /api/runs/[runId] for rawScore, score, page status, counts, and coverage. The JSON for a published report also retains the exact-score numerator and denominator as strings, enabling an audit unaffected by JavaScript floating-point behavior.

## 19. Source files recommended for priority reading

| File | What to confirm from it |
| --- | --- |
| ../src/lib/score.ts | Severity weights, exact score, one-time half-up rounding, and four-principle subscores |
| ../src/lib/run-score.ts | Opportunities constructed from database node counts, raw/effective scores, and site pooling |
| ../src/lib/wcag.ts | Which rules belong to WCAG A/AA and which have scoring eligibility |
| ../src/lib/incomplete-resolution.ts | How human conclusions are saved and read |
| ../src/lib/ai-overlay.ts | AI batch, human priority, and incomplete coverage |
| ../src/lib/report.ts | How report DTOs, node statistics, and raw/effective results are displayed together |
| ../src/lib/sensitivity.ts | Currently executable A/B/C sensitivity scenarios |
| ../analysis/reference_score.py | Independent Python Fraction score recalculation |
| ../analysis/analyze.py | Complete implementation of export validation, descriptive statistics, Spearman, and κ |
| ../../tests/scoring/score.test.ts | Executable examples for formula, rounding, and multi-principle nodes |
| ../../tests/scoring/ai-overlay.test.ts | human > AI > raw priority and effective-score behavior |

## 20. Final checklist

Before any presentation, writing, or answer, confirm each item:

- Am I talking about nodes, rules, or pages?
- Am I talking about raw score or effective score?
- Have I mistaken the page limit for a random-sample size or whole-site coverage?
- Have I mistaken the pooled score for an average page score?
- Have I mistaken the four principle subscores for fixed-weight components of the total?
- Have I mistaken incomplete, AI-processing coverage, or manual agreement for accuracy?
- Do I know whether a statistic comes from the current local tool or the old research-export workflow?
- Do I understand that the conclusion covers only this scan, the current rule mapping, current weights, and current data scope?

If each item can be explained with the code and one concrete run, the mathematics has truly been mastered rather than reduced to repeating a few terms.
