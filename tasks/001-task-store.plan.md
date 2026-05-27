# Plan: Implement task-store.ts

## Context

Implementing the first of four TypeScript files for the Stay Focused MVP Pi Coding Agent extension. `task-store.ts` is the sole reader/writer of `tasks.yaml` and has no dependencies on other extension modules or the Pi API — making it the right starting point.

The extension is structured as a **normal TypeScript package at the repo root** (not nested inside `.pi/`). For development, point Pi's `settings.json` `extensions` field at the local directory. For distribution, publish to git/npm and install with `pi install git:...` — Pi auto-discovers the extension via the `pi.extensions` field in `package.json`. Runtime deps must be in `dependencies` (not `devDependencies`) since Pi uses a production install.

## File Layout

```
<repo root>/
  package.json               (new)
  tsconfig.json              (new)
  vitest.config.ts           (new)
  task-store.ts              (new — this plan)
  tests/
    task-store.test.ts       (new — this plan)
```

`index.ts`, `context-builder.ts`, `result-writer.ts` are NOT created in this plan.

## package.json

Based on the spike branch pattern (`spike/001-extension-lifecycle`). `js-yaml` in `dependencies` (runtime dep, required by Pi's production install). `vitest`, `@types/*`, `@earendil-works/pi-coding-agent` in `devDependencies`. `"type": "module"`. `pi.extensions` points to `./index.ts` (not yet created, declared for future).

```json
{
  "name": "stay-focused",
  "type": "module",
  "dependencies": {
    "js-yaml": "^4.1.0"
  },
  "devDependencies": {
    "vitest": "^2.0.0",
    "@types/js-yaml": "^4.0.9",
    "@types/node": "^22.0.0",
    "@earendil-works/pi-coding-agent": "0.75.5"
  },
  "scripts": {
    "test": "vitest run"
  },
  "pi": {
    "extensions": ["./index.ts"]
  }
}
```

## tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "./dist"
  },
  "include": ["*.ts", "tests/**/*.ts"]
}
```

## vitest.config.ts

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    testTimeout: 15000,
  },
});
```

## task-store.ts

### Types

```typescript
export type TaskStatus = "pending" | "in_progress" | "done" | "failed";

export interface Task {
  id: string;
  name: string;
  status: TaskStatus;
}
```

### Functions (all synchronous)

```typescript
export function findFirstPending(cwd: string): Task | null
export function markInProgress(cwd: string, id: string): void
export function markDone(cwd: string, id: string): void
export function markFailed(cwd: string, id: string): void
```

### Implementation notes

- `tasks.yaml` path: `path.join(cwd, "tasks", "tasks.yaml")`
- Read: `fs.readFileSync` → `yaml.load` → cast as `Task[]`
- Write: `yaml.dump` → `fs.writeFileSync`
- `findFirstPending`: iterate, return first with `status === "pending"`, else `null`
- `mark*` functions: shared private `readTasks` / `writeTasks`; find task by `id`, mutate `status`, write back
- Errors: let `readFileSync` / `yaml.load` throw naturally for missing/malformed file; explicitly `throw new Error(...)` for id-not-found
- No status transition validation (TSD: "keeping it simple at MVP")

## tests/task-store.test.ts

Real `node:fs` + `node:os` temp directories. No Pi API. Vitest.

### Helper

```typescript
function seedTasksYaml(dir: string, tasks: Task[]): void
// creates tasks/ subdir and writes tasks.yaml with js-yaml
```

### Setup / teardown

`beforeEach`: `fs.mkdtempSync(path.join(os.tmpdir(), "stay-focused-"))` → store in `let tmpDir`  
`afterEach`: `fs.rmSync(tmpDir, { recursive: true, force: true })`

### Test cases (per TSD)

| # | Description |
|---|---|
| 1 | `findFirstPending` returns first `pending` task when one exists |
| 2 | `findFirstPending` returns `null` when all tasks are `done` or `failed` |
| 3 | `markInProgress` transitions the target task; leaves others unchanged |
| 4 | `markDone` transitions the target task to `done` |
| 5 | `markFailed` transitions the target task to `failed` |
| 6 | Throws on missing `tasks.yaml` |
| 7 | Throws on malformed YAML |

## Verification

```bash
cd <repo root>
npm install
npm test
```

All 7 tests pass with no Pi runtime.
