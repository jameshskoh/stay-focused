import * as fs from "node:fs";
import * as path from "node:path";

export function buildInjectionMessage(taskDir: string): string {
  const contextPath = path.join(taskDir, "CONTEXT.md");
  const contextContent = fs.readFileSync(contextPath, "utf8");

  const baseName = path.basename(taskDir);
  const relDir = `tasks/${baseName}`;

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
