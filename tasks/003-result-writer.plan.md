# Plan: Implement result-writer.ts

## Context

`task-store.ts` and `context-builder.ts` are already implemented. The next module to build is `result-writer.ts`, which is responsible for:
1. Finding the last assistant message from `agent_end` event messages
2. Writing it verbatim to `RESULT.md` in the task directory
3. Parsing the YAML frontmatter from that message to determine outcome
4. Returning `"done"` or `"failed"` based on the frontmatter parse

## Types

From the Pi harness type definitions:

```typescript
// AgentMessage = Message | CustomAgentMessages[keyof CustomAgentMessages]
// Message = UserMessage | AssistantMessage | ToolResultMessage
// AssistantMessage:
interface AssistantMessage {
  role: "assistant";
  content: (TextContent | ThinkingContent | ToolCall)[];
}
// TextContent:
interface TextContent {
  type: "text";
  text: string;
}
```

To extract text from an assistant message: filter `content` items where `type === "text"`, join `.text` fields.

## Implementation Plan

### File: `result-writer.ts`

```typescript
import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";
import type { AgentMessage } from "@earendil-works/pi-coding-agent";
import type { AssistantMessage, TextContent } from "@earendil-works/pi-ai";

export function processResult(
  taskDir: string,
  messages: AgentMessage[]
): "done" | "failed" {
  let lastText: string | null = null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "assistant") {
      const assistantMsg = msg as AssistantMessage;
      const text = assistantMsg.content
        .filter((c): c is TextContent => c.type === "text")
        .map((c) => c.text)
        .join("");
      if (text.length > 0) {
        lastText = text;
        break;
      }
    }
  }

  fs.writeFileSync(path.join(taskDir, "RESULT.md"), lastText ?? "", "utf8");

  if (lastText === null) return "failed";
  return parseFrontmatterStatus(lastText);
}

function parseFrontmatterStatus(text: string): "done" | "failed" {
  if (!text.startsWith("---")) return "failed";
  const end = text.indexOf("\n---", 3);
  if (end === -1) return "failed";
  const frontmatter = text.slice(3, end).trim();
  try {
    const parsed = yaml.load(frontmatter) as { status?: string };
    return parsed?.status === "DONE" ? "done" : "failed";
  } catch {
    return "failed";
  }
}
```

**Key decisions:**
- Import `AgentMessage` from `@earendil-works/pi-coding-agent`; import `AssistantMessage` and `TextContent` from `@earendil-works/pi-ai` for clean type narrowing (no cast needed)
- Added `"@earendil-works/pi-ai": "0.75.5"` to devDependencies in `package.json` — it was previously only a transitive dep under `pi-coding-agent/node_modules`
- `AssistantMessage.content` is `(TextContent | ThinkingContent | ToolCall)[]`; type predicate `(c): c is TextContent => c.type === "text"` for clean filtering
- Frontmatter detection: `text.startsWith("---")` then find closing `\n---` — matches TSD spec ("at the start of the message")
- `yaml.load` already used in `task-store.ts`, no new dependency

### File: `tests/result-writer.test.ts`

Test cases per TSD:
1. Writes RESULT.md and returns `"done"` for `status: DONE` frontmatter
2. Returns `"failed"` for `status: FAILED` frontmatter; RESULT.md still written
3. Returns `"failed"` when frontmatter is missing; RESULT.md still written
4. Returns `"failed"` when frontmatter is malformed; RESULT.md still written
5. Returns `"failed"` when no assistant message in messages; RESULT.md written as empty file

Helper: construct minimal `AgentMessage[]` arrays inline (no Pi runtime needed — just plain objects matching the shape).

## Verification

Run `npm test` — all 14 tests (9 existing + 5 new) pass.
