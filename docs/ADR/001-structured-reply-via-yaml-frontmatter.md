# ADR 001: Structured Reply via YAML Frontmatter

## Status

Accepted

## Context

The extension needs a reliable signal from the agent to determine whether a task succeeded or failed. Several approaches were considered:

- **Custom tool call** — agent calls a dedicated `task_complete` or `task_fail` tool as its final act
- **Agent writes a status file** — agent uses its file write tool to write a status value to a known file path
- **Structured reply in final message** — agent ends its final chat message with a parseable block containing the status

## Decision

The agent signals task outcome by ending its final message with a YAML frontmatter block containing a `status` field (`DONE` or `FAILED`) and a `message` field.

The extension reads the last assistant message at the end of each agent round, writes it verbatim to `RESULT.md`, and parses the frontmatter to determine the outcome.

## Rationale

- **No tool call overhead** — a custom tool requires the agent to recognise when it is "done" and call the tool correctly; it adds a round-trip and an extra failure mode (agent forgets to call it, calls it mid-task, calls it with wrong arguments)
- **No file hunting** — writing status to a file requires the extension to watch or poll a known path; structured reply keeps the signal in the message stream the extension already observes
- **RESULT.md at negligible cost** — the extension writes `RESULT.md` as a side effect of reading the message; no agent tool call is consumed, and the agent need not know `RESULT.md` exists
- **YAML frontmatter is human-readable** — easier to inspect manually than JSON; natural fit for Markdown-heavy task files

## Consequences

- The agent must be instructed to end every task response with the frontmatter block; this instruction must be included in the injected context at task start
- Fail-closed parsing: any response that does not contain well-formed frontmatter with `status: DONE` is treated as failure — the agent cannot accidentally succeed by omitting the block
