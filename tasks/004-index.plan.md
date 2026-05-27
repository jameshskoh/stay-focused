# Plan: Implement index.ts + integration test

## Context

Three pure modules (`task-store.ts`, `context-builder.ts`, `result-writer.ts`) are complete and unit-tested. `index.ts` is the only remaining piece — the Pi extension entry point that wires them into the Pi event lifecycle. It is the only module that touches the Pi API. The integration test exercises the full async chain through a real `AgentSession` with a faux provider.

---

## Files to create

- `index.ts` — extension entry point
- `tests/loop.integration.test.ts` — 6 integration scenarios

## Files to modify

- `task-store.ts` — add `findInProgress` export (TSD omitted this; TSD needs updating separately)
- `tests/task-store.test.ts` — add 2 unit tests for `findInProgress`

---

## index.ts

### Signature

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as path from "node:path";
import { findInProgress, findFirstPending, markInProgress, markDone, markFailed } from "./task-store.js";
import { buildInjectionMessage } from "./context-builder.js";
import { processResult } from "./result-writer.js";

export default function (pi: ExtensionAPI) { ... }
```

### State

One closure-level boolean: `let clearOnNextCompact = false;`

### Hooks to register

**`session_before_compact`:**
```
if (!clearOnNextCompact) return;
clearOnNextCompact = false;
return {
  compaction: {
    summary: "",
    firstKeptEntryId: event.preparation.firstKeptEntryId,
    tokensBefore: event.preparation.tokensBefore,
  }
};
```

**`agent_end`:** Full loop body below.

### In-progress detection

`index.ts` needs to know which task was in-progress from the previous `agent_end` round in order to build `taskDir` and call `markDone`/`markFailed`. The source of truth is `tasks.yaml` (survives restart; in-memory closure would be lost). Add `findInProgress(cwd): Task | null` to `task-store.ts` — a natural sibling of `findFirstPending`. The TSD omitted this function and needs to be updated separately.

### Loop logic (full)

```typescript
pi.on("agent_end", async (event, ctx) => {
  const cwd = ctx.cwd;
  let currentTaskId: string | undefined;
  try {
    const inProgress = findInProgress(cwd);
    if (inProgress !== null) {
      currentTaskId = inProgress.id;
      const taskDir = path.join(cwd, "tasks", `${inProgress.id}_${inProgress.name}`);
      const outcome = processResult(taskDir, event.messages);
      if (outcome === "done") {
        markDone(cwd, inProgress.id);
      } else {
        markFailed(cwd, inProgress.id);
        ctx.ui.notify(`Task ${inProgress.id} failed — queue halted`, "error");
        return;
      }
    }

    const next = findFirstPending(cwd);
    if (next === null) {
      ctx.ui.notify("All tasks complete", "info");
      return;
    }

    markInProgress(cwd, next.id);
    const taskDir = path.join(cwd, "tasks", `${next.id}_${next.name}`);
    const message = buildInjectionMessage(taskDir);
    clearOnNextCompact = true;
    ctx.compact({
      onComplete: () => setTimeout(() => pi.sendUserMessage(message), 100),
      onError: (err) => ctx.ui.notify(`Compaction failed: ${err.message}`, "error"),
    });
  } catch (err) {
    try { if (currentTaskId) markFailed(cwd, currentTaskId); } catch {}
    ctx.ui.notify(`Stay Focused internal error: ${(err as Error).message}`, "error");
  }
});
```

---

## task-store.ts addition

Add `findInProgress` alongside `findFirstPending`:

```typescript
export function findInProgress(cwd: string): Task | null {
  const tasks = readTasks(cwd);
  return tasks.find((t) => t.status === "in_progress") ?? null;
}
```

## task-store.test.ts additions (2 new unit tests)

Under a new `describe("findInProgress")` block:

```typescript
it("returns the in_progress task when one exists", () => {
  seedTasksYaml(tmpDir, [
    { id: "001", name: "alpha", status: "done" },
    { id: "002", name: "beta", status: "in_progress" },
    { id: "003", name: "gamma", status: "pending" },
  ]);
  expect(findInProgress(tmpDir)).toEqual({ id: "002", name: "beta", status: "in_progress" });
});

it("returns null when no task is in_progress", () => {
  seedTasksYaml(tmpDir, [
    { id: "001", name: "alpha", status: "done" },
    { id: "002", name: "beta", status: "pending" },
  ]);
  expect(findInProgress(tmpDir)).toBeNull();
});
```

---

## tests/loop.integration.test.ts

### Setup pattern

- Top-level `await import(...)` via `PI_ROOT` for all internal Pi modules and faux provider
- `beforeEach`: create unique `tempDir` + `agentDir`, call `registerFauxProvider()`
- `afterEach`: `faux.unregister()`, `rmSync(tempDir)`
- `createSpyUIContext()` helper defined in same file (all 26 methods as `vi.fn()`)
- `seedTasksYaml(dir, tasks[])` and `seedContextMd(taskDir, content)` fixture helpers
- `waitFor(condition, opts)` helper for async chain synchronization

### Extension factory

```typescript
import extensionFactory from "../index.js";
// injected via: extensionFactories: [(pi) => extensionFactory(pi)]
```

### 6 test scenarios

| # | Name | Faux responses | Terminal condition | Assertions |
|---|---|---|---|---|
| 1 | Happy path: single task DONE | Turn 1: any. Turn 2: DONE frontmatter | "All tasks complete" toast | task `done`; RESULT.md written; 2 user messages; 1 compaction entry |
| 2 | Happy path: two tasks in sequence | Turn 1: any. Turn 2: DONE. Turn 3: DONE | "All tasks complete" toast | both `done`; 2 RESULT.mds; 3 user messages; 2 compaction entries |
| 3 | No pending tasks on first message | Turn 1: any | "All tasks complete" toast | fires immediately; no compaction; 1 user message |
| 4 | Failure: `status: FAILED` frontmatter | Turn 1: any. Turn 2: FAILED frontmatter | "Task … failed" toast | task `failed`; RESULT.md written; no further user messages |
| 5 | Failure: missing frontmatter | Turn 1: any. Turn 2: plain text | same as 4 | same as 4 |
| 6 | Context wipe | Turn 1: any. Turn 2: DONE | "All tasks complete" toast | entries after compaction point do not contain exact initial user message; injected task prompt appears after compaction entry |

All tests call `session.dispose()` only after `waitFor` resolves.

---

## Verification

```bash
npm test
```

All 14 existing unit tests must still pass. 6 new integration tests must pass.
