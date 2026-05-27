# Plan: Implement context-builder.ts

## Context

Implementing `context-builder.ts` as the second module of the Stay Focused MVP extension. This module reads `CONTEXT.md` for a given task directory and returns the full injection message string to be passed to `pi.sendUserMessage`. It is pure file I/O with no Pi API dependency.

## Files to Create

- `context-builder.ts` — new file in project root (same level as `task-store.ts`)
- `tests/context-builder.test.ts` — unit tests

## Implementation

### `context-builder.ts`

```typescript
import * as fs from "node:fs";
import * as path from "node:path";

export function buildInjectionMessage(taskDir: string): string {
  const contextPath = path.join(taskDir, "CONTEXT.md");
  const contextContent = fs.readFileSync(contextPath, "utf8");

  const taskId = path.basename(taskDir).split("_")[0];
  const taskName = path.basename(taskDir).split("_").slice(1).join("_");
  const relDir = `tasks/${taskId}_${taskName}`;

  return `${contextContent}

---

As you work, use the following files:
- ${relDir}/PROGRESS.md — your working notebook; plan subtasks and track progress here
- ${relDir}/REMARKS.md — record notable deviations, unexpected findings, or decisions worth documenting

Start your final message with a YAML frontmatter block. If the task is complete:

---
status: DONE
message: Brief summary of what was accomplished.
---

If you cannot complete the task:

---
status: FAILED
message: What went wrong and why the task could not be completed.
---`;
}
```

**Key decisions:**
- `fs.readFileSync` throws naturally if `CONTEXT.md` is missing — satisfies TSD's "Throws if CONTEXT.md does not exist" with no extra code.
- The relative path in the injected message is derived from `path.basename(taskDir)`, preserving the `<id>_<name>` format exactly as stored on disk.
- No content validation — embedded as-is per TSD.

### `tests/context-builder.test.ts`

Two test cases from TSD test plan:

1. **Returns correctly assembled injection string from a valid `CONTEXT.md`** — seeds a task dir with a `CONTEXT.md`, calls `buildInjectionMessage`, asserts the returned string starts with the CONTEXT.md content, contains the PROGRESS.md and REMARKS.md paths, and contains both frontmatter templates.
2. **Throws when `CONTEXT.md` is missing** — calls with a task dir that has no `CONTEXT.md`, expects throw.

Follows the same pattern as `task-store.test.ts`: `beforeEach`/`afterEach` with `fs.mkdtempSync` / `fs.rmSync`.

## Verification

```bash
npx vitest run tests/context-builder.test.ts
```
