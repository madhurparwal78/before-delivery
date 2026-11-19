import {
  FolderOpen,
  FileCheck2,
  FilePlus2,
  History as HistoryIcon,
  MessageSquare,
  PencilLine,
  Quote,
  Save,
  Upload,
  Users,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { moveCaret, computeSpan } from '../shared/anchors.js';
import { api, ApiFailure, NetworkFailure } from './api.js';
import { Dialog } from './components/Dialog.js';
import { FileTree } from './components/FileTree.js';
import { Margin, MarginCardModel, useCardFocusKeys } from './components/Margin.js';
import { MentionList, useMentions } from './components/Mentions.js';
import { MoreMenu } from './components/MoreMenu.js';
import { SourceEditor, SourceGhost, SourceHandle, SourceMark } from './components/SourceEditor.js';
import { copy } from './copy.js';
import { HistoryDialog } from './HistoryDialog.js';
import { LayoutMode, useReducedMotion } from './layout.js';
import { projectUrl, push, replace } from './navigation.js';
import { PeopleDialog } from './PeopleDialog.js';
import {
  CitationsDialog,
  CommentDialog,
  DeleteConfirm,
  DialogContext,
  NewFileDialog,
  StaleSaveDialog,
  SubmissionDialog,
  SuggestDialog,
  UploadDialog,
} from './ProjectDialogs.js';
import {
  lineOfOffset,
  normalise,
  normalisedOffsetOf,
  offsetOfLine,
  sectionsOf,
  storedAfterEdit,
  storedOffsetOf,
} from './text.js';
import {
  CitationReport,
  CitationWarning,
  Member,
  ProjectFile,
  ProjectRole,
  ProjectSummary,
  Readiness,
  Review,
  Suggestion,
  TextFile,
  Thread,
  User,
} from './types.js';

type DialogKind =
  | 'newFile'
  | 'upload'
  | 'suggest'
  | 'comment'
  | 'history'
  | 'people'
  | 'citations'
  | 'submission'
  | 'delete'
  | 'files'
  | null;

interface Props {
  projectId: string;
  search: string;
  user: User;
  mode: LayoutMode;
  onAccessLost: (title: string | null) => void;
}

const REFRESH_MS = 5_000;

const TOOLBAR_ICONS: Record<string, JSX.Element> = {
  save: <Save size={14} aria-hidden="true" />,
  suggest: <PencilLine size={14} aria-hidden="true" />,
  comment: <MessageSquare size={14} aria-hidden="true" />,
  newFile: <FilePlus2 size={14} aria-hidden="true" />,
  upload: <Upload size={14} aria-hidden="true" />,
  citations: <Quote size={14} aria-hidden="true" />,
  history: <HistoryIcon size={14} aria-hidden="true" />,
  people: <Users size={14} aria-hidden="true" />,
  submission: <FileCheck2 size={14} aria-hidden="true" />,
  files: <FolderOpen size={14} aria-hidden="true" />,
};

/** Focuses a control as soon as the refresh that creates it has arrived. */
function focusWhenPresent(selector: string, attempts = 40): void {
  const element = document.querySelector<HTMLElement>(selector);
  if (element !== null) {
    element.focus();
    return;
  }
  if (attempts <= 0) return;
  window.requestAnimationFrame(() => focusWhenPresent(selector, attempts - 1));
}

function threadCreatedAt(thread: Thread): number {
  const first = thread.comments[0];
  return first === undefined ? 0 : new Date(first.createdAt).getTime();
}

export function ProjectView(props: Props): JSX.Element {
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [file, setFile] = useState<ProjectFile | null>(null);
  const [loadedText, setLoadedText] = useState('');
  const [editorText, setEditorText] = useState('');
  const [dirty, setDirty] = useState(false);
  const [review, setReview] = useState<Review>({
    suggestions: [],
    threads: [],
    openSuggestions: 0,
  });
  const [citations, setCitations] = useState<CitationReport | null>(null);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [status, setStatus] = useState('');
  const [storage, setStorage] = useState('');
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [stale, setStale] = useState<{ path: string; unsaved: string } | null>(null);
  const [stubs, setStubs] = useState<Record<string, string>>({});
  const [pendingCards, setPendingCards] = useState<Record<string, boolean>>({});
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [focusedCard, setFocusedCard] = useState<string | null>(null);
  const [mentionOwner, setMentionOwner] = useState<string | null>(null);
  const [selection, setSelection] = useState<{ from: number; to: number } | null>(null);
  const [savePending, setSavePending] = useState(false);
  const [lineTops, setLineTops] = useState<number[]>([]);
  const [sourceTop, setSourceTop] = useState(0);
  const [panel, setPanel] = useState<'source' | 'margin'>('source');
  const [settling, setSettling] = useState<{ id: string; outcome: 'accept' | 'reject' } | null>(
    null,
  );
  const [previewFailed, setPreviewFailed] = useState<Record<string, boolean>>({});
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});

  const sourceRef = useRef<SourceHandle | null>(null);
  const actions = useRef(0);
  const storageSent = useRef(0);
  const storageAnswered = useRef(0);
  const previewInFlight = useRef<Record<string, number>>({});
  const lastResolution = useRef<string | null>(null);
  const pressedButton = useRef<HTMLElement | null>(null);
  const toolbarRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const reducedMotion = useReducedMotion();
  const pendingLine = useRef<number | null>(null);
  const firstLoad = useRef(true);
  const pendingThread = useRef<string | null>(null);

  const params = useMemo(() => new URLSearchParams(props.search), [props.search]);
  const role: ProjectRole = project?.role ?? 'viewer';
  const canEdit = role === 'owner' || role === 'editor';
  const canReview = canEdit || role === 'reviewer';
  const canResolve = canEdit;
  const isOwner = role === 'owner';

  const handles = members
    .map((member) => member.user.handle)
    .filter((handle): handle is string => handle !== undefined);
  const mentions = useMentions(handles);

  const notify = useCallback((message: string) => setStatus(message), []);
  const nextStorageAction = useCallback(() => {
    storageSent.current += 1;
    return storageSent.current;
  }, []);
  const storageAnswerWins = useCallback((sequence: number) => {
    if (sequence < storageAnswered.current) return false;
    storageAnswered.current = sequence;
    return true;
  }, []);
  const storageNotice = useCallback(
    (sequence: number) => {
      if (storageAnswerWins(sequence)) setStorage(copy.storageUnavailable);
    },
    [storageAnswerWins],
  );
  const clearStorage = useCallback(
    (sequence: number) => {
      if (storageAnswerWins(sequence)) setStorage('');
    },
    [storageAnswerWins],
  );

  const openPath = params.get('file');
  const openFileRecord = useMemo(() => {
    if (files.length === 0) return null;
    const wanted = openPath;
    const found = wanted === null ? undefined : files.find((entry) => entry.path === wanted);
    if (found !== undefined) return found;
    return files.find((entry) => entry.path === 'main.tex') ?? files[0] ?? null;
  }, [files, openPath]);

  const context: DialogContext = useMemo(
    () => ({
      projectId: props.projectId,
      notify,
      storageNotice,
      clearStorage,
      nextStorageAction,
      afterAction: () => {
        actions.current += 1;
        void refresh();
      },
      forbidden: () => {
        void refresh().then((current) => notify(copy.forbidden(current ?? role)));
        sourceRef.current?.focus();
      },
    }),
    [props.projectId, notify, storageNotice, clearStorage, nextStorageAction, role],
  );

  const loadFile = useCallback(
    async (fileId: string, options: { keepCaret: boolean; force?: boolean }) => {
      const answer = await api<{ file: ProjectFile }>(
        `/api/projects/${props.projectId}/files/${fileId}`,
      );
      const loaded = answer.file;
      setFile(loaded);
      if (loaded.kind === 'text') {
        const next = normalise(loaded.content ?? '');
        const previous = loadedText;
        setLoadedText(next);
        if (!dirty || options.force === true) {
          const element = sourceRef.current?.element() ?? null;
          const focused = element !== null && element.contains(document.activeElement);
          const current = focused ? (sourceRef.current?.selection() ?? null) : null;
          setEditorText(next);
          if (options.keepCaret && current !== null) {
            const span = computeSpan(previous, next);
            window.requestAnimationFrame(() => {
              sourceRef.current?.setSelection(
                moveCaret(current.from, span),
                moveCaret(current.to, span),
              );
            });
          }
        }
      }
      return loaded;
    },
    [props.projectId, dirty, loadedText],
  );

  const refresh = useCallback(async (): Promise<ProjectRole | null> => {
    const at = actions.current;
    try {
      const [projectAnswer, reviewAnswer, citationAnswer, memberAnswer] = await Promise.all([
        api<{ project: ProjectSummary; files: ProjectFile[] }>(`/api/projects/${props.projectId}`),
        api<Review>(`/api/projects/${props.projectId}/review`),
        api<CitationReport>(`/api/projects/${props.projectId}/citations`),
        api<{ members: Member[] }>(`/api/projects/${props.projectId}/members`),
      ]);
      if (actions.current !== at) return null;
      const previousRole = project?.role;
      setProject(projectAnswer.project);
      setFiles(projectAnswer.files);
      setReview(reviewAnswer);
      setCitations(citationAnswer);
      setMembers(memberAnswer.members);
      setReadiness({
        openSuggestions: reviewAnswer.openSuggestions,
        openThreads: reviewAnswer.threads.filter((thread) => thread.status === 'open').length,
        undefinedCitations: citationAnswer.undefined.length,
        duplicateKeys: citationAnswer.duplicate.length,
      });
      if (previousRole !== undefined && previousRole !== projectAnswer.project.role) {
        notify(copy.roleChanged(projectAnswer.project.role));
      }
      const current = file;
      if (current !== null) {
        const listed = projectAnswer.files.find((entry) => entry.id === current.id);
        if (listed === undefined) {
          const fallback =
            projectAnswer.files.find((entry) => entry.path === 'main.tex') ??
            projectAnswer.files[0];
          if (fallback !== undefined) await loadFile(fallback.id, { keepCaret: false });
        } else if (
          listed.kind === 'text' &&
          current.kind === 'text' &&
          listed.revision !== current.revision &&
          dialog !== 'suggest' &&
          dialog !== 'comment'
        ) {
          await loadFile(current.id, { keepCaret: true });
        }
      }
      return projectAnswer.project.role;
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.status === 404) {
        props.onAccessLost(project?.title ?? null);
      }
      return null;
    }
  }, [props.projectId, file, project, loadFile, notify, dialog]);

  useEffect(() => {
    void refresh();
  }, [props.projectId]);

  useEffect(() => {
    const timer = window.setInterval(() => void refresh(), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  /** The open file follows the address. */
  useEffect(() => {
    if (openFileRecord === null) return;
    if (file !== null && file.id === openFileRecord.id) return;
    const first = firstLoad.current;
    firstLoad.current = false;
    void loadFile(openFileRecord.id, { keepCaret: false }).then((loaded) => {
      const line = params.get('line');
      if (line !== null) pendingLine.current = Number(line);
      if (first && line === null && params.get('thread') === null && loaded.kind === 'text') {
        window.requestAnimationFrame(() => {
          sourceRef.current?.setCaret(0);
          sourceRef.current?.focus();
        });
      }
    });
  }, [openFileRecord?.id]);

  /** A thread link opens its file with the thread's card focused. */
  useEffect(() => {
    const threadId = params.get('thread');
    if (threadId === null || files.length === 0) return;
    const thread = review.threads.find((candidate) => candidate.id === threadId);
    if (review.threads.length === 0) return;
    if (thread === undefined) {
      notify(copy.threadMissing);
      const fallback = files.find((entry) => entry.path === 'main.tex') ?? files[0];
      if (fallback !== undefined) {
        replace(projectUrl(props.projectId, { file: fallback.path }));
      }
      return;
    }
    if (thread.status === 'resolved' && thread.resolvedBy !== null) {
      notify(copy.threadResolvedBy(thread.resolvedBy.displayName));
    }
    const target = files.find((entry) => entry.id === thread.fileId);
    const path =
      target?.path ?? (files.find((entry) => entry.path === 'main.tex') ?? files[0]).path;
    pendingThread.current = thread.id;
    replace(projectUrl(props.projectId, { file: path, thread: thread.id }));
  }, [params.get('thread'), review.threads.length, files.length]);

  useEffect(() => {
    const line = params.get('line');
    if (line === null || file === null || file.kind !== 'text') return;
    pendingLine.current = Number(line);
  }, [params.get('line'), file?.id]);

  useEffect(() => {
    const line = pendingLine.current;
    if (line === null || file === null || file.kind !== 'text') return;
    pendingLine.current = null;
    const offset = offsetOfLine(editorText, line);
    window.requestAnimationFrame(() => {
      sourceRef.current?.scrollLineToTop(Math.min(line, lineOfOffset(editorText, editorText.length)));
      sourceRef.current?.setCaret(offset);
      sourceRef.current?.focus();
    });
  }, [file?.id, editorText, lineTops.length]);

  useEffect(() => {
    const threadId = pendingThread.current;
    if (threadId === null) return;
    const element = document.querySelector<HTMLElement>(`[data-card="${threadId}"]`);
    if (element === null) return;
    pendingThread.current = null;
    setFocusedCard(threadId);
    if (props.mode === 'phone') setPanel('margin');
    element.focus();
  }, [review, lineTops, props.mode]);

  /** Crossing a breakpoint keeps the focused card and the open file. */
  useEffect(() => {
    if (props.mode === 'phone') {
      const active = document.activeElement;
      if (active instanceof HTMLElement && active.closest('.margin') !== null) setPanel('margin');
      return;
    }
    if (props.mode === 'desktop' && dialog === 'files') {
      setDialog(null);
      window.requestAnimationFrame(() => {
        document.querySelector<HTMLElement>('.left-rail [role="treeitem"][tabindex="0"]')?.focus();
      });
    }
  }, [props.mode]);

  /** The source selection drives Suggest edit and Comment. */
  useEffect(() => {
    const onSelectionChange = (): void => {
      const current = sourceRef.current?.selection() ?? null;
      if (current !== null) setSelection(current);
    };
    document.addEventListener('selectionchange', onSelectionChange);
    return () => document.removeEventListener('selectionchange', onSelectionChange);
  }, []);

  const measure = useCallback(() => {
    setLineTops(sourceRef.current?.lineTops() ?? []);
    setSourceTop(sourceRef.current?.viewportTop() ?? 0);
  }, []);

  useEffect(() => {
    measure();
    const onResize = (): void => measure();
    window.addEventListener('resize', onResize);
    if (document.fonts !== undefined) void document.fonts.ready.then(() => measure());
    return () => window.removeEventListener('resize', onResize);
  }, [measure, editorText, props.mode]);

  /** Figure previews retry on every refresh until their object loads. */
  useEffect(() => {
    if (file === null || file.kind !== 'asset') return;
    const fileId = file.id;
    if (previewUrls[fileId] !== undefined) return;
    const started = previewInFlight.current[fileId];
    if (started !== undefined && Date.now() - started < 10_000) return;
    previewInFlight.current[fileId] = Date.now();
    const sequence = nextStorageAction();
    void (async () => {
      try {
        const response = await fetch(`/api/projects/${props.projectId}/files/${fileId}/raw`, {
          credentials: 'same-origin',
        });
        if (!response.ok) {
          delete previewInFlight.current[fileId];
          if (storageAnswerWins(sequence)) {
            setStorage(copy.storageUnavailable);
            setPreviewFailed((previous) => ({ ...previous, [fileId]: true }));
          }
          return;
        }
        const blob = await response.blob();
        delete previewInFlight.current[fileId];
        if (!storageAnswerWins(sequence)) return;
        setStorage('');
        setPreviewFailed((previous) => ({ ...previous, [fileId]: false }));
        setPreviewUrls((previous) => ({ ...previous, [fileId]: URL.createObjectURL(blob) }));
      } catch {
        delete previewInFlight.current[fileId];
        if (storageAnswerWins(sequence)) {
          setStorage(copy.storageUnavailable);
          setPreviewFailed((previous) => ({ ...previous, [fileId]: true }));
        }
      }
    })();
  }, [file, review, props.projectId, previewUrls, nextStorageAction, storageAnswerWins]);

  const openFile = (path: string): void => {
    push(projectUrl(props.projectId, { file: path }));
    if (props.mode !== 'desktop' && dialog === 'files') setDialog(null);
  };

  const save = async (): Promise<void> => {
    if (file === null || file.kind !== 'text' || !canEdit || savePending) return;
    const path = file.path;
    const stored = storedAfterEdit(file.content ?? '', editorText);
    const sentText = editorText;
    const key = `save-${Math.random().toString(36).slice(2)}`;
    setSavePending(true);
    notify(copy.saving(path));
    const put = (): Promise<{ file: TextFile; projectRevision: number }> =>
      api<{ file: TextFile; projectRevision: number }>(
        `/api/projects/${props.projectId}/files/${file.id}`,
        {
          method: 'PUT',
          body: { content: stored, baseRevision: (file as TextFile).revision },
          headers: { 'Idempotency-Key': key },
        },
      );
    try {
      let answer: { file: TextFile; projectRevision: number };
      try {
        answer = await put();
      } catch (failure) {
        if (!(failure instanceof NetworkFailure)) throw failure;
        await new Promise((resolve) => setTimeout(resolve, 2_000));
        answer = await put();
      }
      actions.current += 1;
      setFile(answer.file);
      const next = normalise(answer.file.content ?? '');
      setLoadedText(next);
      if (sentText === editorText) {
        setEditorText(next);
        setDirty(false);
      }
      notify(copy.saved(path, answer.projectRevision));
      void refresh();
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.code === 'stale_revision') {
        notify(copy.saveStale(path));
        setStale({ path, unsaved: editorText });
      } else if (failure instanceof ApiFailure && failure.field('content') !== null) {
        notify(copy.saveUnstorable(path));
      } else if (failure instanceof ApiFailure && failure.status === 403) {
        notify(copy.forbidden(role));
        void refresh();
      } else {
        notify(copy.saveFailed);
      }
    } finally {
      setSavePending(false);
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void save();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [save]);

  const storedSelection = (): { from: number; to: number } | null => {
    if (selection === null || file === null || file.kind !== 'text') return null;
    const stored = file.content ?? '';
    return {
      from: storedOffsetOf(stored, selection.from),
      to: storedOffsetOf(stored, selection.to),
    };
  };

  const addSuggestion = async (replacement: string): Promise<boolean> => {
    const anchor = storedSelection();
    if (anchor === null || file === null || file.kind !== 'text') return false;
    notify(copy.sending);
    try {
      const answer = await api<{ suggestion: Suggestion }>(
        `/api/projects/${props.projectId}/files/${file.id}/suggestions`,
        {
          method: 'POST',
          body: {
            baseRevision: file.revision,
            from: anchor.from,
            to: anchor.to,
            inserted: replacement,
          },
        },
      );
      actions.current += 1;
      notify(copy.suggestionAdded);
      setDialog(null);
      await refresh();
      setFocusedCard(answer.suggestion.id);
      if (props.mode === 'phone') setPanel('margin');
      window.requestAnimationFrame(() => {
        document.querySelector<HTMLElement>(`[data-card="${answer.suggestion.id}"]`)?.focus();
      });
      return true;
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.code === 'stale_revision') {
        notify(copy.passageChanged);
        return true;
      }
      if (failure instanceof ApiFailure && failure.status === 403) {
        setDialog(null);
        context.forbidden();
        return true;
      }
      if (failure instanceof ApiFailure && failure.field('inserted') !== null) return false;
      notify(copy.somethingWrong);
      return true;
    }
  };

  const addThread = async (body: string): Promise<boolean> => {
    const anchor = storedSelection();
    if (anchor === null || file === null || file.kind !== 'text') return false;
    if (body.trim() === '') return false;
    notify(copy.sending);
    try {
      const answer = await api<{ thread: Thread }>(
        `/api/projects/${props.projectId}/files/${file.id}/threads`,
        {
          method: 'POST',
          body: { baseRevision: file.revision, from: anchor.from, to: anchor.to, body },
        },
      );
      actions.current += 1;
      notify(copy.commentPosted);
      setDialog(null);
      await refresh();
      setFocusedCard(answer.thread.id);
      if (props.mode === 'phone') setPanel('margin');
      window.requestAnimationFrame(() => {
        document.querySelector<HTMLElement>(`[data-card="${answer.thread.id}"]`)?.focus();
      });
      return true;
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.code === 'stale_revision') {
        notify(copy.passageChanged);
        return true;
      }
      if (failure instanceof ApiFailure && failure.status === 403) {
        setDialog(null);
        context.forbidden();
        return true;
      }
      if (failure instanceof ApiFailure && failure.field('body') !== null) return false;
      notify(copy.somethingWrong);
      return true;
    }
  };

  const cards = useMemo((): MarginCardModel[] => {
    const list: MarginCardModel[] = [];
    const stored = file !== null && file.kind === 'text' ? (file.content ?? '') : '';
    const lineOf = (from: number | null): number | null => {
      if (from === null) return null;
      return lineOfOffset(loadedText, normalisedOffsetOf(stored, from));
    };

    for (const suggestion of review.suggestions) {
      if (suggestion.status !== 'orphaned') continue;
      list.push({
        id: suggestion.id,
        kind: 'suggestion',
        name: suggestion.author.displayName,
        handle: suggestion.author.handle ?? null,
        createdAt: suggestion.createdAt,
        anchorLine: null,
        deleted: suggestion.deleted,
        inserted: suggestion.inserted,
        quote: null,
        comments: [],
        stub: null,
        pending: false,
        canResolve: false,
        canReply: false,
        orphaned: true,
      });
    }
    for (const thread of review.threads) {
      if (!thread.orphaned || thread.status === 'resolved') continue;
      list.push({
        id: thread.id,
        kind: 'thread',
        name: thread.comments[0]?.author.displayName ?? '',
        handle: thread.comments[0]?.author.handle ?? null,
        createdAt: thread.comments[0]?.createdAt ?? null,
        anchorLine: null,
        deleted: null,
        inserted: null,
        quote: thread.quote,
        comments: thread.comments.map((comment) => ({
          id: comment.id,
          name: comment.author.displayName,
          handle: comment.author.handle ?? null,
          body: comment.body,
        })),
        stub: null,
        pending: false,
        canResolve: canResolve,
        canReply: canReview,
        orphaned: true,
      });
    }

    if (file !== null && file.kind === 'text') {
      interface Entry {
        from: number;
        kindOrder: number;
        createdAt: number;
        id: string;
        card: MarginCardModel;
      }
      const anchored: Entry[] = [];
      for (const suggestion of review.suggestions) {
        if (suggestion.fileId !== file.id || suggestion.status === 'orphaned') continue;
        const stub = stubs[suggestion.id] ?? null;
        if (suggestion.status !== 'open' && stub === null) continue;
        anchored.push({
          from: suggestion.from ?? 0,
          kindOrder: 0,
          createdAt: new Date(suggestion.createdAt).getTime(),
          id: suggestion.id,
          card: {
            id: suggestion.id,
            kind: 'suggestion',
            name: suggestion.author.displayName,
            handle: suggestion.author.handle ?? null,
            createdAt: suggestion.createdAt,
            anchorLine: lineOf(suggestion.from),
            deleted: suggestion.deleted,
            inserted: suggestion.inserted,
            quote: null,
            comments: [],
            stub,
            pending: pendingCards[suggestion.id] === true,
            canResolve,
            canReply: false,
            orphaned: false,
          },
        });
      }
      for (const thread of review.threads) {
        if (thread.fileId !== file.id || thread.orphaned) continue;
        const stub = stubs[thread.id] ?? null;
        if (thread.status !== 'open' && stub === null) continue;
        anchored.push({
          from: thread.from ?? 0,
          kindOrder: 1,
          createdAt: threadCreatedAt(thread),
          id: thread.id,
          card: {
            id: thread.id,
            kind: 'thread',
            name: thread.comments[0]?.author.displayName ?? '',
            handle: thread.comments[0]?.author.handle ?? null,
            createdAt: thread.comments[0]?.createdAt ?? null,
            anchorLine: lineOf(thread.from),
            deleted: null,
            inserted: null,
            quote: thread.quote,
            comments: thread.comments.map((comment) => ({
              id: comment.id,
              name: comment.author.displayName,
              handle: comment.author.handle ?? null,
              body: comment.body,
            })),
            stub,
            pending: false,
            canResolve,
            canReply: canReview,
            orphaned: false,
          },
        });
      }
      anchored.sort((left, right) => {
        if (left.from !== right.from) return left.from - right.from;
        if (left.kindOrder !== right.kindOrder) return left.kindOrder - right.kindOrder;
        if (left.createdAt !== right.createdAt) return left.createdAt - right.createdAt;
        return left.id < right.id ? -1 : 1;
      });
      list.push(...anchored.map((entry) => entry.card));
    }
    return list;
  }, [review, file, loadedText, stubs, pendingCards, canResolve, canReview]);

  useCardFocusKeys('.margin', cards);

  const marks = useMemo((): SourceMark[] => {
    if (file === null || file.kind !== 'text') return [];
    const stored = file.content ?? '';
    const result: SourceMark[] = [];
    for (const suggestion of review.suggestions) {
      if (suggestion.fileId !== file.id || suggestion.status !== 'open') continue;
      if (suggestion.from === null || suggestion.to === null) continue;
      const isSettling = settling?.id === suggestion.id;
      if (stubs[suggestion.id] !== undefined && !isSettling) continue;
      result.push({
        kind: 'deleted',
        from: normalisedOffsetOf(stored, suggestion.from),
        to: normalisedOffsetOf(stored, suggestion.to),
        collapsing: isSettling && settling?.outcome === 'accept',
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
  }, [review, file, stubs, settling]);

  const ghosts = useMemo((): SourceGhost[] => {
    if (file === null || file.kind !== 'text') return [];
    const stored = file.content ?? '';
    return review.suggestions
      .filter(
        (suggestion) =>
          suggestion.fileId === file.id &&
          suggestion.status === 'open' &&
          suggestion.to !== null &&
          suggestion.inserted !== '' &&
          (stubs[suggestion.id] === undefined || settling?.id === suggestion.id),
      )
      .map((suggestion) => ({
        id: suggestion.id,
        at: normalisedOffsetOf(stored, suggestion.to as number),
        text: suggestion.inserted,
        state:
          settling?.id === suggestion.id
            ? settling.outcome === 'accept'
              ? ('settled' as const)
              : ('collapsing' as const)
            : ('open' as const),
      }));
  }, [review, file, stubs, settling]);

  const focusNextOpenCard = (foldedId: string): void => {
    const open = cards.filter((card) => card.stub === null && !card.orphaned && card.id !== foldedId);
    const index = cards.findIndex((card) => card.id === foldedId);
    const after = open.find((card) => cards.findIndex((entry) => entry.id === card.id) > index);
    const before = [...open]
      .reverse()
      .find((card) => cards.findIndex((entry) => entry.id === card.id) < index);
    const target = after ?? before ?? null;
    if (target === null) {
      if (props.mode === 'phone') setPanel('source');
      window.requestAnimationFrame(() => sourceRef.current?.focus());
      return;
    }
    setFocusedCard(target.id);
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-card="${target.id}"]`)?.focus();
    });
  };

  const resolveSuggestion = async (id: string, outcome: 'accept' | 'reject'): Promise<void> => {
    const hadFocus = document.activeElement;
    pressedButton.current = hadFocus instanceof HTMLElement ? hadFocus : null;
    lastResolution.current = id;
    setPendingCards((previous) => ({ ...previous, [id]: true }));
    notify(outcome === 'accept' ? copy.accepting : copy.rejecting);
    try {
      const answer = await api<{
        suggestion: Suggestion;
        file?: TextFile;
        projectRevision: number;
        openSuggestions: number;
      }>(`/api/projects/${props.projectId}/suggestions/${id}/${outcome}`, {
        method: 'POST',
        body: {},
      });
      actions.current += 1;
      const stubName = answer.suggestion.resolvedBy?.displayName ?? props.user.displayName;
      const apply = (): void => {
        setStubs((previous) => ({
          ...previous,
          [id]: outcome === 'accept' ? `Accepted by ${stubName}` : `Rejected by ${stubName}`,
        }));
        if (answer.file !== undefined) {
          setFile((previous) =>
            previous !== null &&
            previous.kind === 'text' &&
            previous.id === answer.file?.id &&
            previous.revision < (answer.file?.revision ?? 0)
              ? answer.file
              : previous,
          );
          if (file !== null && file.kind === 'text' && file.id === answer.file.id && !dirty) {
            const next = normalise(answer.file.content ?? '');
            setLoadedText(next);
            setEditorText(next);
          }
        }
      };
      if (reducedMotion) apply();
      else {
        setStubs((previous) => ({
          ...previous,
          [id]: outcome === 'accept' ? `Accepted by ${stubName}` : `Rejected by ${stubName}`,
        }));
        setSettling({ id, outcome });
        window.setTimeout(() => {
          setSettling((previous) => (previous?.id === id ? null : previous));
          apply();
        }, 220);
      }
      if (lastResolution.current === id) {
        notify(
          outcome === 'accept'
            ? copy.accepted(answer.openSuggestions)
            : copy.rejected(answer.openSuggestions),
        );
      }
      const focusWasOnCard =
        pressedButton.current?.closest(`[data-card="${id}"]`) !== null &&
        pressedButton.current !== null;
      if (focusWasOnCard) focusNextOpenCard(id);
      void refresh();
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.code === 'suggestion_closed') {
        const winner = failure.body.suggestion as Suggestion;
        const name = winner.resolvedBy?.displayName ?? '';
        if (winner.status === 'orphaned') {
          if (lastResolution.current === id) notify(copy.suggestionOrphaned);
        } else {
          setStubs((previous) => ({
            ...previous,
            [id]: `${winner.status === 'accepted' ? 'Accepted' : 'Rejected'} by ${name}`,
          }));
          if (lastResolution.current === id) notify(copy.alreadyDecided(winner.status, name));
        }
        if (winner.status === 'accepted' && file !== null && !dirty) {
          await loadFile(file.id, { keepCaret: true });
        }
        focusNextOpenCard(id);
        void refresh();
      } else if (failure instanceof NetworkFailure) {
        if (lastResolution.current === id) notify(copy.resolutionDropped);
        window.requestAnimationFrame(() => pressedButton.current?.focus());
      } else if (failure instanceof ApiFailure && failure.status === 403) {
        context.forbidden();
      } else {
        notify(copy.somethingWrong);
      }
    } finally {
      setPendingCards((previous) => ({ ...previous, [id]: false }));
    }
  };

  const postReply = async (threadId: string, body: string): Promise<void> => {
    if (body.trim() === '') return;
    notify(copy.sending);
    try {
      await api(`/api/projects/${props.projectId}/threads/${threadId}/comments`, {
        method: 'POST',
        body: { body },
      });
      actions.current += 1;
      notify(copy.replyPosted);
      setReplyDrafts((previous) => ({ ...previous, [threadId]: '' }));
      void refresh();
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.code === 'thread_resolved') {
        notify(copy.threadAlreadyResolved);
      } else if (failure instanceof ApiFailure && failure.status === 403) {
        context.forbidden();
      } else {
        notify(copy.somethingWrong);
      }
    }
  };

  const resolveThread = async (threadId: string): Promise<void> => {
    notify(copy.sending);
    try {
      const answer = await api<{ thread: Thread }>(
        `/api/projects/${props.projectId}/threads/${threadId}/resolve`,
        { method: 'POST', body: {} },
      );
      actions.current += 1;
      notify(copy.threadResolved);
      setStubs((previous) => ({
        ...previous,
        [threadId]: `Resolved by ${answer.thread.resolvedBy?.displayName ?? props.user.displayName}`,
      }));
      focusNextOpenCard(threadId);
      void refresh();
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.code === 'thread_resolved') {
        notify(copy.threadAlreadyResolved);
      } else if (failure instanceof ApiFailure && failure.status === 403) {
        context.forbidden();
      } else {
        notify(copy.somethingWrong);
      }
    }
  };

  const deleteOpenFile = async (): Promise<void> => {
    if (file === null) return;
    const path = file.path;
    notify(copy.deletingFile(path));
    try {
      await api(`/api/projects/${props.projectId}/files/${file.id}`, { method: 'DELETE' });
      actions.current += 1;
      notify(copy.deletedFile(path));
      setDialog(null);
      const answer = await api<{ project: ProjectSummary; files: ProjectFile[] }>(
        `/api/projects/${props.projectId}`,
      );
      setFiles(answer.files);
      setProject(answer.project);
      const next =
        answer.files.find((entry) => entry.path === 'main.tex') ?? answer.files[0] ?? null;
      if (next !== null) {
        replace(projectUrl(props.projectId, { file: next.path }));
        await loadFile(next.id, { keepCaret: false });
        window.requestAnimationFrame(() => sourceRef.current?.focus());
      }
      void refresh();
    } catch (failure) {
      setDialog(null);
      if (failure instanceof ApiFailure && failure.status === 403) context.forbidden();
      else notify(copy.somethingWrong);
    }
  };

  const chooseWarning = (warning: CitationWarning): void => {
    setDialog(null);
    push(projectUrl(props.projectId, { file: warning.path, line: warning.line }));
  };

  const sections = useMemo(() => sectionsOf(editorText), [editorText]);
  const citationCount = citations?.undefined.length ?? 0;

  const toolbarButton = (
    key: string,
    label: string,
    onClick: () => void,
    disabled?: boolean,
  ): JSX.Element => (
    <button
      key={key}
      type="button"
      ref={(element) => {
        toolbarRefs.current[key] = element;
      }}
      disabled={disabled}
      onClick={onClick}
    >
      {TOOLBAR_ICONS[key]}
      {label}
    </button>
  );

  const actionsList: { key: string; label: string; run: () => void; disabled?: boolean }[] = [
    ...(canEdit
      ? [{ key: 'save', label: 'Save', run: () => void save(), disabled: savePending }]
      : []),
    ...(canReview
      ? [
          {
            key: 'suggest',
            label: 'Suggest edit',
            run: () => setDialog('suggest'),
            disabled: selection === null,
          },
          {
            key: 'comment',
            label: 'Comment',
            run: () => setDialog('comment'),
            disabled: selection === null || selection.from === selection.to,
          },
        ]
      : []),
    ...(canEdit
      ? [
          { key: 'newFile', label: 'New file', run: () => setDialog('newFile') },
          { key: 'upload', label: 'Upload file', run: () => setDialog('upload') },
        ]
      : []),
    { key: 'citations', label: 'Citation warnings', run: () => setDialog('citations') },
    { key: 'history', label: 'History', run: () => setDialog('history') },
    { key: 'people', label: 'People and sharing', run: () => setDialog('people') },
    ...(canEdit
      ? [{ key: 'submission', label: 'Submission check', run: () => setDialog('submission') }]
      : []),
  ];

  const quote =
    file !== null && file.kind === 'text' && selection !== null
      ? editorText.slice(selection.from, selection.to)
      : '';

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
      <div className="toolbar">
        <a
          href="/"
          onClick={(event) => {
            event.preventDefault();
            push('/');
          }}
        >
          Projects
        </a>
        <span className="project-title">{project?.title ?? ''}</span>
        {props.mode !== 'desktop'
          ? toolbarButton('files', 'Files', () => setDialog('files'))
          : null}
        {props.mode === 'phone' ? (
          <>
            {canEdit
              ? toolbarButton('save', 'Save', () => void save(), savePending)
              : null}
            <MoreMenu
              actions={actionsList
                .filter((action) => action.key !== 'save')
                .map((action) => ({
                  label: action.label,
                  disabled: action.disabled,
                  run: action.run,
                }))}
            />
          </>
        ) : (
          actionsList.map((action) =>
            toolbarButton(action.key, action.label, action.run, action.disabled),
          )
        )}
        {dirty ? <span className="unsaved">{copy.unsavedChanges}</span> : null}
        <span role="status" aria-label="Citation check" className="live-region">
          {copy.citationCheck(citationCount)}
        </span>
      </div>

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
            <FileTree files={files} openPath={file?.path ?? null} onOpen={openFile} />
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
              {canEdit && file !== null ? (
                <button
                  type="button"
                  ref={(element) => {
                    toolbarRefs.current.delete = element;
                  }}
                  aria-label={`Delete ${file.path}`}
                  onClick={() => setDialog('delete')}
                >
                  Delete
                </button>
              ) : null}
            </div>
            {file !== null && file.kind === 'asset' ? (
              <div className="figure-preview">
                {previewUrls[file.id] !== undefined ? (
                  <img src={previewUrls[file.id]} alt={file.path} />
                ) : previewFailed[file.id] === true ? (
                  <p>{copy.figureUnavailable}</p>
                ) : null}
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
                  text={editorText}
                  editable={canEdit}
                  marks={marks}
                  ghosts={ghosts}
                  onInput={(next) => {
                    setEditorText(next);
                    setDirty(next !== loadedText);
                  }}
                  onSelectionChange={() => {
                    const current = sourceRef.current?.selection() ?? null;
                    if (current !== null) setSelection(current);
                  }}
                  onLayoutChange={measure}
                />
              </div>
            )}
            <div className="status-line">
              <span role="status" aria-label="Project updates" className="live-region">
                {status}
              </span>
              <span role="status" aria-label="Storage status" className="live-region">
                {storage}
              </span>
            </div>
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
              onAccept={(id) => void resolveSuggestion(id, 'accept')}
              onReject={(id) => void resolveSuggestion(id, 'reject')}
              onReply={(id, body) => void postReply(id, body)}
              onResolve={(id) => void resolveThread(id)}
              replyDrafts={replyDrafts}
              onReplyDraft={(id, value) => {
                setReplyDrafts((previous) => ({ ...previous, [id]: value }));
                setMentionOwner(id);
                mentions.sync(id, value, value.length);
              }}
              onReplyKeyDown={(id, event) => {
                if (mentions.state.owner !== id) return;
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  mentions.move(1);
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  mentions.move(-1);
                } else if (event.key === 'Enter' || event.key === 'Tab') {
                  event.preventDefault();
                  const next = mentions.choose(replyDrafts[id] ?? '');
                  if (next !== null) {
                    setReplyDrafts((previous) => ({ ...previous, [id]: next.value }));
                  }
                }
              }}
              mentionFor={mentionOwner}
              mentionList={
                <MentionList
                  api={mentions}
                  onChoose={(handle) => {
                    const id = mentions.state.owner;
                    if (id === null) return;
                    const next = mentions.choose(replyDrafts[id] ?? '', handle);
                    if (next !== null) {
                      setReplyDrafts((previous) => ({ ...previous, [id]: next.value }));
                    }
                  }}
                />
              }
            />
          </div>
        ) : null}
      </div>

      {dialog === 'files' ? (
        <Dialog
          name="Project files"
          onClose={() => setDialog(null)}
          returnFocusTo={() => toolbarRefs.current.files}
        >
          <h2>Project files</h2>
          <FileTree files={files} openPath={file?.path ?? null} onOpen={openFile} />
          <ul className="ruled-list" aria-label="Sections">
            {sections.map((section) => (
              <li key={`${section.line}-${section.title}`}>
                <button
                  type="button"
                  onClick={() => {
                    setDialog(null);
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
      {dialog === 'newFile' ? (
        <NewFileDialog
          context={context}
          onClose={() => setDialog(null)}
          returnFocusTo={() => toolbarRefs.current.newFile ?? null}
          onCreated={(created) => openFile(created.path)}
        />
      ) : null}
      {dialog === 'upload' ? (
        <UploadDialog
          context={context}
          onClose={() => setDialog(null)}
          returnFocusTo={() => toolbarRefs.current.upload ?? null}
          onUploaded={(path) => {
            openFile(path);
            if (props.mode === 'desktop') {
              focusWhenPresent(`.left-rail [role="treeitem"][aria-label="${path}"]`);
            }
          }}
        />
      ) : null}
      {dialog === 'suggest' ? (
        <SuggestDialog
          quote={quote}
          onClose={() => setDialog(null)}
          returnFocusTo={() => toolbarRefs.current.suggest ?? null}
          onSubmit={addSuggestion}
        />
      ) : null}
      {dialog === 'comment' ? (
        <CommentDialog
          quote={quote}
          mentions={mentions}
          onClose={() => setDialog(null)}
          returnFocusTo={() => toolbarRefs.current.comment ?? null}
          onSubmit={addThread}
        />
      ) : null}
      {dialog === 'history' ? (
        <HistoryDialog
          context={context}
          role={role}
          onClose={() => setDialog(null)}
          returnFocusTo={() => toolbarRefs.current.history ?? null}
        />
      ) : null}
      {dialog === 'people' ? (
        <PeopleDialog
          context={context}
          role={role}
          onClose={() => setDialog(null)}
          returnFocusTo={() => toolbarRefs.current.people ?? null}
        />
      ) : null}
      {dialog === 'citations' ? (
        <CitationsDialog
          report={citations}
          onClose={() => setDialog(null)}
          returnFocusTo={() => toolbarRefs.current.citations ?? null}
          onChoose={chooseWarning}
        />
      ) : null}
      {dialog === 'submission' ? (
        <SubmissionDialog
          context={context}
          readiness={readiness}
          projectRevision={project?.projectRevision ?? 0}
          onClose={() => setDialog(null)}
          returnFocusTo={() => toolbarRefs.current.submission ?? null}
          onReadiness={setReadiness}
        />
      ) : null}
      {dialog === 'delete' && file !== null ? (
        <DeleteConfirm
          path={file.path}
          onClose={() => setDialog(null)}
          returnFocusTo={() => toolbarRefs.current.delete ?? null}
          onConfirm={() => void deleteOpenFile()}
        />
      ) : null}
      {stale !== null ? (
        <StaleSaveDialog
          path={stale.path}
          unsaved={stale.unsaved}
          onClose={() => setStale(null)}
          onLoadLatest={() => {
            setStale(null);
            if (file !== null) {
              setDirty(false);
              void loadFile(file.id, { keepCaret: false, force: true });
            }
          }}
        />
      ) : null}
    </div>
  );
}
