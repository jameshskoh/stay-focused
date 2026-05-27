# TSD: Stay Focused — MVP

## Overview

This document specifies the technical design for the Stay Focused MVP: a project-local Pi Coding Agent extension that runs a task queue autonomously. It translates the PRD and ADRs into concrete module contracts, data flows, error handling rules, and a test plan.

---

## Deviations from PRD

| PRD statement | TSD decision | Reason |
|---|---|---|
| `loop-controller.ts` listed as a component | Dropped | The orchestration is ~15 lines in `agent_end`; a dedicated controller adds a module boundary for no isolation benefit at MVP |

---

## Module Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  Pi Coding Agent Runtime                                            │
│                                                                     │
│  session.prompt("…")                                                │
│       │                                                             │
│       ▼                                                             │
│  ┌──────────┐   agent_end event    ┌──────────────────────────────┐ │
│  │  Agent   │ ────────────────────►│        index.ts              │ │
│  │  (LLM +  │                      │   Extension entry point      │ │
│  │  tools)  │◄─── sendUserMessage ─│   Owns: clearOnNextCompact   │ │
│  └──────────┘                      │   Wires: all Pi event hooks  │ │
│                                    └──────────┬───────────────────┘ │
└───────────────────────────────────────────────│─────────────────────┘
                                                │ calls
              ┌─────────────────────────────────┼──────────────────────┐
              │                                 │                      │
              ▼                                 ▼                      ▼
  ┌───────────────────┐           ┌──────────────────────┐   ┌─────────────────────┐
  │   task-store.ts   │           │  context-builder.ts  │   │  result-writer.ts   │
  │                   │           │                      │   │                     │
  │ Read/write        │           │ Reads CONTEXT.md     │   │ Reads last assistant│
  │ tasks.yaml        │           │ for a given task     │   │ message from        │
  │                   │           │                      │   │ agent_end event     │
  │ findFirstPending()│           │ Returns the full     │   │                     │
  │ markInProgress()  │           │ injection string:    │   │ Writes verbatim to  │
  │ markDone()        │           │ CONTEXT.md content   │   │ RESULT.md           │
  │ markFailed()      │           │ + PROGRESS/REMARKS   │   │                     │
  │                   │           │ instructions         │   │ Parses YAML         │
  │ Pure file I/O;    │           │ + reply format spec  │   │ frontmatter →       │
  │ no Pi API         │           │                      │   │ returns "done" |    │
  └────────┬──────────┘           │ Pure file I/O;       │   │ "failed"            │
           │                      │ no Pi API            │   │                     │
           │                      └──────────────────────┘   │ Pure: file I/O +    │
           │                                                 │ string parsing;     │
           ▼                                                 │ no Pi API           │
    tasks/tasks.yaml                                         └─────────────────────┘
                                       tasks/<id>_<name>/
                                         CONTEXT.md   (read by context-builder)
                                         PROGRESS.md  (agent writes)
                                         REMARKS.md   (agent writes)
                                         RESULT.md    (result-writer writes)
```

---

## Module Contracts

### `index.ts` — Extension entry point

The only module that imports from the Pi API. Owns the event subscriptions and the `clearOnNextCompact` boolean flag.

**Registered hooks:**

- `session_before_compact` — if `clearOnNextCompact` is true, returns an empty-summary compaction to wipe LLM context; resets the flag to false
- `agent_end` — main loop body (see Loop Logic below)

**Loop logic (inside `agent_end`):**

```
try {
  if current task is in_progress:
    parse result via result-writer
    transition task via task-store (done or failed)
    if failed:
      toast "Task <id> failed — queue halted"
      return

  next = task-store.findFirstPending()
  if next is null:
    toast "All tasks complete"
    return

  task-store.markInProgress(next.id)
  message = context-builder.buildInjectionMessage(taskDir)
  clearOnNextCompact = true
  ctx.compact({
    onComplete: () => setTimeout(() => pi.sendUserMessage(message), 100)
    onError: (err) => toast error message
  })
} catch (err) {
  best-effort: task-store.markFailed(currentTaskId)
  toast "Stay Focused internal error: <err.message>"
  return
}
```

**Notes:**
- `setTimeout(..., 100)` is required — Pi marks the agent idle *after* all `agent_end` handlers return; calling `sendUserMessage` synchronously throws `"Agent is already processing"`. See [agent-idle-race-condition.md].
- The `clearOnNextCompact` flag is necessary because `pi.on()` has no `off()` — handlers cannot be deregistered, so a closure variable gates the one-shot behaviour.
- The catch block calls `markFailed` best-effort; if that also throws, the exception propagates and the session is left in an indeterminate state (acceptable MVP corner case).

**Does not contain:** business logic, file I/O, YAML parsing — all delegated.

---

### `task-store.ts` — Task registry I/O

Sole reader and writer of `tasks.yaml`. No Pi API dependency. All functions are synchronous (js-yaml, node:fs).

**Types:**

```typescript
type TaskStatus = "pending" | "in_progress" | "done" | "failed";

interface Task {
  id: string;
  name: string;
  status: TaskStatus;
}
```

**Functions:**

```typescript
findFirstPending(cwd: string): Task | null
markInProgress(cwd: string, id: string): void
markDone(cwd: string, id: string): void
markFailed(cwd: string, id: string): void
```

- `findFirstPending` returns the first task where `status === "pending"`, or `null` if none.
- The three `mark*` functions read, mutate, and write `tasks.yaml`. They throw if `tasks.yaml` is missing, malformed, or the task `id` is not found.
- No status transition validation beyond finding the right task — keeping it simple at MVP.

**Boundary:** sole writer of `tasks.yaml`. Agent never touches this file (ADR-003).

---

### `context-builder.ts` — Injection message assembler

Reads `CONTEXT.md` for a given task and returns the full string to pass to `pi.sendUserMessage`. No Pi API dependency.

**Function:**

```typescript
buildInjectionMessage(taskDir: string): string
```

`taskDir` is the absolute path to the task directory (e.g. `<cwd>/tasks/001_task-name`).

**Returned string structure:**

```
<contents of CONTEXT.md>

---

As you work, use the following files:
- tasks/<id>_<name>/PROGRESS.md — your working notebook; plan subtasks and track progress here
- tasks/<id>_<name>/REMARKS.md — record notable deviations, unexpected findings, or decisions worth documenting

Start your final message with a YAML frontmatter block. If the task is complete:

---
status: DONE
message: Brief summary of what was accomplished.
---

If you cannot complete the task:

---
status: FAILED
message: What went wrong and why the task could not be completed.
---
```

- Throws if `CONTEXT.md` does not exist at `taskDir/CONTEXT.md`.
- Does not validate the content of `CONTEXT.md` — embedded as-is.

---

### `result-writer.ts` — Outcome recorder and status parser

Reads the last assistant message from `agent_end`'s `event.messages`, writes it verbatim to `RESULT.md`, and parses the YAML frontmatter status.

**Function:**

```typescript
processResult(taskDir: string, messages: AgentMessage[]): "done" | "failed"
```

**Logic:**

1. Find the last message in `messages` where `role === "assistant"` and content is text.
2. Write the full text to `taskDir/RESULT.md` (creates or overwrites). If no assistant message is found, write an empty file. Step 2 always runs regardless of parse outcome (ADR-001).
3. Parse YAML frontmatter: look for a block delimited by `---` at the **start** of the message.
4. Return `"done"` if and only if frontmatter is present, well-formed, and `status === "DONE"` (case-sensitive).
5. Return `"failed"` for all other cases: no assistant message found, missing frontmatter, malformed frontmatter, `status: FAILED`, any other value.

**Boundary:** write-only on `RESULT.md`. Never reads or writes `tasks.yaml`.

---

## Data Flow: Happy Path (single task)

```
User sends any message
        │
        ▼
   agent_end fires
        │
        ├─ no in_progress task → skip result processing
        ├─ findFirstPending() → task 001
        ├─ markInProgress("001")
        ├─ clearOnNextCompact = true
        └─ ctx.compact()
                │
                ▼ session_before_compact fires
                  returns empty summary → context wiped
                │
                ▼ onComplete: setTimeout 100ms
                │
                ▼ pi.sendUserMessage(injectionMessage)
                        │
                        ▼
                   agent_end fires (task round)
                        │
                        ├─ task 001 is in_progress
                        ├─ processResult() → writes RESULT.md → "done"
                        ├─ markDone("001")
                        ├─ findFirstPending() → null
                        └─ toast "All tasks complete"
                           return (loop ends, session stays open)
```

---

## Data Flow: Failure Path

```
                   agent_end fires (task round)
                        │
                        ├─ task 001 is in_progress
                        ├─ processResult() → writes RESULT.md → "failed"
                        ├─ markFailed("001")
                        └─ toast "Task 001 failed — queue halted"
                           return (loop ends, session stays open)
```

---

## Known Edge Case: Tool Calls Within a Task Round

Pi's `agent_end` fires once per `pi.sendUserMessage` call — after the agent has finished all tool use turns and produced its final text response. A task that calls `write`, `read`, `bash`, etc. internally still produces exactly one `agent_end`. There is no risk of the loop advancing mid-task.

However: if a tool call inside a task round somehow triggers a separate `pi.sendUserMessage` from another extension, that would fire a second `agent_end`. In the MVP, no other extension is expected to be active, so this is not handled. If it were to occur, `index.ts` would attempt to process results for a task that is already `in_progress` — which would write a second `RESULT.md` and potentially double-transition the task status. This is documented here as an out-of-scope risk; multi-extension coordination is deferred to a future version.

---

## Error Handling Summary

| Failure point | Behaviour |
|---|---|
| `task-store` throws (missing/malformed YAML, id not found) | Caught by try/catch in `index.ts`; best-effort `markFailed`; toast internal error; return |
| `context-builder` throws (missing `CONTEXT.md`) | Same as above |
| `result-writer` throws (disk write failure) | Same as above |
| `markFailed` throws inside the catch block | Exception propagates; session left open, queue silently dead — acceptable MVP corner |
| `ctx.compact()` `onError` fires | Toast error message; no task status change; loop stalls |
| Agent reply has no assistant message | `processResult` returns `"failed"`; normal failure path |

---

## Test Plan

### Unit Tests

Pure logic — no Pi runtime, no faux provider. Use vitest with real `node:fs` against a temp directory.

| Module | Test case |
|---|---|
| `task-store` | `findFirstPending` returns first `pending` task when one exists |
| `task-store` | `findFirstPending` returns `null` when all tasks are `done` or `failed` |
| `task-store` | `markInProgress` transitions the target task; leaves others unchanged |
| `task-store` | `markDone` transitions the target task to `done` |
| `task-store` | `markFailed` transitions the target task to `failed` |
| `task-store` | Throws on missing `tasks.yaml` |
| `task-store` | Throws on malformed YAML |
| `context-builder` | Returns correctly assembled injection string from a valid `CONTEXT.md` |
| `context-builder` | Throws when `CONTEXT.md` is missing |
| `result-writer` | Writes verbatim message to `RESULT.md` and returns `"done"` for `status: DONE` frontmatter |
| `result-writer` | Returns `"failed"` for `status: FAILED` frontmatter; `RESULT.md` still written |
| `result-writer` | Returns `"failed"` when frontmatter is missing; `RESULT.md` still written |
| `result-writer` | Returns `"failed"` when frontmatter is malformed; `RESULT.md` still written |
| `result-writer` | Returns `"failed"` when `messages` contains no assistant message; `RESULT.md` written as empty file |

### Integration Tests

Full Pi session lifecycle with faux provider and real `AgentSession`. Uses the `PI_ROOT` + dynamic `import()` pattern to bypass the exports map (see integration-testing-gotchas.md §1 and §2). All tests use a full spy UI context (Option B). All tests use a long, unique initial user message to avoid false-positive substring matches in session entry assertions (e.g. `"Hello! I am ready to start a fresh session. Please begin when you are ready."`).

**Fixture helper:** `seedTasksYaml(dir, tasks[])` — creates `tasks/tasks.yaml` with the given task array using js-yaml. `seedContextMd(taskDir, content)` — creates `CONTEXT.md` in the task directory.

| Scenario | Setup | Faux responses | Assertions |
|---|---|---|---|
| **Happy path: single task, DONE** | 1 pending task; `CONTEXT.md` present | Turn 1 (initial msg): any reply. Turn 2 (injected task): assistant reply starting with `status: DONE` YAML frontmatter | `tasks.yaml` task is `done`; `RESULT.md` written with reply text; toast "All tasks complete" fired; exactly 2 user messages in session; exactly 1 compaction entry |
| **Happy path: two tasks in sequence** | 2 pending tasks; both `CONTEXT.md` present | Turn 1: any reply. Turn 2 (task 1): reply starting with `status: DONE` frontmatter. Turn 3 (task 2): same | Both tasks `done` in `tasks.yaml`; 2 `RESULT.md` files written; toast "All tasks complete" fires once at the end; exactly 3 user messages; exactly 2 compaction entries |
| **No pending tasks on first message** | All tasks `done` | Turn 1: any reply | Toast "All tasks complete" fires immediately; no compaction entry; only 1 user message in session |
| **Failure: `status: FAILED` frontmatter** | 1 pending task | Turn 1: any reply. Turn 2: assistant reply starting with `status: FAILED` YAML frontmatter | Task marked `failed`; `RESULT.md` written; toast "Task … failed — queue halted"; no further user messages injected |
| **Failure: missing frontmatter** | 1 pending task | Turn 1: any reply. Turn 2: plain assistant reply with no frontmatter block | Same as above |
| **Context wipe: compaction clears prior history** | 1 pending task | Turn 1: any reply. Turn 2: reply starting with `status: DONE` frontmatter | Entries after the compaction point do not contain the original user message text (exact-match check); injected task prompt appears after the compaction entry |

**Dispose pattern:** all integration tests `waitFor` the terminal condition (toast fired, or second user message present) before calling `session.dispose()` to avoid the stale-context error from the `setTimeout` chain (see integration-testing-gotchas.md §5).

---

## File Layout

```
.pi/extensions/stay-focused/
  package.json
  package-lock.json
  node_modules/
  index.ts
  task-store.ts
  context-builder.ts
  result-writer.ts
  tests/
    task-store.test.ts
    context-builder.test.ts
    result-writer.test.ts
    loop.integration.test.ts
```

---

## Resolved Design Decisions

- **`markInProgress` timing:** called before `context-builder` assembles the message. Fail fast: if `CONTEXT.md` is missing, we still have a record that the task was attempted.
- **`result-writer` with no assistant message:** write an empty `RESULT.md`. An empty file is evidence the write ran but the agent produced nothing — distinct from the file never existing.
