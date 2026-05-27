import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildInjectionMessage } from "../context-builder.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "stay-focused-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("buildInjectionMessage", () => {
  it("returns correctly assembled injection string from a valid CONTEXT.md", () => {
    const taskDir = path.join(tmpDir, "tasks", "001_my-task");
    fs.mkdirSync(taskDir, { recursive: true });
    const contextContent = "Do the thing.\n\nDetails here.";
    fs.writeFileSync(path.join(taskDir, "CONTEXT.md"), contextContent, "utf8");

    const result = buildInjectionMessage(taskDir);

    expect(result.startsWith(contextContent)).toBe(true);
    expect(result).toContain("tasks/001_my-task/PROGRESS.md");
    expect(result).toContain("tasks/001_my-task/REMARKS.md");
    expect(result).toContain("status: DONE");
    expect(result).toContain("status: FAILED");
  });

  it("throws when CONTEXT.md is missing", () => {
    const taskDir = path.join(tmpDir, "tasks", "001_my-task");
    fs.mkdirSync(taskDir, { recursive: true });

    expect(() => buildInjectionMessage(taskDir)).toThrow();
  });
});
