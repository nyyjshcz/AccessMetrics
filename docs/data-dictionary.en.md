# Current Run Data Description

> **Who should read this: people who need to verify database fields or write data analyses. Is it required: consult as needed.** It explains field meanings; it is not a project onboarding tutorial or the primary reference for the math owner.

Language: [中文版](./data-dictionary.md)

This is not a database manual listing every historical SQLite migration table item by item. It explains only the data that the current local two-access-key, scanning, review, and publication flows actually read or write. The database still retains some early study-, reviewer-, and R1-to-R5-related tables so that old databases can open; they are **not current product functionality and should not be used as project showcase content**.

## Main chain of one scan

```text
scan_jobs → scan_runs → job_pages / pages → rule_results → result_nodes
                                           └→ page_scores / site_scores
```

| Data | Current use | Key facts for display or calculation |
| --- | --- | --- |
| `sites` | Store the site origin and display name. | One site can correspond to multiple scans; deleting one scan does not delete the shared site identity. |
| `scan_jobs` | User-submitted scan tasks and their status, page limit, errors, and Worker lease. | `max_pages` is a limit, not a promise of discovered or successful page counts. Failed tasks for which no run has yet been created are also retained here. |
| `scan_runs` | A scorable, publishable snapshot of one scan. | Records the scan, axe, rule catalog, and scoring model versions; after `published=1`, the run is read-only. |
| `pages` | Normalized page URLs actually discovered for a task and their scan status. | Redirected or duplicate pages are merged; therefore the number of discovered pages may be lower than the page limit. |
| `job_pages` | Discovery order, attempt count, page-level status, and errors between a task and its pages. | Used to explain the differences among “discovered,” “successful,” “failed,” and “incomplete.” |
| `rule_results` | Per-page, per-axe-rule `pass`, `violation`, `incomplete`, and `inapplicable` results. | `node_count` is the true number of nodes hit by the rule. Passing and inapplicable nodes are not separately stored as large numbers of detailed nodes. |
| `result_nodes` | Location, cleaned HTML, failure summary, and technical evidence for `violation` and `incomplete`. | It is the source for expandable evidence in reports; its row count **cannot** represent the node counts of pass / inapplicable. |
| `page_scores` | Exact numerators, denominators, and display values for the four principles and total score of one page. | Numerators, denominators, and model versions are more authoritative than the decimals shown by the front end. |
| `site_scores` | Aggregate four-principle and total score for one run. | Reports and result pages use it to present the raw automated scan score. |

## Manual and AI review of incomplete

```text
incomplete result_node
  ├─ manual_reviews       Local manual conclusion (priority)
  └─ ai_review_items      AI-assisted conclusion
       ↑
  ai_review_batches ← ai_provider_configs
```

| Data | Current use | Key invariant |
| --- | --- | --- |
| `manual_reviews` | Store local manual conclusions and notes for incomplete nodes. | The current display reads only local conclusions with `sample_id IS NULL`, `review_context='ad_hoc'`, `reviewer='local'`, and `is_current=1`. Manual conclusions take priority over AI. |
| `ai_provider_configs` | Store OpenAI-compatible model service address, model name, encrypted Key, concurrency, and optional RPM strategy. | The API Key is not returned to the browser; the page displays only the Key fingerprint. |
| `ai_review_batches` | A run-wide batch for all incomplete items in one run and its frozen model configuration snapshot. | The new Worker claims only batches where `run_id` exists and there is no page/study scope. |
| `ai_review_items` | Queue status, lease, attempts, AI verdict, and errors for each incomplete node in a batch. | Conclusions are limited to `problem`, `not_problem`, and `uncertain`; temporary errors remain queue items that can be recovered automatically. |

When results are read, the only priority order is: **manual conclusion > AI conclusion > original incomplete**. This does not modify the original axe rule results or node evidence.

## Publication, export, and deletion

| Data | Current use | Boundary |
| --- | --- | --- |
| `exports` | Store HTML, PDF, and JSON export metadata for one run. | Reports for published runs are read-only for administrators and report visitors. |
| `scan_runs.published` / `published_at` | Mark whether the run has been published. | A published run cannot be reviewed, modified, or deleted. |

When an unpublished terminal-state task is deleted, the system cleans up that task's run, page associations, rule results, nodes, scores, manual conclusions, and AI batches/items in the same transaction; it does not delete shared `sites` or model service configurations. Data referenced by study history is rejected for deletion.

## Data retained for compatibility

`study_*`, `manual_review_batches`, `manual_review_samples`, `manual_review_adjudications`, `review_freezes`, `human_gate_*`, `r5_*`, and old `users` / `sessions` tables come from earlier research or multi-reviewer designs. The current Web app does not use them to provide login, roles, or review workflows; they are retained only so existing SQLite databases can migrate safely and remain traceable.

To verify the implementation, use the migrations in `src/lib/db.ts`, `src/lib/repositories.ts`, `src/lib/incomplete-resolution.ts`, and `src/lib/ai-overlay.ts` as the source of truth.
