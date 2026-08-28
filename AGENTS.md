<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Terra → Luna Delegation

When gpt-5.6-terra is the lead, minimize Terra token usage by delegating to gpt-5.6-luna by default.

Delegate all non-trivial bounded work Luna can handle, including exploration, file reading, research, implementation, debugging, testing, and review. Parallelize independent tasks when useful.

Give Luna only the goal, relevant paths, constraints, and acceptance criteria. Let Luna inspect source material itself.

Luna should return only concise findings, changes, tests, and unresolved issues.

Terra should focus on planning, decisions, coordination, and the final answer. Do not redo or reread work Luna completed successfully; use another Luna for verification when needed.

Terra works directly only for trivial tasks, important high-level decisions, or failed/unavailable delegation.