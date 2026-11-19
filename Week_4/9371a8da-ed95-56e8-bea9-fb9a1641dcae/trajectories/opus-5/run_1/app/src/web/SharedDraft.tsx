import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiFailure } from './api.js';
import { Dialog } from './components/Dialog.js';
import { FileTree } from './components/FileTree.js';
import { Margin, MarginCardModel } from './components/Margin.js';
import { SourceEditor, SourceHandle, SourceMark } from './components/SourceEditor.js';
import { copy } from './copy.js';
import { LayoutMode, useReducedMotion } from './layout.js';
import { push } from './navigation.js';
import { lineOfOffset, normalise, normalisedOffsetOf, sectionsOf } from './text.js';
import { ProjectFile, Review } from './types.js';

interface Props {
  token: string;
  search: string;
  mode: LayoutMode;
}

export function SharedDraft(props: Props): JSX.Element {
  const [title, setTitle] = useState('');
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [file, setFile] = useState<ProjectFile | null>(null);
  const [text, setText] = useState('');
  const [review, setReview] = useState<Review>({
    suggestions: [],
    threads: [],
    openSuggestions: 0,
  });
  const [dead, setDead] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);
  const [panel, setPanel] = useState<'source' | 'margin'>('source');
  const [focusedCard, setFocusedCard] = useState<string | null>(null);
  const [lineTops, setLineTops] = useState<number[]>([]);
  const [sourceTop, setSourceTop] = useState(0);
  const sourceRef = useRef<SourceHandle | null>(null);
  const filesButton = useRef<HTMLButtonElement | null>(null);
  const reducedMotion = useReducedMotion();

  const params = useMemo(() => new URLSearchParams(props.search), [props.search]);
  const openPath = params.get('file');

  const load = useCallback(async () => {
    try {
      const [projectAnswer, reviewAnswer] = await Promise.all([
        api<{ project: { title: string; projectRevision: number }; files: ProjectFile[] }>(
          `/api/share/${props.token}`,
        ),
        api<Review>(`/api/share/${props.token}/review`),
      ]);
      setTitle(projectAnswer.project.title);
      setFiles(projectAnswer.files);
      setReview(reviewAnswer);
      setDead(false);
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.status === 404) {
        setDead(true);
        setFiles([]);
        setFile(null);
        setText('');
        setReview({ suggestions: [], threads: [], openSuggestions: 0 });
      }
    }
  }, [props.token]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 5_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const wanted = useMemo(() => {
    if (files.length === 0) return null;
    const found = openPath === null ? undefined : files.find((entry) => entry.path === openPath);
    return found ?? files.find((entry) => entry.path === 'main.tex') ?? files[0];
  }, [files, openPath]);

  useEffect(() => {
    if (wanted === null || wanted === undefined) return;
    if (file !== null && file.id === wanted.id && file.kind === wanted.kind) return;
    void api<{ file: ProjectFile }>(`/api/share/${props.token}/files/${wanted.id}`)
      .then((answer) => {
        setFile(answer.file);
        if (answer.file.kind === 'text') setText(normalise(answer.file.content ?? ''));
      })
      .catch(() => undefined);
  }, [wanted?.id, props.token]);

  const measure = useCallback(() => {
    setLineTops(sourceRef.current?.lineTops() ?? []);
    setSourceTop(sourceRef.current?.viewportTop() ?? 0);
  }, []);

  useEffect(() => {
    measure();
    const onResize = (): void => measure();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [measure, text, props.mode]);

  const marks = useMemo((): SourceMark[] => {
    if (file === null || file.kind !== 'text') return [];
    const stored = file.content ?? '';
    const result: SourceMark[] = [];
    for (const suggestion of review.suggestions) {
      if (suggestion.fileId !== file.id || suggestion.status !== 'open') continue;
      if (suggestion.from === null || suggestion.to === null) continue;
      result.push({
        kind: 'deleted',
        from: normalisedOffsetOf(stored, suggestion.from),
        to: normalisedOffsetOf(stored, suggestion.to),
      });
    }
    for (const thread of review.threads) {
      if (thread.fileId !== file.id || thread.status !== 'open' || thread.orphaned) continue;
      if (thread.from === null || thread.to === null) continue;
      result.push({
        kind: 'commented',
        from: normalisedOffsetOf(stored, thread.from),
        to: normalisedOffsetOf(stored, thread.to),
      });
    }
    return result;
  }, [review, file]);

  const cards = useMemo((): MarginCardModel[] => {
    const stored = file !== null && file.kind === 'text' ? (file.content ?? '') : '';
    const lineOf = (from: number | null): number | null =>
      from === null ? null : lineOfOffset(text, normalisedOffsetOf(stored, from));
    const list: MarginCardModel[] = [];
    for (const suggestion of review.suggestions) {
      const orphaned = suggestion.status === 'orphaned';
      if (!orphaned && (suggestion.fileId !== file?.id || suggestion.status !== 'open')) continue;
      list.push({
        id: suggestion.id,
        kind: 'suggestion',
        name: suggestion.author.displayName,
        handle: null,
        createdAt: null,
        anchorLine: orphaned ? null : lineOf(suggestion.from),
        deleted: suggestion.deleted,
        inserted: suggestion.inserted,
        quote: null,
        comments: [],
        stub: null,
        pending: false,
        canResolve: false,
        canReply: false,
        orphaned,
      });
    }
    for (const thread of review.threads) {
      const orphaned = thread.orphaned && thread.status !== 'resolved';
      if (!orphaned && (thread.fileId !== file?.id || thread.status !== 'open')) continue;
      list.push({
        id: thread.id,
        kind: 'thread',
        name: thread.comments[0]?.author.displayName ?? '',
        handle: null,
        createdAt: null,
        anchorLine: orphaned ? null : lineOf(thread.from),
        deleted: null,
        inserted: null,
        quote: thread.quote,
        comments: thread.comments.map((comment) => ({
          id: comment.id,
          name: comment.author.displayName,
          handle: null,
          body: comment.body,
        })),
        stub: null,
        pending: false,
        canResolve: false,
        canReply: false,
        orphaned,
      });
    }
    return [
      ...list.filter((card) => card.orphaned),
      ...list
        .filter((card) => !card.orphaned)
        .sort((left, right) => (left.anchorLine ?? 0) - (right.anchorLine ?? 0)),
    ];
  }, [review, file, text]);

  if (dead) {
    return (
      <main className="centred-column">
        <h1>{copy.deadShareLink}</h1>
      </main>
    );
  }

  const sections = sectionsOf(text);
  const showSource = props.mode !== 'phone' || panel === 'source';
  const showMargin = props.mode !== 'phone' || panel === 'margin';

  return (
    <div className={`project project-${props.mode}`}>
      <a
        className="skip-link"
        href="#source"
        onClick={(event) => {
          event.preventDefault();
          setPanel('source');
          window.requestAnimationFrame(() => sourceRef.current?.focus());
        }}
      >
        Skip to source
      </a>
      <header className="toolbar" role="banner">
        <span className="read-only-band">{copy.readOnlyView}</span>
        <span className="project-title">{title}</span>
        {props.mode !== 'desktop' ? (
          <button type="button" ref={filesButton} onClick={() => setFilesOpen(true)}>
            Files
          </button>
        ) : null}
      </header>

      {props.mode === 'phone' ? (
        <div
          role="tablist"
          aria-label="Project view"
          className="tablist"
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
              event.preventDefault();
              setPanel(panel === 'source' ? 'margin' : 'source');
            } else if (event.key === 'Home') {
              event.preventDefault();
              setPanel('source');
            } else if (event.key === 'End') {
              event.preventDefault();
              setPanel('margin');
            }
          }}
        >
          <button
            type="button"
            role="tab"
            id="tab-source"
            aria-controls="panel-source"
            aria-selected={panel === 'source'}
            tabIndex={panel === 'source' ? 0 : -1}
            onClick={() => setPanel('source')}
          >
            Source
          </button>
          <button
            type="button"
            role="tab"
            id="tab-margin"
            aria-controls="panel-margin"
            aria-selected={panel === 'margin'}
            tabIndex={panel === 'margin' ? 0 : -1}
            onClick={() => setPanel('margin')}
          >
            Margin
          </button>
        </div>
      ) : null}

      <div className="columns">
        {props.mode === 'desktop' ? (
          <div className="left-rail">
            <FileTree
              files={files}
              openPath={file?.path ?? null}
              onOpen={(path) => push(`/s/${props.token}?file=${encodeURIComponent(path)}`)}
            />
            <ul className="ruled-list" aria-label="Sections">
              {sections.map((section) => (
                <li key={`${section.line}-${section.title}`}>
                  <button
                    type="button"
                    onClick={() => sourceRef.current?.scrollLineToTop(section.line)}
                  >
                    {section.title}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {showSource ? (
          <div
            className="centre"
            id={props.mode === 'phone' ? 'panel-source' : undefined}
            role={props.mode === 'phone' ? 'tabpanel' : undefined}
            aria-labelledby={props.mode === 'phone' ? 'tab-source' : undefined}
          >
            <div className="file-header">
              <span className="file-path">{file?.path ?? ''}</span>
            </div>
            {file !== null && file.kind === 'asset' ? (
              <div className="figure-preview">
                <img src={`/api/share/${props.token}/files/${file.id}/raw`} alt={file.path} />
                <p className="figure-meta">
                  {file.path} · {file.size} bytes · {file.contentType}
                </p>
              </div>
            ) : (
              <div
                className="source-scroller"
                id="source"
                onScroll={measure}
              >
                <div className="gutter" aria-hidden="true">
                  {lineTops.map((top, index) => (
                    <span key={index} className="gutter-number" style={{ top: `${top}px` }}>
                      {index + 1}
                    </span>
                  ))}
                </div>
                <SourceEditor
                  ref={sourceRef}
                  path={file?.path ?? 'main.tex'}
                  text={text}
                  editable={false}
                  marks={marks}
                  ghosts={[]}
                  onInput={() => undefined}
                  onSelectionChange={() => undefined}
                  onLayoutChange={measure}
                />
              </div>
            )}
          </div>
        ) : null}

        {showMargin ? (
          <div
            className="margin-column"
            id={props.mode === 'phone' ? 'panel-margin' : undefined}
            role={props.mode === 'phone' ? 'tabpanel' : undefined}
            aria-labelledby={props.mode === 'phone' ? 'tab-margin' : undefined}
          >
            <Margin
              cards={cards}
              lineTops={lineTops}
              sourceTop={sourceTop}
              mode={props.mode}
              focusedId={focusedCard}
              reducedMotion={reducedMotion}
              onFocusCard={setFocusedCard}
              onChooseCard={(id) => {
                setFocusedCard(id);
                if (props.mode === 'phone') setPanel('source');
              }}
              onAccept={() => undefined}
              onReject={() => undefined}
              onReply={() => undefined}
              onResolve={() => undefined}
              replyDrafts={{}}
              onReplyDraft={() => undefined}
              onReplyKeyDown={() => undefined}
              mentionFor={null}
              mentionList={null}
            />
          </div>
        ) : null}
      </div>

      {filesOpen ? (
        <Dialog
          name="Project files"
          onClose={() => setFilesOpen(false)}
          returnFocusTo={() => filesButton.current}
        >
          <h2>Project files</h2>
          <FileTree
            files={files}
            openPath={file?.path ?? null}
            onOpen={(path) => {
              push(`/s/${props.token}?file=${encodeURIComponent(path)}`);
              setFilesOpen(false);
            }}
          />
          <ul className="ruled-list" aria-label="Sections">
            {sections.map((section) => (
              <li key={`${section.line}-${section.title}`}>
                <button
                  type="button"
                  onClick={() => {
                    setFilesOpen(false);
                    sourceRef.current?.scrollLineToTop(section.line);
                  }}
                >
                  {section.title}
                </button>
              </li>
            ))}
          </ul>
        </Dialog>
      ) : null}
    </div>
  );
}
