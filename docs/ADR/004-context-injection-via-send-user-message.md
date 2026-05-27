# ADR 004: Context Injection via `sendUserMessage`

## Status

Accepted

## Context

At each task start, the extension must inject a message into the agent containing the task context and reply format instructions. Two mechanisms were considered:

- **`before_agent_start` hook** — fires before the agent loop starts for each user prompt; can return a `message` object that is injected as an invisible system-side entry into the session
- **`pi.sendUserMessage()`** — sends an actual user message that appears in the session as if typed by the user; triggers a new agent turn

## Decision

The extension injects task context by calling `pi.sendUserMessage()` with the assembled injection string after compaction completes.

## Rationale

- **Available from the right context** — `before_agent_start` fires during an active agent turn; injecting from there would require a flag-and-defer pattern to bridge from `agent_end` into the next turn's pre-start hook. `sendUserMessage` is callable directly from the `compact` `onComplete` callback (with a `setTimeout` deferral for the idle transition), which is the natural continuation point after context wipe.
- **Semantically correct** — the injected message is a task instruction issued by the harness acting as the user, not a system-side amendment. Representing it as a user message accurately reflects its role in the conversation.
- **Visible in the TUI** — the injected message appears in the session history, making the task handoff visible and inspectable without any extra tooling. An invisible `before_agent_start` injection would make debugging harder.
- **Consistent with the spike** — the proof-of-concept on `spike/001-extension-lifecycle` validated this approach end-to-end; deviating would require re-validation.

## Consequences

- The injected task prompt is visible to the user in the TUI session history
- The `setTimeout(..., 100)` deferral is required because Pi marks the agent idle after all `agent_end` handlers return, not during them; calling `sendUserMessage` synchronously inside the handler throws `"Agent is already processing"`
- The agent sees the injection as a user message, which is consistent with agent-ignorance-of-task-queue (ADR-003): the agent perceives a normal user request, not harness machinery
