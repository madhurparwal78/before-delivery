import { notices } from '../../shared/notices.js';
import { api, postPublish, RequestFailed } from '../net.js';
import { currentPage, render, sayWithToast, state, syncUrl, type PublishInfo } from './store.js';

function pageName(): string {
  return currentPage()?.name ?? '';
}

export async function loadPublish(): Promise<void> {
  const page = currentPage();
  if (!page) return;
  state.publish = await api.get<PublishInfo>(`/api/pages/${page.id}/publish`);
  render();
}

export async function checkStorage(): Promise<void> {
  const result = await api.get<{ status: string }>(
    `/api/workspaces/${state.workspaceId}/storage`,
  );
  state.storageDown = result.status !== 'ok';
  render();
}

export async function publishNow(): Promise<void> {
  const page = currentPage();
  if (!page || state.busy.publish) return;
  state.busy.publish = true;
  state.panel = 'publish';
  syncUrl();
  render();
  sayWithToast(notices.publishProgress(page.name));
  const key = `${page.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    const status = await postPublish<PublishInfo>(`/api/pages/${page.id}/publish`, key);
    state.publish = status;
    state.publishFailed = false;
    state.storageDown = false;
    sayWithToast(notices.publishSuccess(page.name, status.url ?? ''));
  } catch (error) {
    state.publishFailed = true;
    if (error instanceof RequestFailed && error.failure.code === 'storage_unavailable') {
      state.storageDown = true;
    }
    sayWithToast(notices.publishFailed(page.name));
  } finally {
    state.busy.publish = false;
    render();
    document.getElementById('publish-state')?.focus();
  }
}

export async function unpublish(): Promise<void> {
  const page = currentPage();
  if (!page) return;
  try {
    state.publish = await api.post<PublishInfo>(`/api/pages/${page.id}/unpublish`);
    sayWithToast(notices.unpublished(pageName()));
  } catch (error) {
    if (error instanceof RequestFailed) sayWithToast(error.failure.message);
  }
  render();
}
