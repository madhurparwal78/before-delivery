import type { AnswerValue, EvalQuestion, FileAnswer, FileKind, StructureQuestion } from '../../../shared/types.ts';
import { M30, M31 } from '../../../shared/messages.ts';
import { ApiFailure, api, upload } from '../../lib/api.ts';
import { h } from '../../lib/dom.ts';
import { alertText } from '../../lib/live.ts';
import { asFile } from './answers.ts';
import type { Field, FieldEnv } from './field.ts';
import { createShell } from './shell.ts';

const MEDIA_TYPES: Record<FileKind, string> = { pdf: 'application/pdf', png: 'image/png', jpeg: 'image/jpeg' };
const BYTES_PER_KB = 1024;
const BYTES_PER_MB = 1_048_576;
const STORAGE_REFUSALS = ['FILE_TYPE', 'FILE_TOO_LARGE', 'UPLOAD_FAILED'];

/** The size as a person reads it: whole kilobytes under a megabyte, else megabytes to one decimal. */
function sizeText(bytes: number): string {
  if (bytes < BYTES_PER_MB) return `${Math.max(1, Math.round(bytes / BYTES_PER_KB))} KB`;
  return `${(bytes / BYTES_PER_MB).toFixed(1)} MB`;
}

/** A file counts as attached only once storage has confirmed it: until then the status says it is uploading. */
export function fileField(item: EvalQuestion, spec: StructureQuestion, answer: AnswerValue | undefined, env: FieldEnv): Field {
  const shell = createShell(item, 'legend', 'group');
  const status = h('p', { id: `upload-${item.key}`, class: 'upload-status' });
  const picker = h('input', { type: 'file', hidden: true, tabindex: '-1', accept: (spec.accept ?? []).map((kind) => MEDIA_TYPES[kind]).join(',') });
  const choose = h('button', { type: 'button' }, 'Choose file');
  const remove = h('button', { type: 'button', class: 'plain' });
  const path = `/api/responses/${env.responseId}/files/${item.key}`;

  function showAttached(file: FileAnswer | null): void {
    status.removeAttribute('aria-busy');
    status.textContent = file ? M31(file.name, sizeText(file.size)) : '';
    remove.hidden = file === null;
    remove.textContent = file ? `Remove ${file.name}` : '';
  }

  function refused(error: unknown): void {
    if (!(error instanceof ApiFailure) || !STORAGE_REFUSALS.includes(error.code)) {
      env.refuse(error);
      return;
    }
    status.removeAttribute('aria-busy');
    status.textContent = error.message;
    remove.hidden = true;
    alertText(error.message);
  }

  function attach(file: File): void {
    status.textContent = M30(file.name);
    status.setAttribute('aria-busy', 'true');
    remove.hidden = true;
    shell.clearError();
    const work = upload<FileAnswer>(path, file).then(showAttached, refused);
    env.track(work);
  }

  picker.addEventListener('change', () => {
    const file = picker.files?.[0];
    picker.value = '';
    if (file) attach(file);
  });
  choose.addEventListener('click', () => picker.click());
  remove.addEventListener('click', () => {
    env.track(api('DELETE', path).then(() => showAttached(null), env.refuse));
    choose.focus();
  });

  showAttached(asFile(answer));
  shell.root.append(h('div', { class: 'file-row' }, choose, picker), status, remove);
  shell.relabel(item.label, item.help);
  return {
    key: item.key,
    element: shell.root,
    update: (next) => shell.relabel(next.label, next.help),
    showError: shell.showError,
    clearError: shell.clearError,
    focusTarget: () => choose,
  };
}
