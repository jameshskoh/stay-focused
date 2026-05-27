import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as path from "node:path";
import {
  findInProgress,
  findFirstPending,
  markInProgress,
  markDone,
  markFailed,
} from "./task-store.js";
import { buildInjectionMessage } from "./context-builder.js";
import { processResult } from "./result-writer.js";

export default function (pi: ExtensionAPI) {
  let clearOnNextCompact = false;

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

  pi.on("agent_end", async (event, ctx) => {
    const cwd = ctx.cwd;
    let currentTaskId: string | undefined;
    try {
      const inProgress = findInProgress(cwd);
      if (inProgress !== null) {
        currentTaskId = inProgress.id;
        const taskDir = path.join(cwd, "tasks", `${inProgress.id}_${inProgress.name}`);
        const outcome = processResult(taskDir, event.messages);
        if (outcome === "done") {
          markDone(cwd, inProgress.id);
        } else {
          markFailed(cwd, inProgress.id);
          ctx.ui.notify(`Task ${inProgress.id} failed — queue halted`, "error");
          return;
        }
      }

      const next = findFirstPending(cwd);
      if (next === null) {
        ctx.ui.notify("All tasks complete", "info");
        return;
      }

      markInProgress(cwd, next.id);
      const taskDir = path.join(cwd, "tasks", `${next.id}_${next.name}`);
      const message = buildInjectionMessage(taskDir);
      clearOnNextCompact = true;
      ctx.compact({
        onComplete: () => setTimeout(() => pi.sendUserMessage(message), 100),
        onError: (err) => ctx.ui.notify(`Compaction failed: ${err.message}`, "error"),
      });
    } catch (err) {
      try {
        if (currentTaskId) markFailed(cwd, currentTaskId);
      } catch {}
      ctx.ui.notify(`Stay Focused internal error: ${(err as Error).message}`, "error");
    }
  });
}
