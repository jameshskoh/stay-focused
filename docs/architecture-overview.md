# Architecture Overview: Stay Focused

## What It Is

Stay Focused is a Pi Coding Agent extension that runs a pre-defined task queue autonomously. The user defines tasks upfront; the extension drives the agent through them one at a time, wipes context between tasks, and halts on failure — without any user interaction.

It is distributed as a normal TypeScript package and installed via `pi install git:github.com/<owner>/stay-focused` (ADR-007).

---

## Component Diagram

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Pi Coding Agent Runtime                                                 │
│                                                                          │
│  ┌──────────┐   agent_end          ┌──────────────────────────────────┐  │
│  │  Agent   │ ────────────────────►│           index.ts               │  │
│  │  (LLM +  │                      │  Extension entry point           │  │
│  │  tools)  │◄─── sendUserMessage ─│  Owns: clearOnNextCompact flag   │  │
│  └──────────┘                      │  Wires: agent_end,               │  │
│       ▲                            │         session_before_compact   │  │
│       │ tools: read/write/edit/bash└──────────────┬───────────────────┘  │
│       │                                           │ calls                │
│  ┌────┴─────────────────┐       ┌─────────────────┼──────────────────┐   │
│  │   Task Files         │       │                 │                  │   │
│  │   (per-task dir)     │       ▼                 ▼                  ▼   │
│  │                      │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  │  CONTEXT.md  (read)  │  │ task-store   │  │ context-     │  │ result-      │
│  │  PROGRESS.md (write) │  │    .ts       │  │ builder.ts   │  │ writer.ts    │
│  │  REMARKS.md  (write) │  │              │  │              │  │              │
│  │  RESULT.md   (←ext)  │  │ Read/write   │  │ Reads        │  │ Reads last   │
│  └──────────────────────┘  │ tasks.yaml   │  │ CONTEXT.md   │  │ assistant    │
│                            │              │  │              │  │ message      │
│  ┌──────────────────────┐  │ findFirst    │  │ Returns full │  │              │
│  │   tasks/tasks.yaml   │  │ Pending()    │  │ injection    │  │ Writes       │
│  │                      │  │ findIn       │  │ string       │  │ RESULT.md    │
│  │  - id                │  │ Progress()   │  │              │  │              │
│  │  - name              │◄─│ markIn       │  │ Pure file    │  │ Parses YAML  │
│  │  - status            │  │ Progress()   │  │ I/O; no Pi   │  │ frontmatter  │
│  └──────────────────────┘  │ markDone()   │  │ API          │  │ → "done" |   │
│                            │ markFailed() │  └──────────────┘  │ "failed"     │
│                            │              │                    │              │
│                            │ Pure file    │                    │ Pure file    │
│                            │ I/O; no Pi   │                    │ I/O; no Pi   │
│                            │ API          │                    │ API          │
│                            └──────────────┘                    └──────────────┘
└────────────────────────────────────────────────────────────────────────┘
```

### Module Responsibilities

| Module | Role | Pi API dependency |
|---|---|---|
| `index.ts` | Extension entry point; wires all Pi event hooks; owns the `clearOnNextCompact` flag; orchestrates the loop | Yes — sole module that imports `ExtensionAPI` |
| `task-store.ts` | Sole reader and writer of `tasks.yaml`; exposes status transition functions | None |
| `context-builder.ts` | Reads `CONTEXT.md` and assembles the injection message string | None |
| `result-writer.ts` | Reads the last assistant message, writes `RESULT.md`, parses YAML frontmatter status | None |

Only `index.ts` touches the Pi API. All business logic is isolated in pure file-I/O modules, making them independently testable without a Pi runtime.

---

## Workflow

### Task Directory Layout

```
tasks/
  tasks.yaml              ← machine-managed queue registry
  001_task-name/
    CONTEXT.md            ← user-authored task brief (read by extension, injected to agent)
    PROGRESS.md           ← agent working notebook
    REMARKS.md            ← agent deviations and decisions
    RESULT.md             ← verbatim final agent reply (written by extension)
  002_another-task/
    ...
```

### Loop Sequence

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
                ▼  session_before_compact fires
                   clearOnNextCompact == true → return empty summary
                   LLM context wiped; flag reset to false
                │
                ▼  onComplete: setTimeout 100ms
                │  (waits for Pi to mark agent idle after agent_end handlers return)
                ▼
           pi.sendUserMessage(injectionMessage)
                │  injection contains: CONTEXT.md content + PROGRESS/REMARKS
                │  instructions + required YAML frontmatter reply format
                ▼
           agent_end fires (task round)
                │
                ├─ task 001 is in_progress
                ├─ processResult() → writes RESULT.md
                │
                ├─ [happy path] frontmatter status: DONE
                │     markDone("001")
                │     findFirstPending() → task 002 or null
                │     if null: toast "All tasks complete", return
                │     else: repeat loop for task 002
                │
                └─ [failure path] missing/bad frontmatter or status: FAILED
                      markFailed("001")
                      toast "Task 001 failed — queue halted"
                      return (session stays open for user inspection)
```

### Status Transitions

```
pending  ──(task loaded)──►  in_progress  ──(status: DONE)──►  done
                                  │
                                  └──(status: FAILED, missing/bad frontmatter,
                                      or any internal error)──►  failed
```

Fail-closed: any ambiguous or missing status signal is treated as failure and halts the queue (ADR-002). The queue never advances past a failed task without manual intervention.

### Context Wipe Between Tasks

Between tasks, the extension triggers Pi's compaction flow and intercepts `session_before_compact` to return an empty summary string. This clears what the LLM sees while preserving all session history on disk (ADR-005). A `clearOnNextCompact` boolean gates the one-shot behaviour, since Pi's `pi.on()` has no `off()`.

### Agent Ignorance of the Queue

The agent is never told about `tasks.yaml`, `RESULT.md`, or the queue mechanism. It receives a user message containing its task context and file instructions, does its work, and ends with a YAML frontmatter block. The extension handles all queue state transitions invisibly (ADR-003).

---

## Exposed APIs

Stay Focused exposes no public API surface. It is a Pi extension that installs into a project and runs entirely through Pi's event hooks. There are no HTTP endpoints, no exported functions for external callers, and no programmatic interface beyond installation.

The only interface is the **task directory convention**: users author `CONTEXT.md` files and `tasks.yaml` before running Pi.
