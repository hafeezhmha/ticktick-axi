import type { Project, Task } from "./api.js";
import type { TickTickClient } from "./http.js";

/**
 * Organisation endpoints of the Open API: projects (one, create, update,
 * delete, members), project groups, kanban columns, tags, task assignment
 * and batch create/update. One function per documented endpoint, in the
 * same style as `api` in api.ts. Ids are validated by the commands before
 * they reach a path.
 */

/** The `Project` definition, with the sort order the list view omits. */
export type ProjectInfo = Project & { sortOrder?: number };

/** Fields of the Open API `OpenProjectGroup` definition. */
export interface ProjectGroup {
  id: string;
  name?: string;
  sortOrder?: number;
  showAll?: boolean;
  viewMode?: string;
}

/** Fields of the Open API `Column` definition. */
export interface Column {
  id: string;
  projectId?: string;
  name?: string;
  sortOrder?: number;
}

/** Fields of the Open API `OpenTag` definition. */
export interface Tag {
  name?: string;
  label?: string;
  sortOrder?: number;
  color?: string;
  parent?: string;
  /** Personal 1, Team 2. */
  type?: number;
}

/** One entry of GET /project/{projectId}/members. */
export interface Member {
  username?: string;
  displayName?: string;
  self?: boolean;
}

/** A task as returned by assign/unassign (the `Task` definition). */
export type AssignedTask = Task & { assigneeUsername?: string | null };

/** POST /task/batch response. */
export interface BatchResult {
  id2etag?: Record<string, string>;
  id2error?: Record<string, string>;
}

export interface ProjectFields {
  name?: string;
  color?: string;
  sortOrder?: number;
  viewMode?: string;
  kind?: string;
}

const enc = encodeURIComponent;

export const apiOrg = {
  getProject: (c: TickTickClient, projectId: string) =>
    c.request<ProjectInfo>("GET", `/project/${enc(projectId)}`, {
      read: true,
      what: `project ${projectId}`,
    }),

  createProject: (c: TickTickClient, body: ProjectFields & { name: string }) =>
    c.request<ProjectInfo>("POST", "/project", { body, read: false }),

  updateProject: (c: TickTickClient, projectId: string, body: ProjectFields) =>
    c.request<ProjectInfo>("POST", `/project/${enc(projectId)}`, {
      body,
      read: false,
      what: `project ${projectId}`,
    }),

  deleteProject: (c: TickTickClient, projectId: string) =>
    c.request<null>("DELETE", `/project/${enc(projectId)}`, {
      read: false,
      what: `project ${projectId}`,
    }),

  projectMembers: (c: TickTickClient, projectId: string) =>
    c.request<Member[]>("GET", `/project/${enc(projectId)}/members`, {
      read: true,
      what: `project ${projectId}`,
    }),

  listGroups: (c: TickTickClient) =>
    c.request<ProjectGroup[]>("GET", "/project/group", { read: true }),

  createGroup: (c: TickTickClient, name: string) =>
    c.request<ProjectGroup>("POST", "/project/group", {
      body: { name },
      read: false,
    }),

  updateGroup: (c: TickTickClient, groupId: string, name: string) =>
    c.request<ProjectGroup>("POST", `/project/group/${enc(groupId)}`, {
      body: { name },
      read: false,
      what: `project group ${groupId}`,
    }),

  deleteGroup: (c: TickTickClient, groupId: string) =>
    c.request<null>("DELETE", `/project/group/${enc(groupId)}`, {
      read: false,
      what: `project group ${groupId}`,
    }),

  listColumns: (c: TickTickClient, projectId: string) =>
    c.request<Column[]>("GET", `/project/${enc(projectId)}/column`, {
      read: true,
      what: `project ${projectId}`,
    }),

  createColumn: (c: TickTickClient, projectId: string, name: string) =>
    c.request<Column>("POST", `/project/${enc(projectId)}/column`, {
      body: { name },
      read: false,
      what: `project ${projectId}`,
    }),

  updateColumn: (
    c: TickTickClient,
    projectId: string,
    columnId: string,
    name: string,
  ) =>
    c.request<Column>(
      "POST",
      `/project/${enc(projectId)}/column/${enc(columnId)}`,
      {
        body: { name },
        read: false,
        what: `column ${columnId} in project ${projectId}`,
      },
    ),

  listTags: (c: TickTickClient) =>
    c.request<Tag[]>("GET", "/tag", { read: true }),

  createTag: (c: TickTickClient, name: string, label: string) =>
    c.request<Tag>("POST", "/tag", { body: { name, label }, read: false }),

  assignTask: (
    c: TickTickClient,
    projectId: string,
    taskId: string,
    assigneeUsername: string,
  ) =>
    c.request<AssignedTask>("POST", "/task/assign", {
      body: { projectId, taskId, assigneeUsername },
      read: false,
      what: `task ${taskId} in project ${projectId}`,
    }),

  unassignTask: (c: TickTickClient, projectId: string, taskId: string) =>
    c.request<AssignedTask>("POST", "/task/unassign", {
      body: { projectId, taskId },
      read: false,
      what: `task ${taskId} in project ${projectId}`,
    }),

  /** POST /task/batch: up to 50 tasks to add and 50 to update in one call. */
  batchTasks: (
    c: TickTickClient,
    body: {
      add?: Array<Record<string, unknown>>;
      update?: Array<Record<string, unknown>>;
    },
  ) => c.request<BatchResult>("POST", "/task/batch", { body, read: false }),
};
