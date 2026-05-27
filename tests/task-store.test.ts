import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as yaml from "js-yaml";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  findFirstPending,
  findInProgress,
  markInProgress,
  markDone,
  markFailed,
} from "../task-store.js";

function seedTasksYaml(dir: string, content: string): void {
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  fs.writeFileSync(path.join(dir, "tasks", "tasks.yaml"), content, "utf8");
}

function readTasksYaml(dir: string): { id: string; name: string; status: string }[] {
  const raw = fs.readFileSync(path.join(dir, "tasks", "tasks.yaml"), "utf8");
  return (yaml.load(raw) as { tasks: { id: string; name: string; status: string }[] }).tasks;
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "stay-focused-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("findFirstPending", () => {
  it("returns the first pending task when one exists", () => {
    seedTasksYaml(tmpDir, `\
tasks:
  - id: "001"
    name: alpha
    status: done
  - id: "002"
    name: beta
    status: pending
  - id: "003"
    name: gamma
    status: pending
`);
    const result = findFirstPending(tmpDir);
    expect(result).toEqual({ id: "002", name: "beta", status: "pending" });
  });

  it("returns null when all tasks are done or failed", () => {
    seedTasksYaml(tmpDir, `\
tasks:
  - id: "001"
    name: alpha
    status: done
  - id: "002"
    name: beta
    status: failed
`);
    expect(findFirstPending(tmpDir)).toBeNull();
  });
});

describe("findInProgress", () => {
  it("returns the in_progress task when one exists", () => {
    seedTasksYaml(tmpDir, `\
tasks:
  - id: "001"
    name: alpha
    status: done
  - id: "002"
    name: beta
    status: in_progress
  - id: "003"
    name: gamma
    status: pending
`);
    expect(findInProgress(tmpDir)).toEqual({ id: "002", name: "beta", status: "in_progress" });
  });

  it("returns null when no task is in_progress", () => {
    seedTasksYaml(tmpDir, `\
tasks:
  - id: "001"
    name: alpha
    status: done
  - id: "002"
    name: beta
    status: pending
`);
    expect(findInProgress(tmpDir)).toBeNull();
  });
});

describe("markInProgress", () => {
  it("transitions the target task and leaves others unchanged", () => {
    seedTasksYaml(tmpDir, `\
tasks:
  - id: "001"
    name: alpha
    status: pending
  - id: "002"
    name: beta
    status: pending
`);
    markInProgress(tmpDir, "001");
    const tasks = readTasksYaml(tmpDir);
    expect(tasks.find((t) => t.id === "001")?.status).toBe("in_progress");
    expect(tasks.find((t) => t.id === "002")?.status).toBe("pending");
  });
});

describe("markDone", () => {
  it("transitions the target task to done", () => {
    seedTasksYaml(tmpDir, `\
tasks:
  - id: "001"
    name: alpha
    status: in_progress
`);
    markDone(tmpDir, "001");
    expect(readTasksYaml(tmpDir)[0].status).toBe("done");
  });
});

describe("markFailed", () => {
  it("transitions the target task to failed", () => {
    seedTasksYaml(tmpDir, `\
tasks:
  - id: "001"
    name: alpha
    status: in_progress
`);
    markFailed(tmpDir, "001");
    expect(readTasksYaml(tmpDir)[0].status).toBe("failed");
  });
});

describe("error cases", () => {
  it("throws when tasks.yaml is missing (findFirstPending)", () => {
    expect(() => findFirstPending(tmpDir)).toThrow();
  });

  it("throws when tasks.yaml is malformed YAML (findFirstPending)", () => {
    fs.mkdirSync(path.join(tmpDir, "tasks"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "tasks", "tasks.yaml"), "{ bad: yaml: [", "utf8");
    expect(() => findFirstPending(tmpDir)).toThrow();
  });

  it("throws when tasks.yaml is missing (findInProgress)", () => {
    expect(() => findInProgress(tmpDir)).toThrow();
  });

  it("throws when tasks.yaml is malformed YAML (findInProgress)", () => {
    fs.mkdirSync(path.join(tmpDir, "tasks"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "tasks", "tasks.yaml"), "{ bad: yaml: [", "utf8");
    expect(() => findInProgress(tmpDir)).toThrow();
  });
});
