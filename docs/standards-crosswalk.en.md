# Standards Mapping and Interpretation Boundaries

> **Who should read this: professors, project reviewers, and presenters. Required reading: yes.** This is required material in the reviewer reading path. Other roles need consult it only when checking rule sources. After reading it, you should know how rules are mapped to WCAG A/AA and what that mapping cannot prove.

[中文](./standards-crosswalk.md) | **English**

## What the current mapping does

The scan uses axe-core rule results and the project-maintained [frozen rule catalog](../configs/axe-rule-catalog.json) to map rules to WCAG 2.2 success criteria and four principles: Perceivable, Operable, Understandable, and Robust. The current rule-catalog version is `wcag-2.2-axe-4.13.0-v1`. This catalog is project-maintained rule-mapping data, not an official WCAG certification checklist. The current work maps only to WCAG 2.2; it is not a conformity assessment against Chinese national standards, local standards, or other regulations.

The mapping sources and steps are:

1. At runtime, axe returns rule IDs, tags, impact levels, and node evidence; these are raw scan evidence.
2. The [frozen rule catalog](../configs/axe-rule-catalog.json) provides WCAG criteria, principles, levels, and scoreability for known rules. It is project-maintained data, not an official WCAG certification checklist.
3. For rules outside the catalog, the system parses candidate criteria only from axe tags matching the `wcagNNN` format; if the current WCAG catalog cannot verify them, they are not included in scoring.
4. Only rules mapped to WCAG A or AA have `scoring_eligible=true`. AAA-only, best-practice, unknown, or unmapped rules still appear in scan results but do not silently affect the score.

## How to understand labels in the report

| Label | Meaning | Does not represent |
| --- | --- | --- |
| WCAG criterion | The success-criterion number to which an automated rule was mapped. | A complete manual conclusion that the page satisfies or violates that criterion. |
| A / AA / AAA | The WCAG level in the rule catalog. | An A, AA, or AAA certification for the whole site. |
| best-practice | An axe best-practice rule. | The rule entering the current scoring model. |
| Unmapped WCAG | The scan tag cannot be reliably checked against the current frozen catalog. | Adding standard clauses from memory or forcing the rule into scoring. |
| incomplete | The automated rule cannot reach a reliable conclusion. | A pass or an automated failure; it must remain pending further judgment. |

## Relationship to scoring

Rule mapping determines which principles a rule belongs to and whether it is eligible for A/AA scoring; the scoring model then calculates the result using node `critical`, `serious`, `moderate`, and `minor` weights. The responsibilities are different:

- Mapping answers “In which WCAG / principle context does this rule belong?”
- Scoring answers “Within this automated screening model, how much deduction do the determined nodes cause?”
- `incomplete` is presented separately as coverage and review status; its raw state does not deduct points.

See [Scoring Explained](./scoring-explained.en.md).

## What it explicitly does not do

- It does not present axe results as a complete manual accessibility audit;
- it does not present a score from 0 to 100 as a WCAG compliance percentage;
- it does not generate specific Chinese national-standard, local-standard, or other regulatory clause comparisons from memory;
- it does not let unknown, AAA-only, or best-practice rules change the total without explicit indication.

When checking an individual rule, return to the report's rule ID, axe help link, tags saved at scan time, and `configs/axe-rule-catalog.json`, rather than relying only on the simplified Chinese explanation on the page.
