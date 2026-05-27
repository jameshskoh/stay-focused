# ADR 002: Fail-Closed — Halt Queue on Task Failure

## Status

Accepted

## Context

When a task fails, the extension must decide what to do with the remaining queue. Options considered:

- **Skip and continue** — mark the failed task and move on to the next pending task
- **Retry** — re-run the failed task before advancing
- **Halt** — stop the queue, notify the user, and exit

## Decision

On task failure, the extension marks the task `failed`, toasts the user with a failure message, and halts the session. The remaining queue is left untouched for the user to inspect and restart manually.

## Rationale

- **Cascading failures** — tasks in a queue are often related; a failure in an earlier task frequently invalidates the assumptions or outputs that later tasks depend on. Silently continuing risks wasting agent turns on work that is already moot
- **Skip-and-continue is deceptively dangerous** — a skipped failure is easy to miss in a long queue; the user may not notice until significant downstream work has been done on a broken foundation
- **Retry adds complexity with unclear value** — retrying without human input or changed context is unlikely to produce a different outcome; it is deferred to a future iteration where smarter retry logic (e.g. modified prompt, human correction) can be added
- **Halt is the safest default** — it forces the user to inspect the failure before proceeding, preserving the integrity of subsequent tasks

## Consequences

- A single failed task stops the entire run; the user must manually review and restart
- `RESULT.md` and `REMARKS.md` for the failed task are available for inspection
- Future versions may introduce a `continue-on-failure` flag or per-task failure policy
