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
  extraEvidence: string[];
  dependencyTaskIds?: string[];
  coverage: EvidenceCoverage;
};

export type EvidenceCoverage = {
  checklistCount: number;
  checklistItems: number;
  customFields: number;
  attachments: number;
  linkedTasks: number;
  dependencies: number;
  missingAttachmentContents: number;
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
  rawPayload?: unknown;
  list: { name: string };
  assignees: Array<{ employee: { name: string } }>;
  comments: Array<{ id: number; authorName: string | null; body: string; clickupCreatedAt: Date | null }>;
};

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function arr(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function str(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}
function person(value: unknown): string {
  const o = obj(value);
  return str(o.username || o.name || o.email || o.id || value);
}
function valueText(field: Record<string, unknown>): string {
  const value = field.value;
  if (value == null) return '(unset)';
  const type = str(field.type);
  const config = obj(field.type_config);
  if (type === 'drop_down') {
    const option = arr(config.options).map(obj).find(x => str(x.id) === str(value));
    return str(option?.name || value);
  }
  if (type === 'labels' && Array.isArray(value)) {
    const options = arr(config.options).map(obj);
    return value.map(v => str(options.find(o => str(o.id) === str(v))?.label || v)).join(', ');
  }
  if (type === 'users') return arr(value).map(person).join(', ');
  return str(value);
}
export function dependencyTaskIds(rawValue: unknown, ownId?: string): string[] {
  const raw = obj(rawValue);
  const ids = new Set<string>();
  for (const entry of arr(raw.dependencies).map(obj)) {
    for (const value of [entry.task_id, entry.depends_on]) {
      if ((typeof value === 'string' || typeof value === 'number') && String(value) !== ownId) {
        ids.add(String(value));
      }
    }
  }
  return [...ids].sort();
}

export function rawEvidence(rawValue: unknown): { lines: string[]; coverage: EvidenceCoverage } {
  const raw = obj(rawValue);
  const lines: string[] = [];
  const checklists = arr(raw.checklists).map(obj);
  const customFields = arr(raw.custom_fields).map(obj);
  const attachments = arr(raw.attachments).map(obj);
  const linked = arr(raw.linked_tasks);
  const dependencies = arr(raw.dependencies);
  const coverage: EvidenceCoverage = {
    checklistCount: checklists.length,
    checklistItems: checklists.reduce((n, c) => n + arr(c.items).length, 0),
    customFields: customFields.length,
    attachments: attachments.length,
    linkedTasks: linked.length,
    dependencies: dependencies.length,
    missingAttachmentContents: attachments.length
  };
  if (raw.parent) lines.push('Parent ClickUp task ID: ' + str(raw.parent));
  if (raw.start_date) lines.push('Start date (ClickUp timestamp): ' + str(raw.start_date));
  if (raw.date_closed) lines.push('Closed date (ClickUp timestamp): ' + str(raw.date_closed));
  if (raw.time_estimate != null) lines.push('Estimated work time (milliseconds): ' + str(raw.time_estimate));
  if (raw.time_spent != null) lines.push('Tracked work time (milliseconds, as returned by ClickUp): ' + str(raw.time_spent));
  if (raw.creator) lines.push('Created by: ' + person(raw.creator));
  if (raw.watchers && arr(raw.watchers).length) lines.push('Watchers: ' + arr(raw.watchers).map(person).join(', '));
  if (checklists.length) {
    lines.push('CHECKLISTS (checkmarks represent ClickUp item resolution, not task approval):');
    for (const c of checklists) {
      lines.push('Checklist: ' + str(c.name || c.id));
      for (const itemValue of arr(c.items)) {
        const item = obj(itemValue);
        const done = item.resolved === true || item.resolved === 1;
        lines.push('  [' + (done ? 'x' : ' ') + '] ' + str(item.name || item.id) +
          (item.assignee ? ' — assigned to ' + person(item.assignee) : '') +
          (item.due_date ? ' — due ' + str(item.due_date) : ''));
      }
    }
  }
  if (customFields.length) {
    // Preserve all raw metadata in PostgreSQL. Only omit empty field values
    // from the model prompt; zero and false remain meaningful values.
    const populated = customFields.filter(field => {
      const value = field.value;
      return value != null && value !== '' &&
        (!Array.isArray(value) || value.length > 0) &&
        (typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 0);
    });
    lines.push('CUSTOM FIELDS (ClickUp task metadata; do not infer meaning from missing values):');
    for (const field of populated) {
      lines.push('  ' + str(field.name || field.id) + ' (' + str(field.type) + '): ' + valueText(field));
    }
    if (customFields.length > populated.length) {
      lines.push('  ' + (customFields.length - populated.length) + ' unset/empty custom field entries omitted from AI context (retained in database).');
    }
  }
  if (dependencies.length) lines.push('DEPENDENCIES: ' + dependencies.map(v => str(v)).join('; '));
  if (linked.length) lines.push('LINKED TASK REFERENCES: ' + linked.map(v => str(v)).join('; '));
  if (attachments.length) {
    lines.push('ATTACHMENT METADATA ONLY (file contents NOT available; do not claim to have read them):');
    for (const attachment of attachments) {
      lines.push('  ' + str(attachment.title || attachment.name || attachment.id) +
        (attachment.extension ? ' .' + str(attachment.extension) : '') +
        (attachment.size ? ' (' + str(attachment.size) + ' bytes)' : ''));
    }
  }
  if (raw.markdown_description && str(raw.markdown_description) !== str(raw.description)) {
    lines.push('Rich-text/Markdown description: ' + str(raw.markdown_description));
  }
  return { lines, coverage };
}

export function buildTaskContext(task: TaskRecord): TaskContext {
  const evidence = rawEvidence(task.rawPayload);
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
      .map(comment => ({
        id: comment.id,
        authorName: comment.authorName,
        body: comment.body,
        createdAt: comment.clickupCreatedAt
      })),
    extraEvidence: evidence.lines,
    dependencyTaskIds: dependencyTaskIds(task.rawPayload, task.clickupTaskId),
    coverage: evidence.coverage
  };
}

export function contextText(context: TaskContext): string {
  return [
    'ClickUp task ID: ' + context.clickupTaskId,
    'Task: ' + context.name,
    'List: ' + context.listName,
    'ClickUp status: ' + (context.status ?? 'unknown'),
    'Priority: ' + (context.priority ?? 'none'),
    'Assigned internal employees: ' + (context.assignees.join(', ') || 'none'),
    'Due date: ' + (context.dueDate?.toISOString() ?? 'none'),
    'Last ClickUp update: ' + (context.updatedAt?.toISOString() ?? 'unknown'),
    context.description ? 'Description: ' + context.description : '',
    ...context.extraEvidence,
    'CHRONOLOGICAL COMMENTS:',
    ...context.comments.map(comment =>
      '[' + (comment.createdAt?.toISOString() ?? 'unknown time') + '] ' + (comment.authorName ?? 'Unknown') + ': ' + comment.body
    )
  ].filter(Boolean).join('\n');
}
