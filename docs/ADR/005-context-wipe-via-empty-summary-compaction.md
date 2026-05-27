# ADR 005: Context Wipe via Empty-Summary Compaction

## Status

Accepted

## Context

Between tasks, the extension must wipe the agent's LLM context so the next task starts in a clean conversation with no memory of prior tasks. Two mechanisms were considered:

- **`ctx.newSession()`** — creates a genuinely fresh session with a new session file; old history is no longer part of the active session at all
- **Custom compaction with empty summary** — triggers Pi's compaction flow via `ctx.compact()` and intercepts `session_before_compact` to return an empty string as the summary; Pi replaces the accumulated context with the summary, so an empty string effectively wipes what the LLM sees

## Decision

The extension wipes LLM context by triggering compaction and returning an empty summary from the `session_before_compact` handler.

## Rationale

- **API availability** — `ctx.newSession()` is only available on `ExtensionCommandContext` (command handlers). It is deliberately excluded from event handlers to avoid deadlocks. Calling it from `agent_end` is not possible without a command-indirection workaround (`sendUserMessage("/some-command")`), which adds a round-trip and an extra failure mode.
- **Same LLM-visible result** — from the agent's perspective, empty-summary compaction and a new session are equivalent: the LLM receives no prior conversation history. The distinction only matters for session file continuity, which is not relevant to the agent.
- **History preserved on disk** — compaction only affects what is sent to the LLM; all pre-compaction messages remain in the session file and are accessible via `ctx.sessionManager.getEntries()`. This means full task history is always recoverable for debugging, even after context wipes.
- **Validated by spike** — the `spike/001-extension-lifecycle` branch demonstrated this pattern working end-to-end, including the `clearOnNextCompact` flag pattern required because `pi.on()` has no `off()`.

## Consequences

- The `clearOnNextCompact` boolean flag in `index.ts` is required to gate the one-shot wipe behaviour, since event handlers cannot be deregistered
- `firstKeptEntryId` and `tokensBefore` from `event.preparation` must be passed through unchanged — they are metadata Pi writes into the session file and must not be altered
- All task history remains in the session file on disk; only the LLM context window is cleared between tasks
