import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { processResult } from "../result-writer.js";
import type { AgentMessage } from "@earendil-works/pi-coding-agent";

let tmpDir: string;
let taskDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "stay-focused-"));
  taskDir = path.join(tmpDir, "tasks", "001_my-task");
  fs.mkdirSync(taskDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function assistantMessage(text: string): AgentMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
  } as AgentMessage;
}

function userMessage(text: string): AgentMessage {
  return {
    role: "user",
    content: text,
  } as AgentMessage;
}

describe("processResult", () => {
  it("writes RESULT.md and returns 'done' for status: DONE frontmatter", () => {
    const reply = "---\nstatus: DONE\nmessage: Task completed.\n---\n\nDetails.";
    const messages: AgentMessage[] = [userMessage("go"), assistantMessage(reply)];

    const result = processResult(taskDir, messages);

    expect(result).toBe("done");
    expect(fs.readFileSync(path.join(taskDir, "RESULT.md"), "utf8")).toBe(reply);
  });

  it("returns 'failed' for status: FAILED frontmatter; RESULT.md still written", () => {
    const reply = "---\nstatus: FAILED\nmessage: Could not complete.\n---\n\nDetails.";
    const messages: AgentMessage[] = [userMessage("go"), assistantMessage(reply)];

    const result = processResult(taskDir, messages);

    expect(result).toBe("failed");
    expect(fs.readFileSync(path.join(taskDir, "RESULT.md"), "utf8")).toBe(reply);
  });

  it("returns 'failed' when frontmatter is missing; RESULT.md still written", () => {
    const reply = "I did some work but forgot the frontmatter.";
    const messages: AgentMessage[] = [userMessage("go"), assistantMessage(reply)];

    const result = processResult(taskDir, messages);

    expect(result).toBe("failed");
    expect(fs.readFileSync(path.join(taskDir, "RESULT.md"), "utf8")).toBe(reply);
  });

  it("returns 'failed' when frontmatter is malformed; RESULT.md still written", () => {
    const reply = "---\nnot: valid: yaml: [unclosed\n---\n\nSome text.";
    const messages: AgentMessage[] = [userMessage("go"), assistantMessage(reply)];

    const result = processResult(taskDir, messages);

    expect(result).toBe("failed");
    expect(fs.readFileSync(path.join(taskDir, "RESULT.md"), "utf8")).toBe(reply);
  });

  it("returns 'failed' when messages contains no assistant message; RESULT.md written as empty file", () => {
    const messages: AgentMessage[] = [userMessage("go")];

    const result = processResult(taskDir, messages);

    expect(result).toBe("failed");
    expect(fs.readFileSync(path.join(taskDir, "RESULT.md"), "utf8")).toBe("");
  });
});
