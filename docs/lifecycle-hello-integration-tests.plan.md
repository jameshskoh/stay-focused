# Integration Test Plan: `lifecycle-hello` `agent_end` hook

## Scope

Tests cover the `agent_end` task-dispatch loop in `.pi/extensions/lifecycle-hello/index.ts`.
`session_start` and `input` handlers are not tested here.

---

## Setup / Teardown (shared)

- `beforeEach`: create `tempDir`, write `tasks/tasks.yaml` to disk (real file, `mkdirSync`), register `faux`, wire session
- `afterEach`: `faux.unregister()`, `rmSync(tempDir, { recursive: true, force: true })`

Default YAML seed: one task `id: 1, name: "...", status: PENDING`.
Tests that need different state write their own YAML before calling `session.prompt`.

---

## Async Helper

No `agent_idle` event exists in the Pi extension API. Use a poll-based `waitFor`:

```typescript
async function waitFor(condition: () => boolean, { timeout = 3000, interval = 50 } = {}) {
  const deadline = Date.now() + timeout;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("waitFor timed out");
    await new Promise(r => setTimeout(r, interval));
  }
}
```

---

## UI Spy Noise

`session_start` and `input` both fire `ctx.ui.notify`. Use exact-args matching or filter
`(ui.notify as vi.Mock).mock.calls` by message string — never assert on raw call counts.

---

## Test 1 — First turn; task flipped to IN_PROGRESS; compaction entry has empty summary

**Faux responses:** `[fauxAssistantMessage("Sure, what can I do?")]`

**Flow:** `prompt("hi")` → LLM replies → `agent_end` fires → task updated → `ctx.compact` triggered →
`session_before_compact` returns `summary: ""`

**Assertions:**
1. `prompt("hi")` resolves without throwing
2. `tasks/tasks.yaml` on disk has task 1 `status: IN_PROGRESS`
3. `sessionManager.getEntries()` contains an entry with `type === "compaction"` and `summary === ""`

---

## Test 2 — Compacted context is wiped; injected prompt contains task details

**Faux responses:**
- turn 1: `fauxAssistantMessage("Got it.")` — for user "hi"
- turn 2: `fauxAssistantMessage("Working on it.")` — for injected task prompt

**Flow:** Same as test 1; `setTimeout` fires → second turn completes.

**Waiting:** After `prompt("hi")` resolves, `waitFor` until `sessionManager.getEntries()` has a
second user-message entry (the injected prompt).

**Assertions:**
1. Entries after the compaction entry do **not** contain `"hi"` in their text content
2. Injected user message contains `task id: 1` and task name from YAML
3. Injected user message contains `update tasks/tasks.yaml` and `set task id 1 status to DONE`

---

## Test 3 — LLM writes DONE via built-in `write` tool; second hook exits with toast; no third turn

**Faux responses:**
- turn 1: `fauxAssistantMessage("Got it.")` — for user "hi"
- turn 2 (injected task prompt): tool call using built-in `write` to overwrite `tasks/tasks.yaml` with `status: DONE`, then `fauxAssistantMessage("Task done.")`

**Waiting:** After `prompt("hi")`, `waitFor` until `ui.notify` has been called with `"All tasks completed!"`.

**Assertions:**
1. `tasks/tasks.yaml` on disk has task 1 `status: DONE`
2. Only one compaction entry in session history (no second compaction)
3. No third user message beyond the injected task prompt
4. `ui.notify` called with `("All tasks completed!", "info")`

---

## Known Unknown

`write` tool parameter shape (e.g. `path` vs `file_path`) — let the test fail on first run and
read the error to discover the exact schema.
