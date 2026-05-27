import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";

export type TaskStatus = "pending" | "in_progress" | "done" | "failed";

export interface Task {
  id: string;
  name: string;
  status: TaskStatus;
}

function tasksPath(cwd: string): string {
  return path.join(cwd, "tasks", "tasks.yaml");
}

function readTasks(cwd: string): Task[] {
  const raw = fs.readFileSync(tasksPath(cwd), "utf8");
  return yaml.load(raw) as Task[];
}

function writeTasks(cwd: string, tasks: Task[]): void {
  fs.writeFileSync(tasksPath(cwd), yaml.dump(tasks), "utf8");
}

export function findFirstPending(cwd: string): Task | null {
  const tasks = readTasks(cwd);
  return tasks.find((t) => t.status === "pending") ?? null;
}

export function findInProgress(cwd: string): Task | null {
  const tasks = readTasks(cwd);
  return tasks.find((t) => t.status === "in_progress") ?? null;
}

function markStatus(cwd: string, id: string, status: TaskStatus): void {
  const tasks = readTasks(cwd);
  const task = tasks.find((t) => t.id === id);
  if (!task) throw new Error(`Task id "${id}" not found in tasks.yaml`);
  task.status = status;
  writeTasks(cwd, tasks);
}

export function markInProgress(cwd: string, id: string): void {
  markStatus(cwd, id, "in_progress");
}

export function markDone(cwd: string, id: string): void {
  markStatus(cwd, id, "done");
}

export function markFailed(cwd: string, id: string): void {
  markStatus(cwd, id, "failed");
}
