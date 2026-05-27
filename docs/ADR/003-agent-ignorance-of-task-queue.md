# ADR 003: Agent Ignorance of Task Queue

## Status

Accepted

## Context

The extension manages a task queue via `tasks.yaml` and writes task outcomes to `RESULT.md`. A design choice must be made about how much of this infrastructure the agent is aware of and can interact with.

Options considered:

- **Full transparency** — agent is given access to `tasks.yaml` and `RESULT.md`; it can read queue state and write its own outcome
- **Partial transparency** — agent sees its task files (`CONTEXT.md`, `PROGRESS.md`, `REMARKS.md`) but not the queue registry or result record
- **Full ignorance** — agent sees only its task files; all queue and outcome management is handled exclusively by the extension

## Decision

The agent is given access to its task-scoped files only: `CONTEXT.md` (read), `PROGRESS.md` (read/write), and `REMARKS.md` (read/write). It is not told about `tasks.yaml` or `RESULT.md`. Queue state transitions and result recording are handled entirely by the extension.

## Rationale

- **`tasks.yaml` integrity** — the queue registry is machine-managed state; allowing the agent to write to it opens the door to corrupt or inconsistent state (wrong status values, malformed YAML, out-of-order transitions). The extension is the sole writer, keeping state transitions predictable and auditable
- **Swappable queue backend** — insulating the agent from `tasks.yaml` means the storage mechanism can be replaced (a database, a remote API, a different file format) without changing agent instructions or task file conventions
- **`RESULT.md` at no cost** — the extension writes `RESULT.md` as a side effect of reading the agent's final message; asking the agent to write it instead would consume a tool call for no additional benefit
- **Task files are naturally agent-facing** — `CONTEXT.md`, `PROGRESS.md`, and `REMARKS.md` are Markdown documents the agent reads and writes as part of doing its work; their file-based nature is ergonomic and familiar. Storing them elsewhere is possible but not explored in MVP

## Consequences

- The agent cannot query queue state or know how many tasks remain
- The agent cannot self-report outcomes to `tasks.yaml`; it can only signal via its final message frontmatter
- Task file locations are fixed relative to the project root for MVP; alternative storage is deferred
