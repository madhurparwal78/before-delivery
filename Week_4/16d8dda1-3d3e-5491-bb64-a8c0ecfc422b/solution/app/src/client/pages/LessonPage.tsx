import { useEffect, useRef, useState } from 'react';
import type { Lesson, LessonFile } from '../../shared/wire';
import { api, upload } from '../api';
import { Link } from '../router';
import { Icon } from '../ui/icons';
import { Alert, Empty, NotFound, PageStatus, Skeleton } from '../ui/feedback';
import { useAction } from './useAction';
import { useLoad } from './useLoad';

const STATE_LABEL = { draft: 'Draft', uploading: 'Uploading', ready: 'Ready' } as const;
const POLL_MS = 2000;

interface Row {
  fileId: string;
  name: string;
  status: 'pending' | 'confirmed';
  detail: string;
  movable: boolean;
}

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const rowOf = (file: LessonFile, kind: 'Slide' | 'Model'): Row => ({
  fileId: file.fileId,
  name: file.name,
  status: file.status,
  detail: `${kind} ${file.number} · ${size(file.bytes)}`,
  movable: kind === 'Slide',
});

function Editor({ initial }: { initial: Lesson }) {
  const [lesson, setLesson] = useState(initial);
  const [message, setMessage] = useState('');
  const [chosen, setChosen] = useState<File[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const files = useAction();
  const change = useAction();

  const slides = lesson.slides.map((file) => rowOf(file, 'Slide'));
  const rows: Row[] = [
    ...slides,
    ...lesson.models.map((file) => rowOf(file, 'Model')),
    ...chosen.map((file, index): Row => ({ fileId: `pending-${index}`, name: file.name, status: 'pending', detail: size(file.size), movable: false })),
  ];
  const slideIds = lesson.slides.map((file) => file.fileId);

  useEffect(() => {
    if (lesson.state !== 'uploading' || files.pending) return;
    const timer = setInterval(() => {
      api<Lesson>('GET', `/api/lessons/${lesson.id}`).then(setLesson, () => undefined);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [lesson.id, lesson.state, files.pending]);

  const addFiles = async (picked: File[]) => {
    if (picked.length === 0) return;
    setMessage('');
    change.clearError();
    setChosen(picked);
    const form = new FormData();
    for (const file of picked) form.append('files', file, file.name);
    const done = await files.run(() => upload<Lesson>(`/api/lessons/${lesson.id}/files`, form));
    setChosen([]);
    if (!done) return;
    setLesson(done.value);
    setMessage(`Files added: ${picked.length}.`);
  };

  const update = async (task: () => Promise<Lesson>, success: string) => {
    setMessage('');
    files.clearError();
    const done = await change.run(task);
    if (!done) return;
    setLesson(done.value);
    setMessage(success);
  };

  const move = (fileId: string, by: -1 | 1) => {
    const at = slideIds.indexOf(fileId);
    const next = [...slideIds];
    next.splice(at, 1);
    next.splice(at + by, 0, fileId);
    return update(() => api<Lesson>('PUT', `/api/lessons/${lesson.id}/order`, { slideIds: next }), 'Lesson updated.');
  };

  const saving = files.pending || change.pending;
  const error = files.error ?? change.error;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{lesson.title}</h1>
          <p className="lesson-status">Status: {STATE_LABEL[lesson.state]}</p>
        </div>
        <div className="row">
          <button type="button" onClick={() => input.current?.click()} disabled={files.pending}>
            <Icon name="plus" />
            Add files
          </button>
          <input
            ref={input}
            type="file"
            multiple
            hidden
            aria-label="Add files"
            onChange={(event) => {
              const picked = [...(event.target.files ?? [])];
              event.target.value = '';
              void addFiles(picked);
            }}
          />
          <button type="button" className="primary" onClick={() => void update(() => api<Lesson>('POST', `/api/lessons/${lesson.id}/ready`), 'Lesson ready to teach.')} disabled={change.pending} aria-busy={change.pending}>
            Mark ready to teach
          </button>
        </div>
      </div>

      <section className="panel" aria-labelledby="files-heading">
        <h2 id="files-heading">Files</h2>
        <p className="hint">Slides are PNG or JPEG images, shown in this order. A model is a glTF binary; the first model stands beside the board.</p>
        {rows.length === 0 ? (
          <Empty drawing="tray">No files yet. Add slide images and, if you like, a 3D model.</Empty>
        ) : (
          <ol className="ruled file-list" aria-label="Lesson files">
            {rows.map((row) => {
              const at = slideIds.indexOf(row.fileId);
              return (
                <li key={row.fileId} data-file-id={row.fileId} data-file-status={row.status} className="file-row">
                  <div className="file-main">
                    <span className="file-name">{row.name}</span>
                    <span className="file-detail mono">{row.detail}</span>
                  </div>
                  <span className="badge">{row.status === 'pending' ? 'Pending' : 'Confirmed'}</span>
                  {row.status === 'confirmed' ? (
                    <span className="file-actions">
                      {row.movable ? (
                        <>
                          <button type="button" aria-label={`Move ${row.name} up`} disabled={change.pending || at <= 0} onClick={() => void move(row.fileId, -1)}>
                            <Icon name="arrowUp" />
                          </button>
                          <button type="button" aria-label={`Move ${row.name} down`} disabled={change.pending || at === slideIds.length - 1} onClick={() => void move(row.fileId, 1)}>
                            <Icon name="arrowDown" />
                          </button>
                        </>
                      ) : null}
                      <button
                        type="button"
                        aria-label={`Remove ${row.name}`}
                        disabled={change.pending}
                        onClick={() => void update(() => api<Lesson>('DELETE', `/api/lessons/${lesson.id}/files/${row.fileId}`), 'Lesson updated.')}
                      >
                        <Icon name="trash" />
                      </button>
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ol>
        )}
        {error ? <Alert>{error}</Alert> : null}
      </section>
      <p className="after-panel">
        <Link href={`/classes/${lesson.classId}`}>Back to the class</Link>
      </p>
      <PageStatus text={saving ? 'Saving...' : message} />
    </>
  );
}

export function LessonPage({ lessonId }: { lessonId: string }) {
  const { result } = useLoad<Lesson>(`/api/lessons/${lessonId}`);
  if (result.state === 'missing') return <NotFound />;
  if (result.state === 'refused') {
    return (
      <main className="page">
        <Alert>{result.message}</Alert>
      </main>
    );
  }
  return <main className="page">{result.state === 'loading' ? <Skeleton rows={4} label="Loading the lesson" /> : <Editor key={lessonId} initial={result.data} />}</main>;
}
