import { notices } from '../../shared/notices.js';
import { RequestFailed, api } from '../net.js';
import { nodeById, render, sayWithToast, state, type Thread } from './store.js';

interface PostedThread extends Thread {
  mailFailed: string[];
}

export async function loadThreads(): Promise<void> {
  const result = await api.get<{ threads: Thread[] }>(
    `/api/workspaces/${state.workspaceId}/comments?pageId=${state.pageId}`,
  );
  state.threads = result.threads;
  render();
}

export function mergeThread(thread: Thread): void {
  const index = state.threads.findIndex((item) => item.id === thread.id);
  if (index === -1) state.threads = [...state.threads, thread];
  else state.threads[index] = thread;
}

export async function postComment(body: string): Promise<Thread | undefined> {
  const nodeId = state.selectedId;
  if (nodeId === null || body.trim() === '') return undefined;
  const thread = await api.post<PostedThread>(`/api/workspaces/${state.workspaceId}/comments`, {
    pageId: state.pageId,
    nodeId,
    body,
  });
  mergeThread(thread);
  render();
  sayWithToast(notices.commentPosted(nodeById(nodeId)?.name ?? thread.nodeName));
  for (const email of thread.mailFailed ?? []) sayWithToast(notices.mentionMailFailed(email));
  return thread;
}

export async function replyToThread(threadId: string, body: string): Promise<void> {
  if (body.trim() === '') return;
  const reply = await api.post<{ mailFailed: string[] }>(
    `/api/comments/${threadId}/replies`,
    { body },
  );
  await loadThreads();
  for (const email of reply.mailFailed ?? []) sayWithToast(notices.mentionMailFailed(email));
}

export async function setThreadStatus(threadId: string, resolved: boolean): Promise<void> {
  try {
    const thread = await api.post<Thread>(
      `/api/comments/${threadId}/${resolved ? 'resolve' : 'reopen'}`,
    );
    mergeThread(thread);
    render();
  } catch (error) {
    if (!(error instanceof RequestFailed)) throw error;
    sayWithToast(error.failure.message);
  }
}
