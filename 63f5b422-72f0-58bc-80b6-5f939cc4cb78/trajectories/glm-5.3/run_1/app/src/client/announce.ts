// The announcer: the only live region for notices, plus the visual toast.
let count = 0;

export function announce(text: string, opts: { toast?: boolean } = { toast: true }): void {
  const announcer = document.getElementById('announcer');
  if (announcer) {
    count++;
    announcer.setAttribute('data-announcement-count', String(count));
    const p = document.createElement('p');
    p.textContent = text;
    announcer.replaceChildren(p);
  }
  if (opts.toast !== false) showToast(text);
}

export function announceSilent(text: string): void {
  announce(text, { toast: false });
}

let toastTimer: number | undefined;

export function showToast(text: string): void {
  const toast = document.querySelector<HTMLElement>('[data-toast]');
  if (!toast) return;
  toast.textContent = text;
  toast.hidden = false;
  if (toastTimer !== undefined) clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { toast.hidden = true; }, 4000);
}

// ---- notices with exact text ---------------------------------------------

export const notices = {
  inserted: (name: string) => `Added ${name}.`,
  moved: (name: string, n: number, total: number, parentName: string) => `Moved ${name} to position ${n} of ${total} in ${parentName}.`,
  refusedMove: (name: string) => `Can't move ${name} there.`,
  deleted: (name: string) => `Deleted ${name}.`,
  cascade: (property: string, bpLabel: string, inherited: string, kept: string) =>
    `${property} changed on ${bpLabel}. Inherited by ${inherited}. Kept override on ${kept}.`,
  overrideCleared: (property: string, bpLabel: string, value: string) => `${property} on ${bpLabel} now inherits ${value}.`,
  token: (name: string, value: string, uses: number) => `Token ${name} is now ${value}. ${uses} uses updated.`,
  tokenInUse: (name: string, uses: number) => `Can't delete ${name}: it is used ${uses} times.`,
  sharedEdit: (n: number, componentName: string) => `Updated ${n} instances of ${componentName}.`,
  componentInUse: (componentName: string, n: number) => `Can't delete ${componentName}: ${n} instances still link to it.`,
  fieldInUse: (fieldName: string, n: number) => `Can't remove ${fieldName}: it is bound ${n} times.`,
  uploadProgress: (fileName: string) => `Uploading ${fileName}.`,
  uploadSuccess: (fileName: string) => `Uploaded ${fileName}.`,
  wrongType: () => 'Only PNG, JPEG or WebP images can be uploaded.',
  tooBig: () => 'That image is over 5,000,000 bytes.',
  uploadOutage: (fileName: string) => `Couldn't upload ${fileName}. File storage is unavailable.`,
  storageBanner: () => 'File storage is unavailable. Your edits are safe; uploads and publishing are paused.',
  publishProgress: (pageName: string) => `Publishing ${pageName}.`,
  publishSuccess: (pageName: string, url: string) => `Published ${pageName} at ${url}.`,
  publishFailed: (pageName: string) => `Couldn't publish ${pageName}. Nothing changed on the live page.`,
  unpublished: (pageName: string) => `Unpublished ${pageName}.`,
  joined: (name: string) => `${name} joined.`,
  conflict: (name: string, property: string, value: string) => `${name} set ${property} to ${value} at the same time. Their value was kept.`,
  deletedBy: (nodeName: string, name: string) => `${nodeName} was deleted by ${name}. Your change was not saved.`,
  roleChanged: (role: string) => `Your role is now ${role}.`,
  roleRefused: () => `You're now a viewer. Your last change was not saved.`,
  cantUndo: (name: string, nodeName: string) => `Can't undo: ${name} changed ${nodeName} after you.`,
  nothingToUndo: () => 'Nothing to undo.',
  nothingToRedo: () => 'Nothing to redo.',
  versionSaved: (name: string) => `Saved ${name}.`,
  restoreProgress: (name: string) => `Restoring ${name}.`,
  restored: (name: string, versionName: string) => `${name} restored ${versionName}.`,
  commentPosted: (nodeName: string) => `Comment posted on ${nodeName}.`,
  mentionMailFailed: (email: string) => `Couldn't email ${email}.`,
  inviteSent: (email: string) => `Invitation sent to ${email}.`,
  inviteFailed: () => `Couldn't send the invitation. Try again in a moment.`,
  altRequired: () => 'Alt text is required.',
};

export const publishStateText: Record<string, string> = {
  not_published: 'Not published',
  live: 'Live',
  live_changed: 'Live, with unpublished changes',
  unpublished: 'Unpublished',
};
