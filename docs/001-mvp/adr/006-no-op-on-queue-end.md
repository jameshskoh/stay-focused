# ADR 006: No-Op on Queue Completion and Failure

## Status

Accepted

## Context

When the task queue reaches a terminal state — either all tasks complete or a task fails — the extension must decide what to do with the Pi session. Options considered:

- **`ctx.shutdown()`** — requests a graceful Pi shutdown; in interactive mode, deferred until the agent is idle, then emits `session_shutdown` and exits the TUI
- **No-op** — the extension simply returns from the `agent_end` handler; the session remains open and the user retains full control of the TUI

## Decision

On both queue completion and task failure, the extension toasts the user and returns without taking any session lifecycle action. The session stays open.

## Rationale

- **User needs to inspect state** — on failure, the user's immediate next action is to read `RESULT.md` and `REMARKS.md` to understand what went wrong. Closing the TUI forces them to reopen it and navigate to those files externally. Leaving it open lets them inspect files and session history in context before deciding how to proceed.
- **On success, the session is also useful** — after all tasks complete, the user may want to review the session history, ask follow-up questions, or trigger another run. Closing the TUI unconditionally removes that option without benefit.
- **`ctx.shutdown()` timing is user-hostile in interactive mode** — shutdown is deferred until idle, which means the TUI may close at an unpredictable moment after the final toast. A no-op is simpler and more predictable: the session stays open until the user explicitly exits.
- **Pi's philosophy** — Pi is designed around user control; extensions are expected to extend behaviour, not unilaterally terminate the session. A shutdown imposed by an extension without explicit user action is contrary to this model.

## Consequences

- After queue completion or failure, the Pi session remains open and fully interactive
- The user must exit manually (Ctrl+C / Ctrl+D) when done
- The toast notification is the sole signal that the queue has reached a terminal state; the user must notice it
