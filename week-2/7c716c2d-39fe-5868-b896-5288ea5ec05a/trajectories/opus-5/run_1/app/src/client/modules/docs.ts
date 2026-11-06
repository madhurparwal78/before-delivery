import { api, ApiCallError } from '../api.js';
import { copy } from '../copy.js';
import { clear, el, openDialog, setText } from '../dom.js';
import { dateOfInstant, formatDate } from '../format.js';
import { type Route } from '../router.js';
import {
  focusDetailTitle,
  notFoundSheet,
  titleBlock,
  type ModuleContext,
  type ModuleHandle,
} from '../shell.js';
import { onStreamEvent } from '../stream.js';
import { isGuest, nameOf, state, subscribe } from '../store.js';
import { attachmentsPanel } from '../uploads.js';
import type { Doc, DocSummary, DocVersion } from '../../shared/types.js';

type DraftRecord = { docId: string; personId: string; title: string; body: string; baseVersion: number };

const DRAFT_KEY = 'tr_doc_draft';

type DraftSource = () => DraftRecord | null;

let draftSource: DraftSource = () => null;

/** An unsaved doc edit outlives a lost session for the same person on that tab. */
export const docDraft = {
  keepForSignIn(): string | null {
    const draft = draftSource();
    if (draft === null) return null;
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    return `/docs/${draft.docId}`;
  },
  discard(): void {
    sessionStorage.removeItem(DRAFT_KEY);
  },
};

function storedDraft(): DraftRecord | null {
  const raw = sessionStorage.getItem(DRAFT_KEY);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as DraftRecord;
  } catch {
    return null;
  }
}

/** Lines the person did not touch keep their original ending. */
export function mergeLineEndings(original: string, edited: string): string {
  if (edited === original.replace(/\r\n|\r/g, '\n')) return original;
  const originalLines = [...original.matchAll(/([^\r\n]*)(\r\n|\r|\n|$)/g)]
    .filter((match, index, all) => index < all.length - 1 || match[0] !== '')
    .map((match) => ({ text: match[1] ?? '', ending: match[2] ?? '' }));
  const editedLines = edited.split('\n');
  return editedLines
    .map((line, index) => {
      const source = originalLines[index];
      const last = index === editedLines.length - 1;
      if (last) return line;
      if (source !== undefined && source.text === line && source.ending !== '') return line + source.ending;
      return `${line}\n`;
    })
    .join('');
}

export function docsModule(context: ModuleContext): ModuleHandle {
  let docs: DocSummary[] = [];
  let open: Doc | null = null;
  let openId: string | null = null;
  let notFound = false;
  let loadedBody = '';
  let loadedTitle = '';
  let baseVersion = 0;
  let editing = false;
  let wantFocus = false;

  const listRows = el('div', { class: 'rows docs-list' });
  const markEditing = (): void => {
    editing = true;
  };
  context.list.append(listRows);

  const sheet = el('div', { class: 'sheet doc-sheet' });
  context.detail.append(sheet);

  const titleField = el('input', { type: 'text', class: 'doc-title' });
  titleField.setAttribute('aria-label', 'Doc title');
  const bodyField = el('textarea', { class: 'doc-body', rows: '18' });
  bodyField.setAttribute('aria-label', 'Doc body');
  titleField.addEventListener('input', markEditing);
  bodyField.addEventListener('input', markEditing);
  const status = el('p', { class: 'doc-status', role: 'status', 'aria-live': 'polite', 'aria-label': 'Doc status' });
  const saveButton = el('button', { type: 'button', text: 'Save doc' });
  const historyButton = el('button', { type: 'button', text: 'Version history' });

  draftSource = () => {
    if (open === null || state.person === null) return null;
    if (!dirty()) return null;
    return {
      docId: open.id,
      personId: state.person.id,
      title: titleField.value,
      body: bodyField.value,
      baseVersion,
    };
  };

  function dirty(): boolean {
    if (open === null || !editing) return false;
    return titleField.value !== loadedTitle || bodyField.value !== loadedBody.replace(/\r\n|\r/g, '\n');
  }

  function loadFields(doc: Doc): void {
    editing = false;
    titleField.value = doc.title;
    bodyField.value = doc.body;
  }

  function renderList(): void {
    clear(listRows);
    for (const doc of docs) {
      const row = el('a', { href: `/docs/${doc.id}`, class: 'row doc-row' }, [
        el('span', { class: 'cell title', text: doc.title }),
        el('span', { class: 'cell mono', text: `v${doc.version}` }),
      ]);
      if (doc.id === openId) row.setAttribute('aria-current', 'true');
      listRows.append(row);
    }
  }

  async function loadList(): Promise<void> {
    const result = await api<{ docs: DocSummary[] }>('GET', '/api/docs').catch(() => null);
    if (result === null) return;
    docs = result.docs;
    renderList();
  }

  async function loadDoc(id: string): Promise<void> {
    try {
      const doc = await api<Doc>('GET', `/api/docs/${id}`);
      open = doc;
      notFound = false;
      loadedTitle = doc.title;
      loadedBody = doc.body;
      baseVersion = doc.version;
      loadFields(doc);
      renderSheet();
      restoreDraft();
    } catch (error) {
      if (error instanceof ApiCallError && error.code === 'not_found') {
        notFound = true;
        open = null;
        renderSheet();
      }
    }
  }

  function restoreDraft(): void {
    const draft = storedDraft();
    if (draft === null || open === null) return;
    if (draft.docId !== open.id) return;
    if (draft.personId !== state.person?.id) {
      docDraft.discard();
      return;
    }
    titleField.value = draft.title;
    bodyField.value = draft.body;
    editing = true;
    baseVersion = draft.baseVersion;
    setText(status, copy.docDraftRestored);
    docDraft.discard();
  }

  function renderSheet(): void {
    clear(sheet);
    if (notFound) {
      sheet.append(notFoundSheet());
      return;
    }
    const doc = open;
    if (doc === null) {
      sheet.append(el('p', { class: 'empty', 'data-detail-title': 'true', text: 'Choose a doc.' }));
      return;
    }
    if (!editing) {
      titleField.value = doc.title;
      bodyField.value = doc.body;
    }
    titleField.readOnly = isGuest();
    bodyField.readOnly = isGuest();
    sheet.append(
      titleBlock(doc.title, `Version ${doc.version}`, formatDate(dateOfInstant(doc.updated_at))),
      el('h1', { class: 'display', 'data-detail-title': 'true', text: doc.title }),
      el('p', { class: 'doc-meta mono', text: `Version ${doc.version} by ${nameOf(doc.updated_by)}` }),
      titleField,
      bodyField,
      status,
    );
    if (!isGuest()) sheet.append(el('div', { class: 'doc-actions' }, [saveButton, historyButton]));
    sheet.append(
      attachmentsPanel({
        parentPath: `/api/docs/${doc.id}/attachments`,
        attachments: doc.attachments,
        onAttached: (attachment) => {
          doc.attachments = [...doc.attachments, attachment];
        },
      }),
    );
    if (wantFocus) {
      wantFocus = false;
      focusDetailTitle();
    }
  }

  async function save(bodyToSend?: string, base?: number): Promise<void> {
    const doc = open;
    if (doc === null) return;
    setText(status, copy.saving);
    const body = bodyToSend ?? mergeLineEndings(loadedBody, bodyField.value);
    try {
      const saved = await api<Doc>('PUT', `/api/docs/${doc.id}`, {
        body: { title: titleField.value, body, base_version: base ?? baseVersion },
      });
      open = saved;
      loadedTitle = saved.title;
      loadedBody = saved.body;
      baseVersion = saved.version;
      loadFields(saved);
      docDraft.discard();
      renderSheet();
      setText(status, copy.docSaved(saved.version));
      void loadList();
    } catch (error) {
      if (!(error instanceof ApiCallError)) return;
      if (error.code === 'version_conflict') {
        const current = error.body.current as Doc | undefined;
        if (current === undefined) return;
        setText(status, copy.docConflict(nameOf(current.updated_by), current.version));
        openConflictDialog(current, body);
        return;
      }
      if (error.code === 'validation') {
        if (error.fields.title !== undefined) setText(status, error.fields.title);
        else if (error.fields.body !== undefined) setText(status, copy.docBodyLength);
        return;
      }
      setText(status, '');
    }
  }

  function openConflictDialog(current: Doc, mine: string): void {
    openDialog({
      name: 'Newer version saved',
      build: (body, dialog) => {
        const keep = el('button', { type: 'button', text: 'Keep mine' });
        const theirs = el('button', { type: 'button', text: 'Load theirs' });
        keep.addEventListener('click', () => {
          dialog.close();
          void save(mine, current.version);
        });
        theirs.addEventListener('click', () => {
          dialog.close();
          open = current;
          loadedTitle = current.title;
          loadedBody = current.body;
          baseVersion = current.version;
          loadFields(current);
          docDraft.discard();
          renderSheet();
          setText(status, copy.docLoadedTheirs(current.version, nameOf(current.updated_by)));
        });
        body.append(
          el('h2', { class: 'display', text: 'Newer version saved' }),
          el('p', { text: copy.docConflict(nameOf(current.updated_by), current.version) }),
          keep,
          theirs,
        );
      },
    });
  }

  saveButton.addEventListener('click', () => {
    void save();
  });

  historyButton.addEventListener('click', () => {
    const doc = open;
    if (doc === null) return;
    void api<{ versions: DocVersion[] }>('GET', `/api/docs/${doc.id}/versions`).then((result) => {
      openDialog({
        name: 'Version history',
        build: (body, dialog) => {
          body.append(el('h2', { class: 'display', text: 'Version history' }));
          for (const version of result.versions.filter((entry) => entry.version < doc.version)) {
            const restore = el('button', {
              type: 'button',
              text: `Restore version ${version.version}`,
            });
            restore.addEventListener('click', () => {
              dialog.close();
              setText(status, copy.saving);
              void api<Doc>('POST', `/api/docs/${doc.id}/restore`, {
                body: { version: version.version, base_version: baseVersion },
              })
                .then((saved) => {
                  open = saved;
                  loadedTitle = saved.title;
                  loadedBody = saved.body;
                  baseVersion = saved.version;
                  loadFields(saved);
                  renderSheet();
                  setText(status, copy.docRestored(version.version, saved.version));
                  void loadList();
                })
                .catch((error: unknown) => {
                  if (error instanceof ApiCallError && error.code === 'version_conflict') {
                    const current = error.body.current as Doc | undefined;
                    if (current === undefined) return;
                    setText(status, copy.docConflict(nameOf(current.updated_by), current.version));
                    openConflictDialog(current, mergeLineEndings(loadedBody, bodyField.value));
                  }
                });
            });
            body.append(
              el('div', { class: 'version-row' }, [
                el('span', { class: 'mono', text: `v${version.version}` }),
                restore,
              ]),
            );
          }
        },
      });
    });
  });

  const unsubscribeStore = subscribe((keys) => {
    if (keys.has('projects')) void loadList();
  });

  const unsubscribeStream = onStreamEvent((event) => {
    if (event.name === 'reset') {
      void loadList();
      if (openId !== null) void loadDoc(openId);
      return;
    }
    if (event.name === 'revoked' && event.data.scope === 'project') {
      if (open !== null && open.project_id === event.data.id) {
        notFound = true;
        open = null;
        renderSheet();
      }
      void loadList();
      return;
    }
    if (event.name !== 'doc') return;
    void loadList();
    const id = String(event.data.id);
    if (id !== openId || open === null) return;
    if (dirty()) return;
    void loadDoc(id);
  });

  return {
    id: 'docs',
    firstPane: 'list',
    route(route: Route) {
      const wanted = route.segments.length > 2 ? 'unknown path' : route.segments[1] ?? null;
      if (wanted !== openId) {
        openId = wanted;
        open = null;
        notFound = false;
        editing = false;
        wantFocus = wanted !== null;
        titleField.value = '';
        bodyField.value = '';
        setText(status, '');
      }
      void loadList();
      renderSheet();
      if (openId !== null) {
        void loadDoc(openId);
        context.openDetail(null);
      }
    },
    destroy() {
      draftSource = () => null;
      unsubscribeStore();
      unsubscribeStream();
      clear(context.list);
      clear(context.detail);
    },
  };
}
