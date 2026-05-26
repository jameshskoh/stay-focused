import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";

interface Task {
  id: number;
  name: string;
  status: "PENDING" | "IN_PROGRESS" | "DONE";
  instructions: string[];
}

interface TasksFile {
  tasks: Task[];
}

function loadTasks(cwd: string): TasksFile {
  const content = readFileSync(resolve(cwd, "tasks/tasks.yaml"), "utf8");
  return yaml.load(content) as TasksFile;
}

function saveTasks(cwd: string, data: TasksFile): void {
  writeFileSync(resolve(cwd, "tasks/tasks.yaml"), yaml.dump(data), "utf8");
}

export default function (pi: ExtensionAPI) {
  let clearOnNextCompact = false;

  pi.on("session_start", async (event, ctx) => {
    ctx.ui.notify(`Hello world, I am session_start (reason: ${event.reason})`, "info");
  });

  pi.on("input", async (_event, ctx) => {
    ctx.ui.notify(`Hello world, I am input (user prompt received)`, "info");
    return { action: "continue" };
  });

  pi.on("session_before_compact", async (event, _ctx) => {
    if (!clearOnNextCompact) return;
    clearOnNextCompact = false;
    return {
      compaction: {
        summary: "",
        firstKeptEntryId: event.preparation.firstKeptEntryId,
        tokensBefore: event.preparation.tokensBefore,
      },
    };
  });

  pi.on("agent_end", async (_event, ctx) => {
    const data = loadTasks(ctx.cwd);
    const nextTask = data.tasks.find((t) => t.status === "PENDING");

    if (!nextTask) {
      ctx.ui.notify("All tasks completed!", "info");
      return;
    }

    nextTask.status = "IN_PROGRESS";
    saveTasks(ctx.cwd, data);

    const instructions = nextTask.instructions.join("\n");
    const prompt =
      `Do the following task (id: ${nextTask.id}, name: "${nextTask.name}"):\n${instructions}\n\n` +
      `When done, update tasks/tasks.yaml and set task id ${nextTask.id} status to DONE.`;

    clearOnNextCompact = true;
    ctx.compact({
      onComplete: () => {
        setTimeout(() => pi.sendUserMessage(prompt), 100);
      },
      onError: (err) => {
        ctx.ui.notify(`Compaction failed: ${err.message}`, "error");
      },
    });
  });
}
