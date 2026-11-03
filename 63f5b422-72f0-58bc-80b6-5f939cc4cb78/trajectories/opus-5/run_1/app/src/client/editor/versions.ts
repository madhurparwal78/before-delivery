import { notices } from '../../shared/notices.js';
import type { PlinthDocument } from '../../shared/types.js';
import { api } from '../net.js';
import {
  reloadDocument,
  render,
  sayWithToast,
  state,
  syncUrl,
  type VersionSummary,
} from './store.js';

interface VersionDetail extends VersionSummary {
  document: PlinthDocument;
}

export function versionLine(version: VersionSummary): string {
  const at = new Date(version.createdAt);
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  const stamp =
    `${at.getUTCDate()} ${months[at.getUTCMonth()]} ${at.getUTCFullYear()}, ` +
    `${String(at.getUTCHours()).padStart(2, '0')}:${String(at.getUTCMinutes()).padStart(2, '0')} UTC`;
  return `${version.name} · ${version.author.name} · ${stamp}`;
}

export async function loadVersions(): Promise<void> {
  const result = await api.get<{ versions: VersionSummary[] }>(
    `/api/workspaces/${state.workspaceId}/versions`,
  );
  state.versions = result.versions;
  render();
}

export async function saveVersion(name: string | undefined): Promise<void> {
  const created = await api.post<VersionSummary>(
    `/api/workspaces/${state.workspaceId}/versions`,
    name === undefined || name === '' ? {} : { name },
  );
  await loadVersions();
  sayWithToast(notices.versionSaved(created.name));
}

export async function openPreview(versionId: string): Promise<void> {
  const version = await api.get<VersionDetail>(`/api/versions/${versionId}`);
  state.previewDoc = version.document;
  state.previewVersion = {
    id: version.id,
    name: version.name,
    author: version.author,
    createdAt: version.createdAt,
    seq: version.seq,
  };
  if (!version.document.pages.some((page) => page.id === state.pageId)) {
    state.pageId = version.document.pages[0]?.id ?? state.pageId;
  }
  state.selectedId = null;
  const url = new URL(window.location.href);
  url.searchParams.set('version', version.id);
  url.searchParams.set('page', state.pageId);
  window.history.pushState({}, '', `${url.pathname}${url.search}`);
  render();
}

export function backToLatest(): void {
  const wasPreviewing = state.previewVersion !== null;
  state.previewDoc = null;
  state.previewVersion = null;
  if (!state.doc.pages.some((page) => page.id === state.pageId)) {
    state.pageId = state.doc.pages[0]?.id ?? '';
  }
  if (wasPreviewing) {
    const url = new URL(window.location.href);
    url.searchParams.delete('version');
    window.history.pushState({}, '', `${url.pathname}${url.search}`);
  } else {
    syncUrl();
  }
  render();
}

/** Keeps the preview address working through Back and Forward. */
export async function applyUrlVersion(): Promise<void> {
  const wanted = new URL(window.location.href).searchParams.get('version');
  if (wanted === null) {
    if (state.previewVersion !== null) {
      state.previewDoc = null;
      state.previewVersion = null;
      render();
    }
    return;
  }
  if (state.previewVersion?.id === wanted) return;
  await openPreview(wanted);
}

export async function restoreVersion(versionId: string): Promise<void> {
  const version = state.versions.find((item) => item.id === versionId);
  state.busy.restore = true;
  render();
  sayWithToast(notices.restoreProgress(version?.name ?? ''));
  try {
    await api.post(`/api/versions/${versionId}/restore`);
    await reloadDocument();
    await loadVersions();
    backToLatest();
  } finally {
    state.busy.restore = false;
    render();
  }
}
