const BASE_URL = 'https://api.clickup.com/api/v2';

export interface ClickUpNamedResource { id: string; name: string }
export interface ClickUpList extends ClickUpNamedResource { folder?: ClickUpNamedResource; space?: ClickUpNamedResource }
export interface ClickUpFolder extends ClickUpNamedResource { lists?: ClickUpList[] }
export interface ClickUpSpace extends ClickUpNamedResource {}
export interface ClickUpTeam extends ClickUpNamedResource {}

export class ClickUpApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
    public readonly retryAfter?: string
  ) {
    super(message);
    this.name = 'ClickUpApiError';
  }
}

const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function getToken(): string {
  const value = process.env.CLICKUP_API_TOKEN?.trim();
  if (!value) throw new Error('CLICKUP_API_TOKEN is not configured');
  return value;
}

function safeApiMessage(body: string, statusText: string): { message: string; code?: string } {
  try {
    const parsed = JSON.parse(body) as { err?: unknown; error?: unknown; message?: unknown; ECODE?: unknown };
    const value = parsed.err ?? parsed.error ?? parsed.message;
    return {
      message: typeof value === 'string' ? value : statusText || 'Unknown ClickUp API error',
      code: typeof parsed.ECODE === 'string' ? parsed.ECODE : undefined
    };
  } catch {
    return { message: statusText || 'Unknown ClickUp API error' };
  }
}

export async function clickup<T>(path: string, init?: RequestInit, attempt = 0): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: {
        Authorization: getToken(),
        'Content-Type': 'application/json',
        ...(init?.headers ?? {})
      },
      cache: 'no-store'
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Unknown network error';
    throw new Error(`Unable to reach ClickUp API: ${detail}`, { cause: error });
  }

  if (!response.ok) {
    const details = safeApiMessage(await response.text(), response.statusText);
    const retryAfter = response.headers.get('retry-after') ?? undefined;
    if ((response.status === 429 || response.status >= 500) && attempt < 4) {
      const retryAfterMs = retryAfter ? Number(retryAfter) * 1000 : 1000 * (2 ** attempt);
      await delay(Number.isFinite(retryAfterMs) ? Math.max(retryAfterMs, 500) : 1000 * (2 ** attempt));
      return clickup<T>(path, init, attempt + 1);
    }
    throw new ClickUpApiError(response.status, details.message, details.code, retryAfter);
  }
  return response.json() as Promise<T>;
}

export const getTeams = () => clickup<{ teams: ClickUpTeam[] }>('/team');
export const getSpaces = (teamId: string) => clickup<{ spaces: ClickUpSpace[] }>(`/team/${teamId}/space?archived=false`);
export const getFolders = (spaceId: string) => clickup<{ folders: ClickUpFolder[] }>(`/space/${spaceId}/folder?archived=false`);
export const getFolderlessLists = (spaceId: string) => clickup<{ lists: ClickUpList[] }>(`/space/${spaceId}/list?archived=false`);
export const getFolderLists = (folderId: string) => clickup<{ lists: ClickUpList[] }>(`/folder/${folderId}/list?archived=false`);
export const getList = (listId: string) => clickup<ClickUpList>(`/list/${listId}`);
export const getTasks = (listId: string, page = 0) => clickup<{ tasks: any[] }>(`/list/${listId}/task?archived=false&include_closed=true&subtasks=true&page=${page}`);
export const getTask = (taskId: string) => clickup<any>(`/task/${taskId}`);
export const getTaskComments = (taskId: string, cursor?: { start: string; startId: string }) => {
  const query = cursor ? `?start=${encodeURIComponent(cursor.start)}&start_id=${encodeURIComponent(cursor.startId)}` : '';
  return clickup<{ comments: any[] }>(`/task/${taskId}/comment${query}`);
};

export const getCommentReplies = (commentId: string) =>
  clickup<{ comments: any[] }>(`/comment/${encodeURIComponent(commentId)}/reply`);
