import { timecode as tc, oneSecond } from '../shared/frames';
import { UI_TEXT, ACTIVITY_TEXT, fill } from '../shared/errors';
import type { Project, Clip, Row, Caption, Comment, ExportRecord, Allowance, Media, Person } from '../shared/types';

/** Small browser helpers: DOM, copy, upload chunks and the SHA-256 hash. */

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string | null> | undefined | null = null, ...children: (Node | string | null | undefined)[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (attrs != null) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === null) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'html') node.innerHTML = value;
      else node.setAttribute(key, value);
    }
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function region(label: string): HTMLElement {
  return el('section', { role: 'region', 'aria-label': label });
}

export function statusRegion(label: string, hidden: boolean): HTMLElement {
  const node = el('div', { role: 'status', 'aria-label': label, id: idFor(label) });
  node.className = hidden ? 'visually-hidden' : 'notices';
  return node;
}

export function idFor(label: string): string {
  return `status-${label.toLowerCase().replace(/\s+/g, '-')}`;
}

export function findStatus(label: string): HTMLElement | null {
  return document.getElementById(idFor(label));
}

export function announce(label: string, message: string): void {
  const node = findStatus(label);
  if (node === null) return;
  node.textContent = '';
  node.append(el('span', { text: message }));
}

export const copy = {
  signingIn: () => fill(UI_TEXT.signingIn, {}),
  upload: (file: string, percent: number) => fill(UI_TEXT.uploading, { file, percent }),
  uploadResume: (file: string, percent: number) => fill(UI_TEXT.uploadAfterReload, { file, percent }),
  inLibrary: (file: string) => fill(UI_TEXT.inLibrary, { file }),
  alreadyInLibrary: (file: string, existing: string) => fill(UI_TEXT.alreadyInLibrary, { file, existing }),
  stopped: (tcValue: string, reason: string) => fill(UI_TEXT.stopped, { timecode: tcValue, reason }),
  savingCut: () => UI_TEXT.savingCut,
  cutSaved: (name: string) => fill(UI_TEXT.cutSaved, { name }),
  restoring: () => UI_TEXT.restoring,
  cutRestored: (name: string) => fill(UI_TEXT.cutRestored, { name }),
  changingFrame: () => UI_TEXT.changingFrame,
  frameChanged: (ratio: string) => fill(UI_TEXT.frameChanged, { ratio }),
  makingLink: () => UI_TEXT.makingLink,
  linkReady: (until: string) => fill(UI_TEXT.linkReady, { until }),
  turningOffLink: () => UI_TEXT.turningOffLink,
  linkOff: () => UI_TEXT.linkOff,
  pinning: () => UI_TEXT.pinning,
  notePinned: (tcValue: string) => fill(UI_TEXT.notePinned, { timecode: tcValue }),
  approving: () => UI_TEXT.approving,
  cutApproved: (name: string) => fill(UI_TEXT.cutApproved, { name }),
  startingExport: () => UI_TEXT.startingExport,
  exportQueued: (cut: string, size: number | string) => fill(UI_TEXT.exportQueued, { cut, size }),
  cancelling: () => UI_TEXT.cancelling,
  exportCancelled: () => UI_TEXT.exportCancelled,
  readingSrt: (file: string) => fill(UI_TEXT.readingSrt, { file }),
  captionsImported: (n: number, row: string) => fill(UI_TEXT.captionsImported, { n, row }),
  makingToken: () => UI_TEXT.makingToken,
  tokenMade: () => UI_TEXT.tokenMade,
  sending: () => UI_TEXT.sending,
  commentSent: () => UI_TEXT.commentSent,
  roleChanged: (project: string, role: string) => fill(UI_TEXT.roleChanged, { project, role }),
  removedFromProject: (project: string) => fill(UI_TEXT.removedFromProject, { project }),
  signedOut: () => UI_TEXT.signedOut,
};

export const activity = {
  move: (name: string, clip: string, frame: number, rate: string) => fill(ACTIVITY_TEXT.move, { name, clip, timecode: tc(frame, rate) }),
  trim: (name: string, clip: string) => fill(ACTIVITY_TEXT.trim, { name, clip }),
  split: (name: string, clip: string, frame: number, rate: string) => fill(ACTIVITY_TEXT.split, { name, clip, timecode: tc(frame, rate) }),
  remove: (name: string, clip: string) => fill(ACTIVITY_TEXT.remove, { name, clip }),
  hide: (name: string, clip: string) => fill(ACTIVITY_TEXT.hide, { name, clip }),
  show: (name: string, clip: string) => fill(ACTIVITY_TEXT.show, { name, clip }),
  shape: (name: string, clip: string) => fill(ACTIVITY_TEXT.shape, { name, clip }),
  restore: (name: string, cut: string) => fill(ACTIVITY_TEXT.restore, { name, cut }),
  frame: (name: string, ratio: string) => fill(ACTIVITY_TEXT.frame, { name, ratio }),
  edit: (name: string) => fill(ACTIVITY_TEXT.edit, { name }),
  note: (name: string, frame: number, rate: string) => fill(ACTIVITY_TEXT.note, { name, timecode: tc(frame, rate) }),
  exportDone: (cut: string, size: number) => fill(ACTIVITY_TEXT.exportDone, { cut, size }),
  exportFailed: (cut: string, size: number) => fill(ACTIVITY_TEXT.exportFailed, { cut, size }),
  exportCancelled: (cut: string, size: number) => fill(ACTIVITY_TEXT.exportCancelled, { cut, size }),
  allowance: (allowance: Allowance) => fill(ACTIVITY_TEXT.allowance, { allowance: allowance.text }),
  cutShared: (cut: string) => fill(ACTIVITY_TEXT.cutShared, { cut }),
};

export function activityFor(author: string, kind: string, op: Record<string, unknown>, rate: string): string {
  switch (kind) {
    case 'move': return activity.move(author, String(op.clip ?? ''), Number(op.frame ?? 0), rate);
    case 'trim': return activity.trim(author, String(op.clip ?? ''));
    case 'split': return activity.split(author, String(op.clip ?? ''), Number(op.frame ?? 0), rate);
    case 'remove': return activity.remove(author, String(op.clip ?? ''));
    case 'hide': return activity.hide(author, String(op.clip ?? ''));
    case 'show': return activity.show(author, String(op.clip ?? ''));
    case 'shape': return activity.shape(author, String(op.clip ?? ''));
    case 'restore': return activity.restore(author, String(op.cut ?? ''));
    case 'frame': return activity.frame(author, String(op.ratio ?? ''));
    case 'note': return activity.note(author, Number(op.frame ?? 0), rate);
    default: return activity.edit(author);
  }
}

export function timecode(frame: number, rate: string): string {
  return tc(frame, rate);
}

export { oneSecond };

/** SHA-256 of a File, computed in the browser. */
export async function sha256Hex(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function chunkSize(): number {
  return 5242880;
}

export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function formatLocalDate(date: string): string {
  return new Date(date).toLocaleString();
}

export function checksumColour(sha256: string): string {
  return `#${sha256.slice(0, 6)}`;
}

export interface ProjectView {
  project: Project;
  rows: Row[];
  clips: Clip[];
  captions: Caption[];
  members: { person: Person; role: string }[];
}

export function layoutMode(width: number): 'review-list' | 'two-pane' | 'editor' {
  if (width < 700) return 'review-list';
  if (width < 1100) return 'two-pane';
  return 'editor';
}
