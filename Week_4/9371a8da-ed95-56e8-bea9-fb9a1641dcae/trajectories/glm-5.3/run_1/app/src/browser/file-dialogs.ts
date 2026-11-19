import { el } from './dom.js';
import * as api from './api.js';
import type { TextFile } from '../shared/types.js';
import { navigate, requestFocus, rerender } from './app-state.js';
import { projectUrl } from './router.js';
import { dialogFrame, fieldError, mentionState, updateMention, buildMentionList, mentionKeydown } from './dialogs.js';
import { isFailure, type ProjectHandle, type DialogState } from './actions.js';
import { storedOffset } from './layout.js';

/** Suggest edit dialog. */
export function suggestDialog(
  h: ProjectHandle, from: number, to: number, close: () => void,
): HTMLElement {
  const text = h.openFile?.content ?? '';
  const quoted = text.slice(from, to);
  let inserted = '';
  let error: string | undefined;
  return dialogFrame({ title: 'Suggest edit', close }, (body) => {
    body.appendChild(el('blockquote', { class: 'quote' }, quoted));
    const ta = el('textarea', {
      id: 'replacement', 'aria-label': 'Replacement text', rows: '3',
      oninput: (e: Event) => { inserted = (e.target as HTMLTextAreaElement).value; },
    }) as HTMLTextAreaElement;
    const field = el('div', { class: 'field' }, el('label', { for: 'replacement' }, 'Replacement text'), ta);
    const errBox = el('div', { id: 'suggest-error' });
    field.appendChild(errBox);
    body.appendChild(field);
    const actions = el('div', { class: 'actions-row' },
      el('button', {
        class: 'primary',
        onclick: async () => {
          error = undefined;
          if (inserted.length > 10_000) {
            error = 'This text contains a character that cannot be stored.';
            errBox.replaceChildren(fieldError(error) ?? el('span'));
            return;
          }
          if (from === to && inserted.length === 0) {
            error = 'Write a comment of 1 to 4,000 characters.';
            errBox.replaceChildren(fieldError(error) ?? el('span'));
            return;
          }
          h.message('Sending…');
          try {
            await api.postSuggestion(h.pid, (h.openFile as TextFile).id, h.lastLoadedRevision, from, to, inserted);
            h.lastActionSeq = Date.now();
            const review = await api.getReview(h.pid);
            h.suggestions = review.suggestions;
            h.threads = review.threads;
            h.message('Suggestion added');
            close();
            rerender();
          } catch (e) {
            h.lastActionSeq = Date.now();
            if (isFailure(e)) {
              if (e.shape.status === 412) {
                h.message('The passage changed; select it again');
              } else if (e.shape.status === 403) {
                const p = await api.getProject(h.pid);
                h.role = p.project.role;
                h.message(`You can no longer do that. Your role on this project is now ${p.project.role}.`);
                close();
                requestFocus('source-box');
              } else {
                h.message('Something went wrong. Try again.');
              }
            } else h.message('Something went wrong. Try again.');
            rerender();
          }
        },
      }, 'Add suggestion'));
    body.appendChild(actions);
    queueMicrotask(() => ta.focus());
  });
}

/** New comment dialog, with the mention list. */
export function commentDialog(
  h: ProjectHandle, from: number, to: number, close: () => void,
): HTMLElement {
  const text = h.openFile?.content ?? '';
  const quoted = text.slice(from, to);
  let bodyText = '';
  let error: string | undefined;
  const mention = mentionState();
  const members = h.members.map((m) => ({ id: m.user.id, handle: m.user.handle, displayName: m.user.displayName }));
  return dialogFrame({ title: 'New comment', close }, (body) => {
    body.appendChild(el('blockquote', { class: 'quote' }, quoted));
    const ta = el('textarea', {
      id: 'comment-body', 'aria-label': 'Comment', rows: '3',
      oninput: (e: Event) => {
        const t = e.target as HTMLTextAreaElement;
        bodyText = t.value;
        updateMention(mention, t.value, t.selectionStart ?? t.value.length, members);
        renderMention();
      },
      onkeydown: (e: Event) => {
        const kev = e as KeyboardEvent;
        if (mentionKeydown(kev, mention, ta, () => {})) {
          renderMention();
          if (kev.key === 'Escape' && !mention.open) {
            // Escape already closed the list; the dialog stays open.
          }
        }
      },
    }) as HTMLTextAreaElement;
    const field = el('div', { class: 'field' }, el('label', { for: 'comment-body' }, 'Comment'), ta);
    const mentionSlot = el('div', { id: 'mention-slot' });
    const errBox = el('div', { id: 'comment-error' });
    field.appendChild(errBox);
    body.appendChild(field);
    body.appendChild(mentionSlot);
    const actions = el('div', { class: 'actions-row' },
      el('button', {
        class: 'primary',
        onclick: async () => {
          error = undefined;
          if (bodyText.trim().length < 1 || bodyText.length > 4_000) {
            error = 'Write a comment of 1 to 4,000 characters.';
            errBox.replaceChildren(fieldError(error) ?? el('span'));
            return;
          }
          h.message('Sending…');
          try {
            await api.postThread(h.pid, (h.openFile as TextFile).id, h.lastLoadedRevision, from, to, bodyText);
            h.lastActionSeq = Date.now();
            const review = await api.getReview(h.pid);
            h.suggestions = review.suggestions;
            h.threads = review.threads;
            h.message('Comment posted');
            close();
            rerender();
          } catch (e) {
            h.lastActionSeq = Date.now();
            if (isFailure(e)) {
              if (e.shape.status === 412) h.message('The passage changed; select it again');
              else if (e.shape.status === 403) {
                const p = await api.getProject(h.pid);
                h.role = p.project.role;
                h.message(`You can no longer do that. Your role on this project is now ${p.project.role}.`);
                close();
                requestFocus('source-box');
              } else h.message('Something went wrong. Try again.');
            }
            rerender();
          }
        },
      }, 'Post comment'));
    body.appendChild(actions);
    function renderMention(): void {
      mentionSlot.replaceChildren();
      const list = buildMentionList(mention, ta);
      if (list) {
        ta.setAttribute('aria-activedescendant', list.querySelector('.highlighted')?.getAttribute('id') ?? '');
        ta.setAttribute('aria-controls', list.getAttribute('id') ?? '');
        mentionSlot.appendChild(list);
        positionMention(list, ta);
      } else {
        ta.removeAttribute('aria-activedescendant');
      }
    }
    queueMicrotask(() => ta.focus());
  });
}

function positionMention(list: HTMLElement, anchor: HTMLElement): void {
  const rect = anchor.getBoundingClientRect();
  list.style.left = `${rect.left}px`;
  const listHeight = 200;
  if (rect.bottom + listHeight > window.innerHeight) {
    list.style.bottom = `${window.innerHeight - rect.top + 4}px`;
  } else {
    list.style.top = `${rect.bottom + 4}px`;
  }
}

/** New file dialog. */
export function newFileDialog(h: ProjectHandle, close: () => void): HTMLElement {
  let path = '';
  let error: string | undefined;
  return dialogFrame({ title: 'New file', close }, (body) => {
    const input = el('input', {
      type: 'text', id: 'new-file-path', 'aria-label': 'File path',
      oninput: (e: Event) => { path = (e.target as HTMLInputElement).value; },
    }) as HTMLInputElement;
    const field = el('div', { class: 'field' }, el('label', { for: 'new-file-path' }, 'File path'), input);
    const errBox = el('div', { id: 'nf-error' });
    field.appendChild(errBox);
    body.appendChild(field);
    body.appendChild(el('div', { class: 'actions-row' },
      el('button', {
        class: 'primary',
        onclick: async () => {
          error = undefined;
          try {
            const res = await api.postFile(h.pid, path, '');
            h.lastActionSeq = Date.now();
            h.files = await (await api.getProject(h.pid)).files;
            h.message(`Created ${path}`);
            close();
            navigate(projectUrl(h.pid, { file: res.file.path }));
            requestFocus('source-box');
          } catch (e) {
            h.lastActionSeq = Date.now();
            if (isFailure(e)) {
              if (e.shape.status === 409) error = `${path} already exists`;
              else if (e.shape.status === 422) error = 'Use letters, digits, dots, hyphens and underscores, separated by slashes.';
              else { h.message('Something went wrong. Try again.'); }
            }
            errBox.replaceChildren(fieldError(error) ?? el('span'));
            if (error) input.focus();
          }
        },
      }, 'Create file')));
    queueMicrotask(() => input.focus());
  });
}

/** Upload file dialog: keeps its chosen file and folder after a refusal. */
export function uploadDialog(h: ProjectHandle, close: () => void): HTMLElement {
  return dialogFrame({ title: 'Upload file', close }, (body) => {
    const fileInput = el('input', { type: 'file', id: 'upload-file', 'aria-label': 'File' }) as HTMLInputElement;
    if (h.uploadFile) {
      const dt = new DataTransfer();
      dt.items.add(h.uploadFile);
      fileInput.files = dt.files;
    }
    fileInput.addEventListener('change', () => {
      const f = fileInput.files?.[0];
      if (f) h.uploadFile = f;
    });
    const folderInput = el('input', {
      type: 'text', id: 'upload-folder', 'aria-label': 'Folder', value: h.uploadFolder,
      oninput: (e: Event) => { h.uploadFolder = (e.target as HTMLInputElement).value; },
    }) as HTMLInputElement;
    const field1 = el('div', { class: 'field' }, el('label', { for: 'upload-file' }, 'File'), fileInput);
    const field2 = el('div', { class: 'field' }, el('label', { for: 'upload-folder' }, 'Folder'), folderInput);
    body.appendChild(field1);
    body.appendChild(field2);
    const errBox = el('div', { id: 'upload-error' });
    body.appendChild(errBox);
    const uploadBtn = el('button', {
      id: 'upload-submit',
      onclick: async () => {
        const file = h.uploadFile;
        if (!file) return;
        h.message(`Uploading ${file.name}…`);
        rerender();
        try {
          const res = await api.uploadAsset(h.pid, file, h.uploadFolder);
          h.lastActionSeq = Date.now();
          const proj = await api.getProject(h.pid);
          h.files = proj.files;
          h.message(`Uploaded ${res.file.path}`);
          h.uploadFile = null;
          h.storageMessage('');
          close();
          navigate(projectUrl(h.pid, { file: res.file.path }));
        } catch (e) {
          h.lastActionSeq = Date.now();
          if (isFailure(e)) {
            const name = file.name;
            if (e.shape.status === 413) h.message(`${name} is too large for its file type`);
            else if (e.shape.status === 415) h.message(`${name} is not an allowed file type`);
            else if (e.shape.status === 422 && e.shape.errors?.file) h.message(`${name} is not an allowed file name`);
            else if (e.shape.status === 422 && e.shape.errors?.folder) h.message('Use letters, digits, dots, hyphens and underscores, separated by slashes.');
            else if (e.shape.status === 409) {
              const target = h.uploadFolder ? `${h.uploadFolder}/${name}` : name;
              h.message(`${target} already exists`);
            }
            else if (e.shape.status === 503) h.storageMessage('Figure storage unavailable. Text editing still works; try again shortly.');
            else h.message('Something went wrong. Try again.');
          } else h.message('Something went wrong. Try again.');
          rerender();
          requestFocus('upload-submit');
        }
      },
    }, 'Upload');
    const cancel = el('button', {
      onclick: () => { close(); requestFocus(psUploadOpenerId()); },
    }, 'Cancel');
    body.appendChild(el('div', { class: 'actions-row' }, uploadBtn, cancel));
    queueMicrotask(() => fileInput.focus());
  });
}

function psUploadOpenerId(): string {
  return 'upload-file-btn';
}

/** Delete confirmation, opening on Cancel. */
export function deleteConfirm(h: ProjectHandle, fid: string, path: string, close: () => void): HTMLElement {
  return dialogFrame({ title: `Delete ${path}?`, close, alert: true }, (body) => {
    body.appendChild(el('p', {}, `This removes ${path} from the current files. Restoring an earlier label that holds it brings it back.`));
    const cancel = el('button', {
      onclick: () => { close(); requestFocus(`delete-${fid}`); },
    }, 'Cancel');
    const confirm = el('button', {
      class: 'primary',
      onclick: async () => {
        h.message(`Deleting ${path}…`);
        try {
          await api.deleteFile(h.pid, fid);
          h.lastActionSeq = Date.now();
          const proj = await api.getProject(h.pid);
          h.files = proj.files;
          h.message(`Deleted ${path}`);
          const main = h.files.find((f) => f.path === 'main.tex') ?? h.files[0];
          if (main) {
            await h.openFileByPath(main.path);
            navigate(projectUrl(h.pid, { file: main.path }));
          }
          close();
          rerender();
          requestFocus('source-box');
        } catch (e) {
          h.lastActionSeq = Date.now();
          void e;
          h.message('Something went wrong. Try again.');
          rerender();
        }
      },
    }, 'Delete');
    body.appendChild(el('div', { class: 'actions-row' }, cancel, confirm));
    queueMicrotask(() => cancel.focus());
  });
}

/** Stale save alert dialog with the unsaved text. */
export function staleDialog(h: ProjectHandle, current: TextFile, unsaved: string, close: () => void): HTMLElement {
  return dialogFrame({ title: 'Newer version on the server', close, alert: true }, (body) => {
    body.appendChild(el('p', {}, `Someone saved ${current.path} after you opened it. Your changes were not saved; copy them from below.`));
    const box = el('textarea', {
      id: 'unsaved-text', 'aria-label': 'Your unsaved text', readonly: 'readonly', rows: '8',
    }) as HTMLTextAreaElement;
    box.value = unsaved;
    body.appendChild(el('div', { class: 'field' }, el('label', { for: 'unsaved-text' }, 'Your unsaved text'), box));
    body.appendChild(el('div', { class: 'actions-row' },
      el('button', {
        class: 'primary',
        onclick: () => {
          h.openFile = { ...current };
          h.draft = current.content;
          h.lastLoadedRevision = current.revision;
          close();
          rerender();
        },
      }, 'Load latest')));
    queueMicrotask(() => box.focus());
  });
}
