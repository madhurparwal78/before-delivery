import { useEffect, useRef, useState } from 'react';
import { api, ApiFailure } from './api.js';
import { Dialog } from './components/Dialog.js';
import { MentionApi, MentionList, mentionActiveDescendant } from './components/Mentions.js';
import { copy } from './copy.js';
import { CitationReport, CitationWarning, ExportRecord, Readiness, TextFile } from './types.js';

export interface DialogContext {
  projectId: string;
  notify: (message: string) => void;
  storageNotice: (sequence: number) => void;
  clearStorage: (sequence: number) => void;
  nextStorageAction: () => number;
  afterAction: () => void;
  forbidden: () => void;
}

export function NewFileDialog(props: {
  context: DialogContext;
  onClose: () => void;
  returnFocusTo: () => HTMLElement | null;
  onCreated: (file: TextFile) => void;
}): JSX.Element {
  const [path, setPath] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const create = async (): Promise<void> => {
    setPending(true);
    setError(null);
    props.context.notify(copy.creatingFile(path));
    try {
      const answer = await api<{ file: TextFile }>(
        `/api/projects/${props.context.projectId}/files`,
        { method: 'POST', body: { path, content: '' } },
      );
      props.context.notify(copy.createdFile(path));
      props.context.afterAction();
      props.onCreated(answer.file);
      props.onClose();
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.code === 'path_taken') {
        props.context.notify(copy.pathTaken(path));
      } else if (failure instanceof ApiFailure && failure.status === 403) {
        props.context.forbidden();
        props.onClose();
        return;
      } else if (failure instanceof ApiFailure && failure.field('path') !== null) {
        setError(copy.fields.path);
        props.context.notify('');
      } else if (failure instanceof ApiFailure && failure.field('content') !== null) {
        setError(copy.fields.unstorable);
      } else {
        props.context.notify(copy.somethingWrong);
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog name="New file" onClose={props.onClose} returnFocusTo={props.returnFocusTo}>
      <h2>New file</h2>
      <label>
        <span className="field-label">File path</span>
        <input
          value={path}
          aria-describedby={error === null ? undefined : 'new-file-error'}
          onChange={(event) => setPath(event.target.value)}
        />
      </label>
      {error === null ? null : (
        <p className="field-error" id="new-file-error">
          {error}
        </p>
      )}
      <button
        type="button"
        disabled={pending}
        aria-busy={pending ? true : undefined}
        onClick={() => void create()}
      >
        Create file
      </button>
    </Dialog>
  );
}

export function UploadDialog(props: {
  context: DialogContext;
  onClose: () => void;
  returnFocusTo: () => HTMLElement | null;
  onUploaded: (path: string) => void;
}): JSX.Element {
  const [folder, setFolder] = useState('figures');
  const [chosen, setChosen] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const uploadButton = useRef<HTMLButtonElement | null>(null);

  const upload = async (): Promise<void> => {
    if (chosen === null) return;
    const form = new FormData();
    form.append('file', chosen, chosen.name);
    form.append('folder', folder);
    setPending(true);
    setError(null);
    props.context.notify(copy.uploading(chosen.name));
    const sequence = props.context.nextStorageAction();
    try {
      const answer = await api<{ file: { path: string } }>(
        `/api/projects/${props.context.projectId}/assets`,
        { method: 'POST', form },
      );
      props.context.clearStorage(sequence);
      props.context.notify(copy.uploaded(answer.file.path));
      props.context.afterAction();
      props.onUploaded(answer.file.path);
      props.onClose();
      return;
    } catch (failure) {
      if (failure instanceof ApiFailure) {
        if (failure.status === 503) {
          props.context.storageNotice(sequence);
          props.context.notify('');
        } else if (failure.status === 413) {
          props.context.notify(copy.uploadTooLarge(chosen.name));
        } else if (failure.status === 415) {
          props.context.notify(copy.uploadType(chosen.name));
        } else if (failure.code === 'path_taken') {
          props.context.notify(copy.pathTaken(`${folder === '' ? '' : `${folder}/`}${chosen.name}`));
        } else if (failure.status === 403) {
          props.context.forbidden();
          props.onClose();
          return;
        } else if (failure.field('file') !== null) {
          props.context.notify(copy.uploadName(chosen.name));
        } else if (failure.field('folder') !== null) {
          setError(copy.fields.path);
        } else {
          props.context.notify(copy.somethingWrong);
        }
      } else {
        props.context.notify(copy.somethingWrong);
      }
    } finally {
      setPending(false);
      window.requestAnimationFrame(() => uploadButton.current?.focus());
    }
  };

  return (
    <Dialog
      name="Upload file"
      onClose={props.onClose}
      returnFocusTo={props.returnFocusTo}
      firstFocus="input[type=file]"
    >
      <h2>Upload file</h2>
      <label>
        <span className="field-label">File</span>
        <input
          type="file"
          onChange={(event) => setChosen(event.target.files?.[0] ?? null)}
        />
      </label>
      <label>
        <span className="field-label">Folder</span>
        <input
          value={folder}
          aria-describedby={error === null ? undefined : 'folder-error'}
          onChange={(event) => setFolder(event.target.value)}
        />
      </label>
      {error === null ? null : (
        <p className="field-error" id="folder-error">
          {error}
        </p>
      )}
      <button
        type="button"
        ref={uploadButton}
        disabled={pending}
        aria-busy={pending ? true : undefined}
        onClick={() => void upload()}
      >
        Upload
      </button>
      <button type="button" onClick={props.onClose}>
        Cancel
      </button>
    </Dialog>
  );
}

export function SuggestDialog(props: {
  quote: string;
  onClose: () => void;
  returnFocusTo: () => HTMLElement | null;
  onSubmit: (replacement: string) => Promise<boolean>;
}): JSX.Element {
  const [replacement, setReplacement] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <Dialog name="Suggest edit" onClose={props.onClose} returnFocusTo={props.returnFocusTo}>
      <h2>Suggest edit</h2>
      <p className="card-quote">{props.quote}</p>
      <label>
        <span className="field-label">Replacement text</span>
        <textarea
          value={replacement}
          aria-describedby={error === null ? undefined : 'replacement-error'}
          onChange={(event) => setReplacement(event.target.value)}
        />
      </label>
      {error === null ? null : (
        <p className="field-error" id="replacement-error">
          {error}
        </p>
      )}
      <button
        type="button"
        disabled={pending}
        aria-busy={pending ? true : undefined}
        onClick={() => {
          setPending(true);
          setError(null);
          void props
            .onSubmit(replacement)
            .then((done) => {
              if (!done) setError(copy.fields.unstorable);
            })
            .finally(() => setPending(false));
        }}
      >
        Add suggestion
      </button>
    </Dialog>
  );
}

export function CommentDialog(props: {
  quote: string;
  mentions: MentionApi;
  onClose: () => void;
  returnFocusTo: () => HTMLElement | null;
  onSubmit: (body: string) => Promise<boolean>;
}): JSX.Element {
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const boxRef = useRef<HTMLTextAreaElement | null>(null);

  const choose = (handle?: string): void => {
    const next = props.mentions.choose(body, handle);
    if (next === null) return;
    setBody(next.value);
    window.requestAnimationFrame(() => {
      boxRef.current?.focus();
      boxRef.current?.setSelectionRange(next.caret, next.caret);
    });
  };

  return (
    <Dialog name="New comment" onClose={props.onClose} returnFocusTo={props.returnFocusTo}>
      <h2>New comment</h2>
      <p className="card-quote">{props.quote}</p>
      <label>
        <span className="field-label">Comment</span>
        <textarea
          ref={boxRef}
          value={body}
          role="textbox"
          aria-activedescendant={mentionActiveDescendant(props.mentions)}
          aria-describedby={error === null ? undefined : 'comment-error'}
          onChange={(event) => {
            setBody(event.target.value);
            props.mentions.sync('comment', event.target.value, event.target.selectionStart ?? 0);
          }}
          onKeyDown={(event) => {
            if (props.mentions.state.owner === null) return;
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              props.mentions.move(1);
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              props.mentions.move(-1);
            } else if (event.key === 'Enter' || event.key === 'Tab') {
              event.preventDefault();
              choose();
            }
          }}
        />
      </label>
      <MentionList api={props.mentions} onChoose={(handle) => choose(handle)} />
      {error === null ? null : (
        <p className="field-error" id="comment-error">
          {error}
        </p>
      )}
      <button
        type="button"
        disabled={pending}
        aria-busy={pending ? true : undefined}
        onClick={() => {
          setPending(true);
          setError(null);
          void props
            .onSubmit(body)
            .then((done) => {
              if (!done) setError(copy.fields.comment);
            })
            .finally(() => setPending(false));
        }}
      >
        Post comment
      </button>
    </Dialog>
  );
}

export function DeleteConfirm(props: {
  path: string;
  onClose: () => void;
  returnFocusTo: () => HTMLElement | null;
  onConfirm: () => void;
}): JSX.Element {
  return (
    <Dialog
      name={`Delete ${props.path}?`}
      kind="alertdialog"
      onClose={props.onClose}
      returnFocusTo={props.returnFocusTo}
    >
      <h2>Delete {props.path}?</h2>
      <p>{copy.deleteConfirmBody(props.path)}</p>
      <button type="button" onClick={props.onClose}>
        Cancel
      </button>
      <button type="button" onClick={props.onConfirm}>
        Delete
      </button>
    </Dialog>
  );
}

export function StaleSaveDialog(props: {
  path: string;
  unsaved: string;
  onClose: () => void;
  onLoadLatest: () => void;
}): JSX.Element {
  return (
    <Dialog name="Newer version on the server" kind="alertdialog" onClose={props.onClose}>
      <h2>Newer version on the server</h2>
      <p>{copy.staleSaveBody(props.path)}</p>
      <label>
        <span className="field-label">Your unsaved text</span>
        <textarea aria-label="Your unsaved text" readOnly value={props.unsaved} />
      </label>
      <button type="button" onClick={props.onLoadLatest}>
        Load latest
      </button>
    </Dialog>
  );
}

export function CitationsDialog(props: {
  report: CitationReport | null;
  onClose: () => void;
  returnFocusTo: () => HTMLElement | null;
  onChoose: (warning: CitationWarning) => void;
}): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const focusedKey = useRef<string | null>(null);

  const lists: [string, CitationWarning[]][] = [
    ['Undefined citations', props.report?.undefined ?? []],
    ['Unused entries', props.report?.unused ?? []],
    ['Duplicate keys', props.report?.duplicate ?? []],
  ];
  const empty = lists.every(([, items]) => items.length === 0);

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    const wanted = focusedKey.current;
    if (wanted === null) return;
    const element = host.querySelector<HTMLElement>(`[data-warning="${CSS.escape(wanted)}"]`);
    if (element !== null) {
      element.focus();
      return;
    }
    const first = host.querySelector<HTMLElement>('[data-warning]');
    first?.focus();
  }, [props.report]);

  return (
    <Dialog
      name="Citation warnings"
      onClose={props.onClose}
      returnFocusTo={props.returnFocusTo}
      firstFocus={empty ? 'self' : 'first'}
    >
      <div ref={hostRef}>
        <h2>Citation warnings</h2>
        {lists.map(([title, items]) => (
          <section key={title}>
            <h3>{title}</h3>
            <ul className="ruled-list" aria-label={title}>
              {items.map((item) => (
                <li key={`${title}-${item.key}-${item.path}-${item.line}`}>
                  <a
                    href={`?file=${encodeURIComponent(item.path)}&line=${item.line}`}
                    data-warning={`${title}-${item.key}`}
                    onFocus={() => {
                      focusedKey.current = `${title}-${item.key}`;
                    }}
                    onClick={(event) => {
                      event.preventDefault();
                      props.onChoose(item);
                    }}
                  >
                    {item.key} {item.path}:{item.line}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Dialog>
  );
}

export function SubmissionDialog(props: {
  context: DialogContext;
  readiness: Readiness | null;
  projectRevision: number;
  onClose: () => void;
  returnFocusTo: () => HTMLElement | null;
  onReadiness: (readiness: Readiness) => void;
}): JSX.Element {
  const [record, setRecord] = useState<ExportRecord | null>(null);
  const [pending, setPending] = useState(false);
  const exportButton = useRef<HTMLButtonElement | null>(null);
  const linkRef = useRef<HTMLAnchorElement | null>(null);
  const shownAt = useRef<number>(props.projectRevision);

  const readiness = props.readiness;
  const ready =
    readiness !== null &&
    readiness.openSuggestions === 0 &&
    readiness.openThreads === 0 &&
    readiness.undefinedCitations === 0 &&
    readiness.duplicateKeys === 0;

  useEffect(() => {
    if (record !== null && shownAt.current !== props.projectRevision) {
      const hadFocus = document.activeElement === linkRef.current;
      setRecord(null);
      if (hadFocus) {
        window.requestAnimationFrame(() => exportButton.current?.focus());
      }
    }
  }, [props.projectRevision, record]);

  const runExport = async (): Promise<void> => {
    if (pending) return;
    setPending(true);
    props.context.notify(copy.exportPending);
    const sequence = props.context.nextStorageAction();
    try {
      const answer = await api<{ export: ExportRecord }>(
        `/api/projects/${props.context.projectId}/exports`,
        { method: 'POST', body: {} },
      );
      props.context.clearStorage(sequence);
      props.context.notify(copy.exportReady(answer.export.projectRevision));
      shownAt.current = answer.export.projectRevision;
      setRecord(answer.export);
      window.requestAnimationFrame(() => linkRef.current?.focus());
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.code === 'not_ready') {
        const counts = failure.body.readiness as Readiness;
        props.onReadiness(counts);
        props.context.notify(
          copy.exportNotReady(
            counts.openSuggestions,
            counts.openThreads,
            counts.undefinedCitations,
            counts.duplicateKeys,
          ),
        );
      } else if (failure instanceof ApiFailure && failure.status === 503) {
        props.context.storageNotice(sequence);
      } else if (failure instanceof ApiFailure && failure.status === 403) {
        props.context.forbidden();
        props.onClose();
        return;
      } else {
        props.context.notify(copy.somethingWrong);
      }
    } finally {
      setPending(false);
    }
  };

  const download = async (): Promise<void> => {
    if (record === null) return;
    const sequence = props.context.nextStorageAction();
    try {
      const response = await fetch(record.downloadUrl, { credentials: 'same-origin' });
      if (!response.ok) {
        props.context.storageNotice(sequence);
        return;
      }
      props.context.clearStorage(sequence);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = record.filename;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch {
      props.context.storageNotice(sequence);
    }
  };

  return (
    <Dialog
      name="Submission check"
      onClose={props.onClose}
      returnFocusTo={props.returnFocusTo}
      firstFocus={ready ? 'first' : 'self'}
    >
      <h2>Submission check</h2>
      <p>Open suggestions: {readiness?.openSuggestions ?? 0}</p>
      <p>Open threads: {readiness?.openThreads ?? 0}</p>
      <p>Undefined citations: {readiness?.undefinedCitations ?? 0}</p>
      <p>Duplicate keys: {readiness?.duplicateKeys ?? 0}</p>
      <button
        type="button"
        ref={exportButton}
        disabled={!ready}
        aria-busy={pending ? true : undefined}
        aria-disabled={pending ? true : undefined}
        onClick={() => void runExport()}
      >
        Export source
      </button>
      {record === null ? null : (
        <p>
          {copy.exportReady(record.projectRevision)}{' '}
          <a
            ref={linkRef}
            href={record.downloadUrl}
            onClick={(event) => {
              event.preventDefault();
              void download();
            }}
          >
            Download {record.filename}
          </a>
        </p>
      )}
    </Dialog>
  );
}
