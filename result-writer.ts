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
