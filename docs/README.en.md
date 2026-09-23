# AccessCheck Documentation Map

Language: [中文](README.md) | **English**

> **Who should read this: everyone. Is it required: yes.** Read this page first, then follow one role-based path. Do not treat the entire `docs/` directory as required reading.

This directory accumulated several rounds of plans, verification records, and handoff materials. They have not been deleted, but should **not** be treated as current project documentation by default. If you are learning the project for the first time, read only the “Current materials” paths below.

## Everyone reads first

| Required material | What you should know afterward |
| --- | --- |
| [Project overview](./project-overview.en.md) | What the project does, how one scan proceeds, what reports can show, and what they cannot claim. |

## Read by role

Everyone reads the [project overview](./project-overview.en.md) first. Then read only the row for your role; you do not need to read every listed item.

| Role | Required | Optional | Do not read |
| --- | --- | --- | --- |
| Mathematics lead | [Project overview](./project-overview.en.md), [Mathematics lead guide](./math-lead-guide.en.md) | [Scoring explained](./scoring-explained.en.md), [Data dictionary](./data-dictionary.en.md), `src/lib/score.ts`, `src/lib/run-score.ts` | Architecture, operations, deployment, history archives |
| Professor, project reviewer, presenter | [Project overview](./project-overview.en.md), [Scoring explained](./scoring-explained.en.md), [Standards crosswalk](./standards-crosswalk.en.md) | Issues and node evidence in published reports | Code, operations, deployment, mathematics lead guide, history archives |
| Code owner | Root [README](../README.en.md), [Project overview](./project-overview.en.md), [Architecture](./architecture.en.md) | [Data dictionary](./data-dictionary.en.md), [Security boundaries](./security-boundaries.en.md) | Mathematics lead guide, history archives; for production deployment, proxy, keys, backups, or runtime failures, read [Operations](./operations.en.md) and [Deployment](./ops/deployment.en.md) |
| Deployment owner | Root [README](../README.en.md), [Project overview](./project-overview.en.md), [Operations](./operations.en.md), [Deployment](./ops/deployment.en.md), [Security boundaries](./security-boundaries.en.md) | [Architecture](./architecture.en.md), [Data dictionary](./data-dictionary.en.md) | Mathematics lead guide, scoring explained, history archives |
| Report visitor | No internal documentation | Published reports | All internal material in `docs/` |

## Reference materials as needed

Apart from the role-required materials above, these files are not first-round reading for any role. Deployment owners must still read [Security boundaries](./security-boundaries.en.md), [Operations](./operations.en.md), and [Deployment](./ops/deployment.en.md); other roles should open them only for a specific question.

| Material | Purpose |
| --- | --- |
| [Data dictionary](./data-dictionary.en.md) | Look up database fields, result counts, and relationships between data. |
| [Standards crosswalk](./standards-crosswalk.en.md) | Look up axe rules, WCAG labels, and scoring boundaries. |
| [Security boundaries](./security-boundaries.en.md) | Look up keys, access restrictions, scan targets, and publication restrictions. |
| [Operations](./operations.en.md), [Deployment](./ops/deployment.en.md) | Look up startup, troubleshooting, proxy, keys, backups, and production deployment. |

## Reading boundary

This directory keeps the material needed to operate and understand the current project. Files not listed in a role path should be consulted only for a specific question; when describing current functionality, use the materials listed here and the code as the source of truth.
