import { readToken } from "./config.js";
import { fail, usage } from "./errors.js";
import { TickTickClient } from "./http.js";

/** Fields of the Open API `Task` definition this CLI reads. */
export interface Task {
  id: string;
  projectId: string;
  title?: string;
  content?: string;
  desc?: string;
  isAllDay?: boolean;
  startDate?: string;
  dueDate?: string;
  timeZone?: string;
  repeatFlag?: string;
  priority?: number;
  status?: number;
  completedTime?: string;
  tags?: string[];
  items?: Array<{ id?: string; title?: string; status?: number }>;
  kind?: string;
  parentId?: string;
}

export interface Project {
  id: string;
  name?: string;
  color?: string;
  closed?: boolean;
  groupId?: string;
  viewMode?: string;
  permission?: string;
  kind?: string;
}

/** Documented cap on /task/filter and /task/completed result size. */
export const FILTER_CAP = 200;

export function getClient(): TickTickClient {
  const token = readToken();
  if (!token) {
    throw fail(
      "AUTH_REQUIRED",
      "Not signed in to TickTick",
      "Run `ticktick-axi auth login` (OAuth) or `ticktick-axi auth login --token-stdin` (personal API token)",
      "Or export TICKTICK_ACCESS_TOKEN",
    );
  }
  return new TickTickClient(token);
}

/**
 * TickTick ids are 24-char hex ObjectIds; the inbox project id looks like
 * `inbox123456789`. Anything outside a conservative charset is rejected
 * before it reaches a URL path.
 */
export function validateId(value: string, label: string): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(value)) {
    throw usage(
      `invalid ${label} "${value}"`,
      label === "project id"
        ? "Run `ticktick-axi projects` to list project ids"
        : "Run `ticktick-axi tasks` to list task ids",
    );
  }
  return value;
}

const enc = encodeURIComponent;

export const api = {
  listProjects: (c: TickTickClient) =>
    c.request<Project[]>("GET", "/project", { read: true }),

  projectData: (c: TickTickClient, projectId: string) =>
    c.request<{ project?: Project; tasks?: Task[] }>(
      "GET",
      `/project/${enc(projectId)}/data`,
      { read: true, what: `project ${projectId}` },
    ),

  getTask: (c: TickTickClient, projectId: string, taskId: string) =>
    c.request<Task>("GET", `/project/${enc(projectId)}/task/${enc(taskId)}`, {
      read: true,
      what: `task ${taskId} in project ${projectId}`,
    }),

  /** POST /task/filter is a query (no side effects), so it is retry-safe. */
  filterTasks: (
    c: TickTickClient,
    body: {
      projectIds?: string[];
      priority?: number[];
      tag?: string[];
      status?: number[];
    },
  ) => c.request<Task[]>("POST", "/task/filter", { body, read: true }),

  createTask: (c: TickTickClient, body: Record<string, unknown>) =>
    c.request<Task>("POST", "/task", { body, read: false }),

  updateTask: (
    c: TickTickClient,
    taskId: string,
    body: Record<string, unknown>,
  ) =>
    c.request<Task>("POST", `/task/${enc(taskId)}`, {
      body,
      read: false,
      what: `task ${taskId}`,
    }),

  completeTask: (c: TickTickClient, projectId: string, taskId: string) =>
    c.request<null>(
      "POST",
      `/project/${enc(projectId)}/task/${enc(taskId)}/complete`,
      { read: false, what: `task ${taskId} in project ${projectId}` },
    ),
};
