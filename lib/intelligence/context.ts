export type IntelligenceComment = {
  id: number;
  authorName: string | null;
  body: string;
  createdAt: Date | null;
};

export type TaskContext = {
  taskId: number;
  clickupTaskId: string;
  name: string;
  description: string | null;
  status: string | null;
  priority: string | null;
  dueDate: Date | null;
  updatedAt: Date | null;
  listName: string;
  assignees: string[];
  comments: IntelligenceComment[];
};

type TaskRecord = {
  id: number;
  clickupTaskId: string;
  name: string;
  description: string | null;
  clickupStatus: string | null;
  clickupPriority: string | null;
  dueDate: Date | null;
  clickupUpdatedAt: Date | null;
  list: { name: string };
  assignees: Array<{ employee: { name: string } }>;
  comments: Array<{ id: number; authorName: string | null; body: string; clickupCreatedAt: Date | null }>;
};

export function buildTaskContext(task: TaskRecord): TaskContext {
  return {
    taskId: task.id,
    clickupTaskId: task.clickupTaskId,
    name: task.name,
    description: task.description,
    status: task.clickupStatus,
    priority: task.clickupPriority,
    dueDate: task.dueDate,
    updatedAt: task.clickupUpdatedAt,
    listName: task.list.name,
    assignees: task.assignees.map(({ employee }) => employee.name),
    comments: [...task.comments]
      .sort((a, b) => (a.clickupCreatedAt?.getTime() ?? 0) - (b.clickupCreatedAt?.getTime() ?? 0))
      .map((comment) => ({
        id: comment.id,
        authorName: comment.authorName,
        body: comment.body,
        createdAt: comment.clickupCreatedAt
      }))
  };
}

export function contextText(context: TaskContext): string {
  return [
    `Task: ${context.name}`,
    `List: ${context.listName}`,
    `ClickUp status: ${context.status ?? 'unknown'}`,
    `Priority: ${context.priority ?? 'none'}`,
    `Assigned internal employees: ${context.assignees.join(', ') || 'none'}`,
    `Due date: ${context.dueDate?.toISOString() ?? 'none'}`,
    `Last ClickUp update: ${context.updatedAt?.toISOString() ?? 'unknown'}`,
    context.description ? `Description: ${context.description}` : '',
    ...context.comments.map((comment) =>
      `[${comment.createdAt?.toISOString() ?? 'unknown time'}] ${comment.authorName ?? 'Unknown'}: ${comment.body}`
    )
  ].filter(Boolean).join('\n');
}
