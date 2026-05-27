import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as yaml from "js-yaml";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import type { Task } from "../task-store.js";
import extensionFactory from "../index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PI_ROOT = resolve(__dirname, "../node_modules/@earendil-works/pi-coding-agent");

const { AuthStorage } = await import(`${PI_ROOT}/dist/core/auth-storage.js`);
const { DefaultResourceLoader } = await import(`${PI_ROOT}/dist/core/resource-loader.js`);
const { createAgentSession } = await import(`${PI_ROOT}/dist/core/sdk.js`);
const { SessionManager } = await import(`${PI_ROOT}/dist/core/session-manager.js`);
const { SettingsManager } = await import(`${PI_ROOT}/dist/core/settings-manager.js`);
const { registerFauxProvider, fauxAssistantMessage } = await import(
  `${PI_ROOT}/node_modules/@earendil-works/pi-ai/dist/providers/faux.js`
);

// --- Helpers ---

function createSpyUIContext() {
  return {
    select: vi.fn().mockResolvedValue(undefined),
    confirm: vi.fn().mockResolvedValue(false),
    input: vi.fn().mockResolvedValue(undefined),
    editor: vi.fn().mockResolvedValue(undefined),
    custom: vi.fn().mockResolvedValue(undefined),
    notify: vi.fn(),
    setStatus: vi.fn(),
    setWorkingMessage: vi.fn(),
    setWorkingVisible: vi.fn(),
    setWorkingIndicator: vi.fn(),
    setHiddenThinkingLabel: vi.fn(),
    setWidget: vi.fn(),
    setFooter: vi.fn(),
    setHeader: vi.fn(),
    setTitle: vi.fn(),
    pasteToEditor: vi.fn(),
    setEditorText: vi.fn(),
    getEditorText: vi.fn().mockReturnValue(""),
    addAutocompleteProvider: vi.fn(),
    setEditorComponent: vi.fn(),
    getEditorComponent: vi.fn().mockReturnValue(undefined),
    onTerminalInput: vi.fn().mockReturnValue(() => {}),
    theme: {} as any,
    getAllThemes: vi.fn().mockReturnValue([]),
    getTheme: vi.fn().mockReturnValue(undefined),
    setTheme: vi.fn().mockReturnValue({ success: false, error: "no UI" }),
    getToolsExpanded: vi.fn().mockReturnValue(false),
    setToolsExpanded: vi.fn(),
  };
}

function seedTasksYaml(dir: string, content: string): void {
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  fs.writeFileSync(path.join(dir, "tasks", "tasks.yaml"), content, "utf8");
}

function seedContextMd(taskDir: string, content: string): void {
  fs.mkdirSync(taskDir, { recursive: true });
  fs.writeFileSync(path.join(taskDir, "CONTEXT.md"), content, "utf8");
}

function readTasksYaml(dir: string): Task[] {
  const raw = fs.readFileSync(path.join(dir, "tasks", "tasks.yaml"), "utf8");
  return (yaml.load(raw) as { tasks: Task[] }).tasks;
}

async function waitFor(
  condition: () => boolean,
  { timeout = 10000, interval = 50 } = {}
): Promise<void> {
  const deadline = Date.now() + timeout;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, interval));
  }
}

function doneReply(msg = "Work complete."): string {
  return `---\nstatus: DONE\nmessage: ${msg}\n---\n\nAll done.`;
}

function failedReply(msg = "Something broke."): string {
  return `---\nstatus: FAILED\nmessage: ${msg}\n---\n\nCould not complete.`;
}

// --- Test suite ---

describe("stay-focused integration", () => {
  let tempDir: string;
  let agentDir: string;
  let faux: ReturnType<typeof registerFauxProvider>;

  beforeEach(() => {
    tempDir = path.join(
      os.tmpdir(),
      `stay-focused-int-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    agentDir = path.join(tempDir, "agent");
    fs.mkdirSync(agentDir, { recursive: true });
    faux = registerFauxProvider();
  });

  afterEach(() => {
    faux.unregister();
    if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
  });

  async function buildSession(ui: ReturnType<typeof createSpyUIContext>) {
    const settingsManager = SettingsManager.create(tempDir, agentDir);
    const sessionManager = SessionManager.inMemory();
    const authStorage = AuthStorage.create(path.join(agentDir, "auth.json"));
    authStorage.setRuntimeApiKey(faux.getModel().provider, "faux-key");

    const resourceLoader = new DefaultResourceLoader({
      cwd: tempDir,
      agentDir,
      settingsManager,
      extensionFactories: [(pi: any) => extensionFactory(pi)],
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
    });
    await resourceLoader.reload();

    const { session } = await createAgentSession({
      cwd: tempDir,
      agentDir,
      model: faux.getModel(),
      settingsManager,
      sessionManager,
      authStorage,
      resourceLoader,
    });

    await session.bindExtensions({ uiContext: ui });
    return { session, sessionManager };
  }

  it("happy path: single task, DONE", async () => {
    seedTasksYaml(tempDir, `\
tasks:
  - id: "001"
    name: alpha
    status: pending
`);
    seedContextMd(path.join(tempDir, "tasks", "001_alpha"), "Do the alpha task.");

    faux.setResponses([
      fauxAssistantMessage("Hello! I am ready to start a fresh session. Please begin when you are ready."),
      fauxAssistantMessage(doneReply("Alpha done.")),
    ]);

    const ui = createSpyUIContext();
    const { session, sessionManager } = await buildSession(ui);

    await session.prompt(
      "Hello! I am ready to start a fresh session. Please begin when you are ready."
    );

    await waitFor(() =>
      (ui.notify as Mock).mock.calls.some((c) => c[0] === "All tasks complete")
    );

    const tasks = readTasksYaml(tempDir);
    expect(tasks.find((t) => t.id === "001")?.status).toBe("done");

    const resultPath = path.join(tempDir, "tasks", "001_alpha", "RESULT.md");
    expect(fs.existsSync(resultPath)).toBe(true);
    expect(fs.readFileSync(resultPath, "utf8")).toContain("DONE");

    expect(ui.notify).toHaveBeenCalledWith("All tasks complete", "info");

    const entries = sessionManager.getEntries();
    const userMsgs = entries.filter(
      (e: any) => e.type === "message" && e.message?.role === "user"
    );
    expect(userMsgs.length).toBe(2);

    const compactionEntries = entries.filter((e: any) => e.type === "compaction");
    expect(compactionEntries.length).toBe(1);

    session.dispose();
  });

  it("happy path: two tasks in sequence", async () => {
    seedTasksYaml(tempDir, `\
tasks:
  - id: "001"
    name: alpha
    status: pending
  - id: "002"
    name: beta
    status: pending
`);
    seedContextMd(path.join(tempDir, "tasks", "001_alpha"), "Do the alpha task.");
    seedContextMd(path.join(tempDir, "tasks", "002_beta"), "Do the beta task.");

    faux.setResponses([
      fauxAssistantMessage("Hello! I am ready to start a fresh session. Please begin when you are ready."),
      fauxAssistantMessage(doneReply("Alpha done.")),
      fauxAssistantMessage(doneReply("Beta done.")),
    ]);

    const ui = createSpyUIContext();
    const { session, sessionManager } = await buildSession(ui);

    await session.prompt(
      "Hello! I am ready to start a fresh session. Please begin when you are ready."
    );

    await waitFor(() =>
      (ui.notify as Mock).mock.calls.some((c) => c[0] === "All tasks complete")
    );

    const tasks = readTasksYaml(tempDir);
    expect(tasks.find((t) => t.id === "001")?.status).toBe("done");
    expect(tasks.find((t) => t.id === "002")?.status).toBe("done");

    expect(fs.existsSync(path.join(tempDir, "tasks", "001_alpha", "RESULT.md"))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, "tasks", "002_beta", "RESULT.md"))).toBe(true);

    expect(ui.notify).toHaveBeenCalledWith("All tasks complete", "info");

    const entries = sessionManager.getEntries();
    const userMsgs = entries.filter(
      (e: any) => e.type === "message" && e.message?.role === "user"
    );
    expect(userMsgs.length).toBe(3);

    const compactionEntries = entries.filter((e: any) => e.type === "compaction");
    expect(compactionEntries.length).toBe(2);

    session.dispose();
  });

  it("no pending tasks on first message", async () => {
    seedTasksYaml(tempDir, `\
tasks:
  - id: "001"
    name: alpha
    status: done
  - id: "002"
    name: beta
    status: done
`);

    faux.setResponses([
      fauxAssistantMessage("Hello! I am ready to start a fresh session. Please begin when you are ready."),
    ]);

    const ui = createSpyUIContext();
    const { session, sessionManager } = await buildSession(ui);

    await session.prompt(
      "Hello! I am ready to start a fresh session. Please begin when you are ready."
    );

    await waitFor(() =>
      (ui.notify as Mock).mock.calls.some((c) => c[0] === "All tasks complete")
    );

    expect(ui.notify).toHaveBeenCalledWith("All tasks complete", "info");

    const entries = sessionManager.getEntries();
    const userMsgs = entries.filter(
      (e: any) => e.type === "message" && e.message?.role === "user"
    );
    expect(userMsgs.length).toBe(1);

    const compactionEntries = entries.filter((e: any) => e.type === "compaction");
    expect(compactionEntries.length).toBe(0);

    session.dispose();
  });

  it("failure: status FAILED frontmatter", async () => {
    seedTasksYaml(tempDir, `\
tasks:
  - id: "001"
    name: alpha
    status: pending
`);
    seedContextMd(path.join(tempDir, "tasks", "001_alpha"), "Do the alpha task.");

    faux.setResponses([
      fauxAssistantMessage("Hello! I am ready to start a fresh session. Please begin when you are ready."),
      fauxAssistantMessage(failedReply("Could not proceed.")),
    ]);

    const ui = createSpyUIContext();
    const { session, sessionManager } = await buildSession(ui);

    await session.prompt(
      "Hello! I am ready to start a fresh session. Please begin when you are ready."
    );

    await waitFor(() =>
      (ui.notify as Mock).mock.calls.some((c) => c[0].includes("failed"))
    );

    const tasks = readTasksYaml(tempDir);
    expect(tasks.find((t) => t.id === "001")?.status).toBe("failed");

    const resultPath = path.join(tempDir, "tasks", "001_alpha", "RESULT.md");
    expect(fs.existsSync(resultPath)).toBe(true);
    expect(fs.readFileSync(resultPath, "utf8")).toContain("FAILED");

    expect(
      (ui.notify as Mock).mock.calls.some((c) => c[0].includes("001") && c[0].includes("failed"))
    ).toBe(true);

    const entries = sessionManager.getEntries();
    const userMsgs = entries.filter(
      (e: any) => e.type === "message" && e.message?.role === "user"
    );
    expect(userMsgs.length).toBe(2);

    session.dispose();
  });

  it("failure: missing frontmatter", async () => {
    seedTasksYaml(tempDir, `\
tasks:
  - id: "001"
    name: alpha
    status: pending
`);
    seedContextMd(path.join(tempDir, "tasks", "001_alpha"), "Do the alpha task.");

    faux.setResponses([
      fauxAssistantMessage("Hello! I am ready to start a fresh session. Please begin when you are ready."),
      fauxAssistantMessage("I tried but there is no frontmatter in this reply."),
    ]);

    const ui = createSpyUIContext();
    const { session, sessionManager } = await buildSession(ui);

    await session.prompt(
      "Hello! I am ready to start a fresh session. Please begin when you are ready."
    );

    await waitFor(() =>
      (ui.notify as Mock).mock.calls.some((c) => c[0].includes("failed"))
    );

    const tasks = readTasksYaml(tempDir);
    expect(tasks.find((t) => t.id === "001")?.status).toBe("failed");

    expect(fs.existsSync(path.join(tempDir, "tasks", "001_alpha", "RESULT.md"))).toBe(true);

    const entries = sessionManager.getEntries();
    const userMsgs = entries.filter(
      (e: any) => e.type === "message" && e.message?.role === "user"
    );
    expect(userMsgs.length).toBe(2);

    session.dispose();
  });

  it("context wipe: compaction clears prior history", async () => {
    const initialPrompt =
      "Hello! I am ready to start a fresh session. Please begin when you are ready.";

    seedTasksYaml(tempDir, `\
tasks:
  - id: "001"
    name: alpha
    status: pending
`);
    seedContextMd(path.join(tempDir, "tasks", "001_alpha"), "Do the alpha task.");

    faux.setResponses([
      fauxAssistantMessage(initialPrompt),
      fauxAssistantMessage(doneReply("Alpha done.")),
    ]);

    const ui = createSpyUIContext();
    const { session, sessionManager } = await buildSession(ui);

    await session.prompt(initialPrompt);

    await waitFor(() =>
      (ui.notify as Mock).mock.calls.some((c) => c[0] === "All tasks complete")
    );

    const entries = sessionManager.getEntries();
    const compactionEntries = entries.filter((e: any) => e.type === "compaction");
    expect(compactionEntries.length).toBe(1);

    const compactionIndex = entries.indexOf(compactionEntries[0]);
    const entriesAfterCompaction = entries.slice(compactionIndex + 1);

    const initialPromptAppearsAfter = entriesAfterCompaction.some((e: any) => {
      if (e.type !== "message" || e.message?.role !== "user") return false;
      const content = e.message.content;
      const text = Array.isArray(content)
        ? content.map((b: any) => b.text ?? "").join("")
        : content ?? "";
      return text.trim() === initialPrompt;
    });
    expect(initialPromptAppearsAfter).toBe(false);

    const injectedTaskAppearsAfter = entriesAfterCompaction.some((e: any) => {
      if (e.type !== "message" || e.message?.role !== "user") return false;
      const content = e.message.content;
      const text = Array.isArray(content)
        ? content.map((b: any) => b.text ?? "").join("")
        : content ?? "";
      return text.includes("Do the alpha task.");
    });
    expect(injectedTaskAppearsAfter).toBe(true);

    session.dispose();
  });
});
