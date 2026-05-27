import {existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {fileURLToPath} from "node:url";
import {dirname, join, resolve} from "node:path";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import yaml from "js-yaml";
import myExtension from "../index.ts";
import {ExtensionUIContext} from "@earendil-works/pi-coding-agent";

// pi-coding-agent's exports map only exposes "." and "./hooks" — all dist/core/* paths
// and the bundled faux provider must be imported via absolute path to bypass the map.
const __dirname = dirname(fileURLToPath(import.meta.url));
const PI_ROOT = resolve(__dirname, "../node_modules/@earendil-works/pi-coding-agent");

const {AuthStorage} = await import(`${PI_ROOT}/dist/core/auth-storage.js`);
const {DefaultResourceLoader} = await import(`${PI_ROOT}/dist/core/resource-loader.js`);
const {createAgentSession} = await import(`${PI_ROOT}/dist/core/sdk.js`);
const {SessionManager} = await import(`${PI_ROOT}/dist/core/session-manager.js`);
const {SettingsManager} = await import(`${PI_ROOT}/dist/core/settings-manager.js`);
const {
    registerFauxProvider,
    fauxAssistantMessage,
    fauxToolCall,
} = await import(`${PI_ROOT}/node_modules/@earendil-works/pi-ai/dist/providers/faux.js`);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createSpyUIContext(): any {
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
        onTerminalInput: vi.fn().mockReturnValue(() => {
        }),
        theme: {} as any,
        getAllThemes: vi.fn().mockReturnValue([]),
        getTheme: vi.fn().mockReturnValue(undefined),
        setTheme: vi.fn().mockReturnValue({success: false, error: "no UI"}),
        getToolsExpanded: vi.fn().mockReturnValue(false),
        setToolsExpanded: vi.fn(),
    };
}

async function waitFor(
    condition: () => boolean,
    {timeout = 5000, interval = 50} = {}
): Promise<void> {
    const deadline = Date.now() + timeout;
    while (!condition()) {
        if (Date.now() > deadline) throw new Error("waitFor timed out");
        await new Promise((r) => setTimeout(r, interval));
    }
}

// using js-yaml to handle YAML file write
function seedTasksYaml(dir: string, status: "PENDING" | "IN_PROGRESS" | "DONE") {
    const tasksDir = join(dir, "tasks");
    mkdirSync(tasksDir, {recursive: true});
    const content = yaml.dump({
        tasks: [
            {
                id: 1,
                name: "test-task",
                status,
                instructions: ["Do something.", "Then do something else."],
            },
        ],
    });
    writeFileSync(join(tasksDir, "tasks.yaml"), content, "utf8");
}

// using js-yaml to handle YAML file read
function readTasksYaml(dir: string): any {
    return yaml.load(readFileSync(join(dir, "tasks/tasks.yaml"), "utf8"));
}

// ---------------------------------------------------------------------------
// Fixture setup
// ---------------------------------------------------------------------------

describe("lifecycle-hello: agent_end hook", () => {
    let tempDir: string;
    let agentDir: string;
    let faux: ReturnType<typeof registerFauxProvider>;

    beforeEach(() => {
        tempDir = join(
            tmpdir(),
            `pi-ext-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
        );
        agentDir = join(tempDir, "agent");
        mkdirSync(agentDir, {recursive: true});
        faux = registerFauxProvider();
    });

    afterEach(() => {
        faux.unregister();
        if (existsSync(tempDir)) rmSync(tempDir, {recursive: true, force: true});
    });

    async function buildSession(ui: ExtensionUIContext) {
        const settingsManager = SettingsManager.create(tempDir, agentDir);
        const sessionManager = SessionManager.inMemory();
        const authStorage = AuthStorage.create(join(agentDir, "auth.json"));
        authStorage.setRuntimeApiKey(faux.getModel().provider, "faux-key");

        const resourceLoader = new DefaultResourceLoader({
            cwd: tempDir,
            agentDir,
            settingsManager,
            extensionFactories: [(pi) => myExtension(pi)],
            noSkills: true,
            noPromptTemplates: true,
            noThemes: true,
        });
        await resourceLoader.reload();

        const {session} = await createAgentSession({
            cwd: tempDir,
            agentDir,
            model: faux.getModel(),
            settingsManager,
            sessionManager,
            authStorage,
            resourceLoader,
        });

        await session.bindExtensions({uiContext: ui});

        return {session, sessionManager};
    }

    // -------------------------------------------------------------------------
    // Test 1: first turn; task flipped to IN_PROGRESS; compaction entry is empty-summary
    // -------------------------------------------------------------------------
    it("flips task to IN_PROGRESS and records an empty-summary compaction after the first turn", async () => {
        seedTasksYaml(tempDir, "PENDING");
        const ui = createSpyUIContext();

        faux.setResponses([
            fauxAssistantMessage("Sure, what can I do?"),
            fauxAssistantMessage("On it."), // for the injected task prompt turn
        ]);

        const {session, sessionManager} = await buildSession(ui);

        await session.prompt("Hello! Ready for some work today?");

        // wait for the second user message (injected task prompt) to arrive
        await waitFor(() => {
            const msgs = sessionManager.getEntries().filter(
                (e) => e.type === "message" && (e as any).message?.role === "user"
            );
            return msgs.length >= 2;
        });

        // 1. task is IN_PROGRESS on disk
        const data = readTasksYaml(tempDir);
        expect(data.tasks[0].status).toBe("IN_PROGRESS");

        // 2. empty-summary compaction entry exists
        const entries = sessionManager.getEntries();
        const compaction = entries.find((e) => e.type === "compaction") as any;
        expect(compaction).toBeDefined();
        expect(compaction.summary).toBe("");

        session.dispose();
    });

    // -------------------------------------------------------------------------
    // Test 2: compacted context is wiped; injected prompt contains task details
    // -------------------------------------------------------------------------
    it("wipes context and injects a prompt containing task id, name and done instruction", async () => {
        seedTasksYaml(tempDir, "PENDING");
        const ui = createSpyUIContext();

        // turn 1: reply to "Hello! Ready for some work today?"; turn 2: reply to injected task prompt
        faux.setResponses([
            fauxAssistantMessage("Got it."),
            fauxAssistantMessage("Working on it."),
        ]);

        const {session, sessionManager} = await buildSession(ui);

        await session.prompt("Hello! Ready for some work today?");

        // wait until second user message (injected task prompt) appears
        await waitFor(() => {
            const entries = sessionManager.getEntries();
            const userMessages = entries.filter(
                (e) =>
                    e.type === "message" &&
                    (e as any).message?.role === "user"
            );
            return userMessages.length >= 2;
        });

        const entries = sessionManager.getEntries();

        // find the compaction entry
        const compactionIdx = entries.findIndex((e) => e.type === "compaction");
        expect(compactionIdx).toBeGreaterThan(-1);

        // entries AFTER compaction should not contain the original "Hello! Ready for some work today?" user message
        const afterCompaction = entries.slice(compactionIdx + 1);
        const hasOriginalHiMsg = afterCompaction.some((e) => {
            if (e.type !== "message") return false;
            const msg = (e as any).message;
            if (msg?.role !== "user") return false;
            const text =
                typeof msg.content === "string"
                    ? msg.content
                    : Array.isArray(msg.content)
                        ? msg.content.map((b: any) => b.text ?? "").join("")
                        : "";
            return text.trim() === "Hello! Ready for some work today?";
        });
        expect(hasOriginalHiMsg).toBe(false);

        // find injected user message (second user message)
        const userMessages = entries.filter(
            (e) =>
                e.type === "message" &&
                (e as any).message?.role === "user"
        );
        expect(userMessages.length).toBeGreaterThanOrEqual(2);

        const injectedEntry = userMessages[1] as any;
        const injectedText: string =
            typeof injectedEntry.message.content === "string"
                ? injectedEntry.message.content
                : JSON.stringify(injectedEntry.message.content);

        // assert task id and name appear
        expect(injectedText).toContain("id: 1");
        expect(injectedText).toContain("test-task");

        // assert the done instruction appears
        expect(injectedText.toLowerCase()).toContain("tasks/tasks.yaml");
        expect(injectedText.toLowerCase()).toContain("done");

        session.dispose();
    });

    // -------------------------------------------------------------------------
    // Test 3: LLM writes DONE via write tool; second hook exits with toast; no third turn
    // -------------------------------------------------------------------------
    it("marks task DONE after LLM writes the YAML, shows toast, and does not trigger a third turn", async () => {
        seedTasksYaml(tempDir, "PENDING");
        const ui = createSpyUIContext();

        const doneYaml = yaml.dump({
            tasks: [
                {
                    id: 1,
                    name: "test-task",
                    status: "DONE",
                    instructions: ["Do something.", "Then do something else."],
                },
            ],
        });

        faux.setResponses([
            // turn 1: user "Hello! Ready for some work today?"
            fauxAssistantMessage("Got it."),
            // turn 2: injected task prompt — LLM uses write tool to update tasks.yaml
            fauxAssistantMessage(
                [
                    fauxToolCall(
                        "write",
                        {path: "tasks/tasks.yaml", content: doneYaml},
                        {id: "t-write-1"}
                    ),
                ],
                {stopReason: "toolUse"}
            ),
            fauxAssistantMessage("Task complete."),
        ]);

        const {session, sessionManager} = await buildSession(ui);

        await session.prompt("Hello! Ready for some work today?");

        // wait for "All tasks completed!" toast — the terminal condition for the full cycle
        await waitFor(() => {
            const calls = (ui.notify as ReturnType<typeof vi.fn>).mock.calls;
            return calls.some(([msg]: [string]) => msg === "All tasks completed!");
        });

        // 1. tasks.yaml has DONE status
        const data = readTasksYaml(tempDir);
        expect(data.tasks[0].status).toBe("DONE");

        // 2. only one compaction entry (second agent_end should not re-compact)
        const entries = sessionManager.getEntries();
        const compactions = entries.filter((e) => e.type === "compaction");
        expect(compactions).toHaveLength(1);

        // 3. only two user messages: "Hello! Ready for some work today?" and the injected task prompt (no third turn)
        const userMessages = entries.filter(
            (e) =>
                e.type === "message" &&
                (e as any).message?.role === "user"
        );
        expect(userMessages).toHaveLength(2);

        // 4. toast was called with exact args
        expect(ui.notify).toHaveBeenCalledWith("All tasks completed!", "info");

        session.dispose();
    });
});
