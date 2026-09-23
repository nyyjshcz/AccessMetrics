# AccessCheck Lishui: Current Project Overview

Language: [中文](项目说明.md) | **English**

> **Who should read this: everyone. Is it required: yes.** After reading, you will know the project’s purpose, the user flow, how to read a report, and which conclusions cannot be drawn from scan results.

## What problem does this project solve?

AccessCheck is a self-hostable web accessibility assessment tool. Starting from a public website home page, it discovers pages on the same site, runs automated checks with axe-core in a real browser with the pages rendered, retains rule, node, and page evidence, and presents the results in a structured report.

Its goal is neither to replace accessibility experts nor to label a website “compliant” or “non-compliant.” It provides an initial web accessibility screening:

1. **Repeatable**: the same input goes through explicit URL validation, page discovery, browser rendering, and rule checking.
2. **Interpretable**: every issue can be traced to a rule, page, target element, and sanitized HTML evidence.
3. **Communicable**: the report presents scores, coverage, and high-priority items first; complex evidence can be expanded as needed.

## What does a user experience?

An administrator enters a website address → the scanning Worker discovers same-site pages and checks them with Playwright + axe → SQLite stores pages, rule results, node evidence, and the raw score → a person or AI adds review conclusions for `incomplete` items → the administrator publishes a read-only report → anyone holding the visitor key can view published reports only.

See the [architecture](./architecture.en.md) for the detailed data flow; you can continue using the project without reading it in full.

## How to read the main results

### 1. Page coverage comes before the score

“Scan up to 15 pages” is the limit for a task; it does not guarantee that 15 pages will be scanned. The current input range is 1 to 15 pages, the page form defaults to 10 pages, and the server-configured default maximum is 15 pages. A site may not have enough distinct pages; duplicate or redirected pages are merged, and pages may fail to scan.

Page-level scan status describes the page work itself: discovered, successful, failed, or still incomplete. At the rule or node level, `incomplete` is axe’s marker that a result cannot yet be judged reliably. Both states can exist at once: for example, a page scan may succeed while one rule still has `incomplete` nodes.

### 2. Automated issues and items requiring further judgment differ

There are four initial `result` types: `violation` means an issue, `pass` means passed, `incomplete` means further judgment is needed, and `inapplicable` means not applicable. `pass` enters the raw score; `inapplicable` is not scored; `incomplete` is not scored directly, but manual or AI review conclusions can affect the effective score.

`violation` enters the automated issue list. `incomplete` is not silently treated as an automated issue; manual or AI review can add a conclusion but cannot overwrite the original axe record.

### 3. There are two parallel scores

- **Raw score**: calculated only from the original automated scan results.
- **Reviewed score**: starts with the raw results and incorporates completed manual or AI conclusions for `incomplete` items.

Manual judgment takes priority over AI judgment; items without a valid supplemental conclusion remain displayed as original `incomplete`. The score is a quantitative signal for screening, comparison, and issue localization—not a WCAG compliance certification.

## Two visitor types

| Identity | Can do | Cannot do |
| --- | --- | --- |
| Administrator | Create scans, view tasks, configure AI, review `incomplete`, publish reports, and delete unpublished terminal tasks | Modify a published scan |
| Report visitor | Read and download published reports | Scan, change configuration, process AI, delete data, or view unpublished results |

Browser login uses the administrator or visitor key. The server also has `SESSION_SECRET`: it signs session cookies and encrypts saved AI Provider Keys, and is not given to any user. Losing or changing it invalidates existing sessions and makes saved Provider Keys impossible to decrypt.

## Four facts most important for presenting the project

1. The system uses pages rendered in a browser rather than fetching only HTML strings.
2. The system retains node-level evidence, so a report is more than a score or issue count.
3. Completeness is explicit: failed pages, uncovered frames, and `incomplete` items are not presented as “passed.” Here, an “uncovered frame” means an embedded frame in the page that was not checked.
4. Published reports are read-only, preventing results from continuing to change in the background during a demonstration or review.

## What must not be overstated

- Do not say that the scan “covers the entire website”; say only that it covers the pages successfully scanned in this task.
- Do not interpret a score from 0 to 100 as a complete manual audit conclusion or an official WCAG compliance rate.
- Do not describe an AI judgment as expert review; it is auxiliary review of `incomplete` items, and manual conclusions take priority.
- Do not present the small-scale local SQLite implementation as a large production platform.

## Continue reading

- To understand the code path: read [Architecture](./architecture.en.md).
- To understand mathematics and statistics: the mathematics lead should use the [Mathematics lead guide](./math-lead-guide.en.md) as the sole primary material; [Scoring explained](./scoring-explained.en.md) is supplementary for review and presentation.
- To start or deploy the project safely: read [Operations](./operations.en.md).
