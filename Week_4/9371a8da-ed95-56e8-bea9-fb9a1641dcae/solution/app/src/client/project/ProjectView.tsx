import type { JSX } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import type { CitationReport, Member, ProjectFile, ProjectSummary, Role, TextFile } from "../../shared/api.ts";
import { carryCaret, moveSuggestionAnchor, moveThreadAnchor, replacedSpan, type ReplacedSpan } from "../../shared/anchors.ts";
import { api, type ApiResult, get, NetworkError, post, retryKey } from "../api.ts";
import { anyDialogOpen, focusOnClose } from "../dialog.tsx";
import { Icon, type IconName } from "../icons.tsx";
import { actions as clock } from "../latest.ts";
import { navigate, setAccessNotice, signInFor, currentLocation } from "../router.ts";
import { lastLineAtMost, lineBreakOf, lineOf, lineStart, offsetMap, reducedMotion, toView } from "../text.ts";
import { Editor, type InsertPoint, type Mark } from "./Editor.tsx";
import { FigurePreview } from "./Figure.tsx";
import { Card, type CardActions, type CardItem, placeCards } from "./Margin.tsx";
import { FileTree } from "./Tree.tsx";
import {
  canEdit,
  canSuggest,
  citationCopy,
  type DialogState,
  type NamedSuggestion,
  type NamedThread,
  type OpenDoc,
  openCount,
  type ReviewData,
  type Selection,
  SOMETHING_WRONG,
  STORAGE_DOWN,
  type ViewContext,
} from "./model.ts";
import {
  CitationsDialog,
  DeleteDialog,
  FilesDialog,
  NewFileDialog,
  SelectionDialog,
  StaleDialog,
  SubmissionDialog,
  UploadDialog,
} from "./dialogs.tsx";
import { HistoryDialog } from "./History.tsx";
import { PeopleDialog } from "./People.tsx";

type Mode = "member" | "share";
type Layout = "desktop" | "tablet" | "phone";

interface Info {
  title: string;
  projectRevision: number;
  role: Role | null;
}

/** What opening a file should do once its text is shown. */
interface View {
  line?: number;
  threadId?: string;
  orphanThread?: boolean;
  /** Focus the source, with the caret at the start of `line` or at offset 0. */
  focusSource?: boolean;
}

/** Dialogs that close when their submission answers the forbidden error. */
const CLOSED_BY_FORBIDDEN = new Set<DialogState["kind"]>(["suggest", "comment", "new-file", "upload", "delete", "history"]);

/** The text and marks frozen while accept and reject sequences play in the mirror; each animated suggestion carries its `anim`. */
interface Override {
  text: string;
  marks: Mark[];
  points: InsertPoint[];
}

/** Starts one suggestion's sequence inside the frozen marks, leaving every sequence already playing untouched. */
function playIn(override: Override, id: string, verb: "accept" | "reject"): Override {
  return {
    text: override.text,
    marks: override.marks.map((mark) => (mark.of === id ? { ...mark, anim: verb === "accept" ? "collapse" : "unstrike" } : mark)),
    points: override.points.map((point) =>
      point.of === id ? (verb === "accept" ? { ...point, inline: true, anim: "settle" } : { ...point, anim: "shrink" }) : point,
    ),
  };
}

/** The layout chosen for a window width. */
function layoutFor(width: number): Layout {
  if (width >= 1100) return "desktop";
  if (width >= 768) return "tablet";
  return "phone";
}

function defaultFile(files: ProjectFile[]): ProjectFile | undefined {
  return files.find((file) => file.path === "main.tex") ?? [...files].sort((a, b) => (a.path < b.path ? -1 : 1))[0];
}

const SECTION = /\\(chapter|section|subsection)\*?\{([^}\n]*)\}/;

export function ProjectView({ mode, id, search }: { mode: Mode; id: string; search: string }): JSX.Element {
  const base = mode === "member" ? `/api/projects/${id}` : `/api/share/${id}`;
  const shared = mode === "share";

  const [phase, setPhase] = useState<"loading" | "ready" | "dead" | "failed">("loading");
  const [info, setInfo] = useState<Info | null>(null);
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [review, setReview] = useState<ReviewData | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [citations, setCitations] = useState<CitationReport | null>(null);
  const [doc, setDoc] = useState<OpenDoc | null>(null);
  const [text, setText] = useState("");
  const [dirty, setDirty] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [folded, setFolded] = useState<Map<string, string>>(() => new Map());
  const [pending, setPending] = useState<ReadonlyMap<string, "accept" | "reject">>(() => new Map());
  const [busyThreads, setBusyThreads] = useState<Set<string>>(() => new Set());
  const [replies, setReplies] = useState<Map<string, string>>(() => new Map());
  const [focusedCard, setFocusedCard] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [updates, setUpdates] = useState("");
  const [storage, setStorage] = useState("");
  const [tab, setTab] = useState<"source" | "margin">("source");
  const [width, setWidth] = useState(() => innerWidth);
  const [override, setOverride] = useState<Override | null>(null);
  const [saving, setSaving] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [treeFocus, setTreeFocus] = useState<string | null>(null);
  const [menuFocus, setMenuFocus] = useState<"first" | "last" | null>(null);
  const [refreshes, setRefreshes] = useState(0);

  const layout = layoutFor(width);
  const role: Role | null = shared ? null : (info?.role ?? null);

  const sourceRef = useRef<HTMLTextAreaElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const alive = useRef(true);
  const prevTops = useRef(new Map<string, number>());
  const glide = useRef<{ delay: number } | null>(null);
  const fold = useRef(new Map<string, { height: number; delay: number }>());
  const pendingText = useRef<{ value: string; selection?: [number, number, "forward" | "backward" | "none"]; anchor?: { line: number; offset: number } } | null>(null);
  const pendingView = useRef<View | null>(null);
  /** Cards already placed for the open file; null until its rail is first placed. */
  const seenCards = useRef<Set<string> | null>(null);
  /** Where focus goes after the next render; `afterSequence` lets a phone's Margin tab show the folded stub until its sequence ends. */
  const pendingFocus = useRef<{ after?: string; card?: string; source?: boolean; afterSequence?: boolean; button?: { card: string; verb: "accept" | "reject" } } | null>(null);
  /** The number of the most recently sent resolution; only its answer speaks in Project updates and moves focus. */
  const lastResolution = useRef(0);
  /** Every animation of the sequences playing in the mirror; the mirror shows the live text once all have finished. */
  const sequenceRuns = useRef<Animation[]>([]);
  const roleSwap = useRef(false);
  /** A pointer is down in the margin: the focus it causes restacks the cards after its click. */
  const pressing = useRef(false);

  // The latest committed values, for code that resumes after an await.
  const live = useRef({ info, files, review, members, doc, dirty, dialog, role, layout, tab, folded, citations });
  live.current = { info, files, review, members, doc, dirty, dialog, role, layout, tab, folded, citations };

  const say = (message: string) => setUpdates(message);
  const sayStorage = (message: string) => setStorage(message);

  // ---- access and refresh -------------------------------------------------------------

  const toSignIn = () => navigate(signInFor(currentLocation()), true);

  const lostAccess = () => {
    const title = live.current.info?.title;
    setAccessNotice(title ? `You no longer have access to ${title}.` : "You do not have access to that project.");
    navigate("/");
  };

  const checkProject = async () => {
    try {
      const answer = await get<unknown>(base);
      if (!answer.ok && answer.status === 404) {
        if (shared) setPhase("dead");
        else lostAccess();
      } else void refresh();
    } catch {
      /* no answer: nothing changes */
    }
  };

  const reloadRole = async (): Promise<Role | null> => {
    try {
      const answer = await get<{ project: ProjectSummary }>(base);
      if (answer.ok) {
        const next = answer.data.project.role;
        setInfo((current) => (current ? { ...current, role: next } : current));
        live.current.role = next;
        roleSwap.current = true;
        return next;
      }
      if (answer.status === 404) lostAccess();
    } catch {
      /* keep the role on screen */
    }
    return live.current.role;
  };

  const forbidden = async () => {
    const open = live.current.dialog;
    if (open && CLOSED_BY_FORBIDDEN.has(open.kind)) setDialog(null);
    const next = await reloadRole();
    say(`You can no longer do that. Your role on this project is now ${next ?? "viewer"}.`);
    pendingFocus.current = { source: true };
    setTab("source");
  };

  const act = async <T,>(run: () => Promise<ApiResult<T>>): Promise<ApiResult<T> | null> => {
    let answer: ApiResult<T>;
    try {
      answer = await run();
    } catch {
      return null;
    }
    clock.answered();
    if (!answer.ok) {
      if (answer.status === 401) {
        toSignIn();
        return answer;
      }
      if (answer.status === 403 && (answer.error.error === "forbidden")) {
        await forbidden();
        return answer;
      }
      if (answer.status === 404) {
        void checkProject();
        return answer;
      }
    }
    void refresh();
    return answer;
  };

  const loadFileContent = async (fileId: string): Promise<TextFile | null> => {
    const answer = await get<{ file: TextFile }>(`${base}/files/${fileId}`);
    if (answer.ok) return answer.data.file;
    if (answer.status === 404) void checkProject();
    return null;
  };

  /** Load newer text in place, carrying the caret and selection through the replaced span. */
  const loadNewer = (file: TextFile) => {
    const current = live.current.doc;
    if (!current || current.file.id !== file.id || file.content === undefined) return;
    const view = toView(file.content);
    const element = sourceRef.current;
    let selectionCarry: [number, number, "forward" | "backward" | "none"] | undefined;
    let anchor: { line: number; offset: number } | undefined;
    const before = element ? element.value : current.view;
    const span = replacedSpan(before, view);
    if (element) {
      selectionCarry = [carryCaret(element.selectionStart, span), carryCaret(element.selectionEnd, span), element.selectionDirection];
      const top = topLine();
      if (top) {
        const startOfTop = lineStart(before, top.line);
        anchor = { line: lineOf(view, carryCaret(startOfTop, span)), offset: top.offset };
      }
    }
    pendingText.current = { value: view, ...(selectionCarry ? { selection: selectionCarry } : {}), ...(anchor ? { anchor } : {}) };
    glide.current = { delay: 0 };
    setDoc({ file, stored: file.content, view, revision: file.revision });
    setText(view);
    setDirty(false);
  };

  const applyReview = (next: ReviewData) => {
    const previous = live.current.review;
    if (previous && JSON.stringify(previous) === JSON.stringify(next)) return;
    const openDoc = live.current.doc;
    if (previous && openDoc) {
      const shown = new Set<string>();
      for (const s of previous.suggestions) if (s.fileId === openDoc.file.id && s.status === "open") shown.add(s.id);
      for (const t of previous.threads) if (t.fileId === openDoc.file.id && t.status === "open" && !t.orphaned) shown.add(t.id);
      const stubs = new Map(live.current.folded);
      let changed = false;
      for (const s of next.suggestions) {
        if (shown.has(s.id) && (s.status === "accepted" || s.status === "rejected") && !stubs.has(s.id)) {
          stubs.set(s.id, `${s.status === "accepted" ? "Accepted" : "Rejected"} by ${s.resolvedBy?.displayName ?? ""}`);
          changed = true;
        }
      }
      for (const t of next.threads) {
        if (shown.has(t.id) && t.status === "resolved" && !stubs.has(t.id)) {
          stubs.set(t.id, `Resolved by ${t.resolvedBy?.displayName ?? ""}`);
          changed = true;
        }
      }
      if (changed) {
        setFolded(stubs);
        glide.current = { delay: 0 };
        const focused = document.activeElement?.closest<HTMLElement>("[data-card-id]")?.dataset.cardId;
        if (focused && stubs.has(focused)) pendingFocus.current = { after: focused };
      }
    }
    setReview(next);
  };

  const refresh = async () => {
    const sent = clock.now();
    try {
      const [project, nextReview, nextMembers] = await Promise.all([
        get<{ project?: ProjectSummary; files: ProjectFile[] } & { project: { title: string; projectRevision: number } }>(base),
        get<ReviewData>(`${base}/review`),
        shared ? Promise.resolve(null) : get<{ members: Member[] }>(`${base}/members`),
      ]);
      if (!alive.current || !clock.current(sent)) return;
      setRefreshes((count) => count + 1);
      for (const answer of [project, nextReview, nextMembers]) {
        if (answer && !answer.ok) {
          if (answer.status === 401 && !shared) toSignIn();
          else if (answer.status === 404) {
            if (shared) setPhase("dead");
            else void checkProject();
          }
          return;
        }
      }
      if (!project.ok || !nextReview.ok) return;
      const data = project.data;
      const known = live.current.info;
      const nextRevision = Math.max(known?.projectRevision ?? 0, data.project.projectRevision);
      const nextRole = shared ? null : ((data.project as ProjectSummary).role ?? null);
      if (!shared && known && known.role && nextRole && nextRole !== known.role) {
        say(`Your role on this project is now ${nextRole}.`);
        roleSwap.current = true;
      }
      if (!known || known.title !== data.project.title || known.projectRevision !== nextRevision || known.role !== nextRole) {
        setInfo({ title: data.project.title, projectRevision: nextRevision, role: nextRole });
      }
      if (JSON.stringify(data.files) !== JSON.stringify(live.current.files)) setFiles(data.files);
      applyReview(nextReview.data);
      if (nextMembers && nextMembers.ok && JSON.stringify(nextMembers.data.members) !== JSON.stringify(live.current.members)) {
        setMembers(nextMembers.data.members);
      }
      const openDoc = live.current.doc;
      if (openDoc) {
        const listed = data.files.find((file) => file.id === openDoc.file.id);
        if (!listed) {
          const fallback = defaultFile(data.files);
          if (fallback) void openFile(fallback, {});
        } else if (listed.kind === "text" && listed.revision > openDoc.revision) {
          const blocked = live.current.dirty || ["suggest", "comment", "stale"].includes(live.current.dialog?.kind ?? "");
          if (!blocked) {
            const file = await loadFileContent(listed.id);
            if (file && alive.current && clock.current(sent) && !live.current.dirty) loadNewer(file);
          }
        }
      }
      if (live.current.citations?.projectRevision !== data.project.projectRevision) {
        const report = await get<CitationReport>(`${base}/citations`);
        if (report.ok && clock.current(sent)) {
          const shown = live.current.citations;
          if (!shown || report.data.projectRevision >= shown.projectRevision) setCitations(report.data);
        }
      }
    } catch (error) {
      if (!(error instanceof NetworkError)) throw error;
    }
  };

  // ---- opening files and reading the address -----------------------------------------

  const openFile = async (file: ProjectFile, view: View) => {
    const current = live.current.doc;
    if (current && current.file.id === file.id) {
      pendingView.current = view;
      setFocusedCard(null);
      forceRender();
      return;
    }
    if (file.kind === "asset") {
      setDoc({ file, stored: "", view: "", revision: 0 });
      setText("");
    } else {
      let loaded: TextFile | null = null;
      try {
        loaded = await loadFileContent(file.id);
      } catch {
        return;
      }
      if (!loaded || loaded.content === undefined || !alive.current) return;
      const shownView = toView(loaded.content);
      pendingText.current = { value: shownView };
      setDoc({ file: loaded, stored: loaded.content, view: shownView, revision: loaded.revision });
      setText(shownView);
    }
    pendingView.current = view;
    setDirty(false);
    setSelection(null);
    setFolded(new Map());
    setFocusedCard(null);
    prevTops.current = new Map();
    seenCards.current = null;
  };

  const [, setTick] = useState(0);
  const forceRender = () => setTick((tick) => tick + 1);

  const applyLocation = (where: string, data: { files: ProjectFile[]; review: ReviewData | null }, focusSource = false) => {
    const params = new URLSearchParams(where);
    const threadId = params.get("thread");
    const path = params.get("file");
    const line = Number(params.get("line")) || undefined;
    const fallback = defaultFile(data.files);
    if (threadId) {
      const thread = data.review?.threads.find((item) => item.id === threadId);
      if (!thread) {
        if (fallback) void openFile(fallback, {});
        say("That comment is no longer available");
        return;
      }
      const home = data.files.find((file) => file.id === thread.fileId) ?? fallback;
      if (!home) return;
      if (thread.status === "resolved") {
        void openFile(home, {});
        say(`This thread was resolved by ${thread.resolvedBy?.displayName ?? ""}`);
        return;
      }
      void openFile(home, { threadId, orphanThread: thread.orphaned });
      return;
    }
    const chosen = (path && data.files.find((file) => file.path === path)) || fallback;
    if (chosen) void openFile(chosen, { ...(line ? { line } : {}), focusSource: focusSource || line !== undefined });
  };

  const fileUrl = (path: string, line?: number) =>
    `/${shared ? "s" : "p"}/${id}?file=${encodeURIComponent(path).replace(/%2F/g, "/")}${line ? `&line=${line}` : ""}`;

  /** Push a view address as a new history entry; the same address again still reopens its view. */
  const goTo = (url: string, focusSource = false) => {
    const sameSearch = new URL(url, location.origin).search === location.search;
    navigate(url);
    if (sameSearch) applyLocation(location.search, { files: live.current.files, review: live.current.review }, focusSource);
    else focusAfterNavigate.current = focusSource;
  };
  const focusAfterNavigate = useRef(false);

  const chooseFile = (file: ProjectFile) => {
    setMoreOpen(false);
    if (live.current.dialog?.kind === "files") {
      focusOnClose(() => document.querySelector<HTMLElement>("[data-files-button]"));
      setDialog(null);
    }
    goTo(fileUrl(file.path));
  };

  // ---- first load, address changes, timers, resize ------------------------------------

  useLayoutEffect(() => {
    alive.current = true;
    void (async () => {
      try {
        const first = await get<{ project: ProjectSummary & { title: string; projectRevision: number }; files: ProjectFile[] }>(base);
        if (!first.ok) {
          if (first.status === 401 && !shared) toSignIn();
          else if (first.status === 404) {
            if (shared) setPhase("dead");
            else lostAccess();
          } else setPhase("failed");
          return;
        }
        const [firstReview, firstMembers, report] = await Promise.all([
          get<ReviewData>(`${base}/review`),
          shared ? Promise.resolve(null) : get<{ members: Member[] }>(`${base}/members`),
          get<CitationReport>(`${base}/citations`),
        ]);
        if (!alive.current) return;
        const reviewData = firstReview.ok ? firstReview.data : null;
        setInfo({
          title: first.data.project.title,
          projectRevision: first.data.project.projectRevision,
          role: shared ? null : first.data.project.role,
        });
        setFiles(first.data.files);
        setReview(reviewData);
        if (firstMembers?.ok) setMembers(firstMembers.data.members);
        if (report.ok) setCitations(report.data);
        live.current.files = first.data.files;
        live.current.review = reviewData;
        setPhase("ready");
        applyLocation(location.search, { files: first.data.files, review: reviewData }, true);
      } catch {
        setPhase("failed");
      }
    })();
    const timer = setInterval(() => void refresh(), 5000);
    const onResize = () => {
      const next = layoutFor(innerWidth);
      if (next === "phone" && live.current.layout !== "phone") {
        setTab(document.activeElement?.closest(".margin") ? "margin" : "source");
      }
      glide.current = { delay: 0 };
      setWidth(innerWidth);
    };
    addEventListener("resize", onResize);
    void document.fonts?.ready.then(() => {
      if (!alive.current) return;
      glide.current = { delay: 0 };
      forceRender();
    });
    return () => {
      alive.current = false;
      clearInterval(timer);
      removeEventListener("resize", onResize);
    };
  }, [base]);

  const lastSearch = useRef(search);
  useLayoutEffect(() => {
    if (lastSearch.current === search) return;
    lastSearch.current = search;
    const focusSource = focusAfterNavigate.current;
    focusAfterNavigate.current = false;
    if (phase === "ready") applyLocation(search, { files: live.current.files, review: live.current.review }, focusSource);
  }, [search]);

  // Crossing a breakpoint: keep the focused element's panel on phones; desktop closes Project files.
  const lastLayout = useRef(layout);
  useLayoutEffect(() => {
    if (lastLayout.current === layout) return;
    const before = lastLayout.current;
    lastLayout.current = layout;
    const active = document.activeElement as HTMLElement | null;
    if (layout === "phone" && active?.closest(".margin")) setTab("margin");
    if (layout === "desktop" && before !== "desktop" && live.current.dialog?.kind === "files") {
      setDialog(null);
      pendingFocus.current = null;
      requestTreeFocus();
    }
    setMoreOpen(false);
  }, [layout]);

  const requestTreeFocus = () => {
    const path = live.current.doc?.file.path ?? null;
    setTreeFocus(path);
  };

  // A press outside the open More menu closes it.
  useLayoutEffect(() => {
    if (!moreOpen) return;
    const outside = (event: PointerEvent) => {
      if (!(event.target as HTMLElement).closest(".more")) setMoreOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [moreOpen]);

  // Re-wrapping: whenever the source column changes width, gutter numbers and cards re-align.
  useLayoutEffect(() => {
    const column = scrollRef.current;
    if (!column || typeof ResizeObserver === "undefined") return;
    let width = column.clientWidth;
    let timer = 0;
    const observer = new ResizeObserver(() => {
      if (column.clientWidth === width) return;
      width = column.clientWidth;
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        glide.current = { delay: 0 };
        forceRender();
      }, 120);
    });
    observer.observe(column);
    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
  }, [phase, layout]);

  // Save shortcut.
  useLayoutEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (!anyDialogOpen()) void save();
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  });

  // ---- after every render: text, scroll, cards, focus ---------------------------------

  const topLine = (): { line: number; offset: number } | null => {
    const scroller = scrollRef.current;
    const mirror = mirrorRef.current;
    if (!scroller || !mirror) return null;
    const viewTop = scroller.getBoundingClientRect().top;
    for (const element of Array.from(mirror.children) as HTMLElement[]) {
      const box = element.getBoundingClientRect();
      if (box.bottom > viewTop) return { line: Number(element.dataset.ln), offset: box.top - viewTop };
    }
    return null;
  };

  const lineElement = (line: number) => mirrorRef.current?.querySelector<HTMLElement>(`[data-ln="${line}"]`) ?? null;

  const scrollLineToTop = (line: number) => {
    const scroller = scrollRef.current;
    const element = lineElement(line);
    if (!scroller || !element) return;
    scroller.scrollTop += element.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
  };

  useLayoutEffect(() => {
    const element = sourceRef.current;
    if (element && pendingText.current) {
      const next = pendingText.current;
      pendingText.current = null;
      if (element.value !== next.value) element.value = next.value;
      if (next.selection) element.setSelectionRange(...next.selection);
      if (next.anchor) {
        const scroller = scrollRef.current;
        const target = lineElement(next.anchor.line);
        if (scroller && target) {
          scroller.scrollTop += target.getBoundingClientRect().top - scroller.getBoundingClientRect().top - next.anchor.offset;
        }
      }
    }
    if (element && pendingView.current) {
      const view = pendingView.current;
      pendingView.current = null;
      if (view.line) {
        const line = lastLineAtMost(element.value, view.line);
        const at = lineStart(element.value, line);
        element.setSelectionRange(at, at);
        scrollLineToTop(line);
      } else if (view.focusSource) element.setSelectionRange(0, 0);
      if (view.threadId) pendingFocus.current = { card: view.threadId };
      else if (view.focusSource) pendingFocus.current = { source: true };
    } else if (!element && pendingView.current && live.current.doc?.file.kind === "asset") {
      const view = pendingView.current;
      pendingView.current = null;
      if (view.threadId) pendingFocus.current = { card: view.threadId };
    }

    // Cards follow their lines on desktop and tablet.
    const rail = railRef.current;
    if (rail && layout !== "phone") {
      const cardsBox = rail.querySelector<HTMLElement>(".cards");
      const railTop = () => (cardsBox ?? rail).getBoundingClientRect().top;
      placeCards({
        rail,
        lineTop: (line) => {
          const target = lineElement(line);
          return target ? target.getBoundingClientRect().top - railTop() : null;
        },
        focusedId: focusedCard,
        previous: prevTops.current,
        glide: glide.current,
        fold: fold.current,
        motion: !reducedMotion(),
        hovered,
        seen: seenCards.current,
      });
      glide.current = null;
      const seen = seenCards.current ?? new Set<string>();
      for (const card of Array.from(rail.querySelectorAll<HTMLElement>("[data-card-id]"))) seen.add(card.dataset.cardId as string);
      seenCards.current = seen;
    }

    // Each accept or reject sequence plays in the mirror from its own answer; the mirror shows the new text once all end.
    if (override && mirrorRef.current) {
      const mirror = mirrorRef.current;
      const runs: Animation[] = [];
      const easing = "cubic-bezier(.2,.7,.2,1)";
      const fresh = (selector: string) =>
        Array.from(mirror.querySelectorAll<HTMLElement>(selector)).filter((element) => element.dataset.played !== element.dataset.anim);
      const played = (element: HTMLElement, run: Animation) => {
        element.dataset.played = element.dataset.anim;
        runs.push(run);
      };
      fresh('[data-anim="collapse"], [data-anim="shrink"]').forEach((element) => {
        played(element, element.animate([{ width: `${element.offsetWidth}px`, opacity: 1 }, { width: "0px", opacity: 0 }], { duration: 200, easing, fill: "forwards" }));
      });
      fresh('[data-anim="settle"]').forEach((element) => {
        played(element, element.animate([{ textDecorationColor: "var(--ins)", opacity: 0.85 }, { textDecorationColor: "rgba(35,31,26,0)", opacity: 1 }], { duration: 200, delay: 200, easing, fill: "both" }));
      });
      fresh('[data-anim="unstrike"]').forEach((element) => {
        played(element, element.animate([{ color: "var(--accent)", textDecorationColor: "var(--accent)", opacity: 0.85 }, { color: "var(--ink)", textDecorationColor: "rgba(125,34,48,0)", opacity: 1 }], { duration: 200, delay: 200, easing, fill: "both" }));
      });
      if (runs.length) {
        sequenceRuns.current.push(...runs);
        void Promise.allSettled(runs.map((run) => run.finished)).then(() => {
          if (!alive.current || sequenceRuns.current.some((run) => run.playState === "running")) return;
          sequenceRuns.current.forEach((run) => run.cancel());
          sequenceRuns.current = [];
          mirror.querySelectorAll<HTMLElement>("[data-played]").forEach((element) => delete element.dataset.played);
          setOverride(null);
        });
      }
    }

    // The More menu opens on its first or last item, rising in like a dialog.
    const menu = menuRef.current;
    if (menu && menuFocus) {
      const items = menu.querySelectorAll<HTMLElement>('[role="menuitem"]');
      (menuFocus === "last" ? items[items.length - 1] : items[0])?.focus();
      setMenuFocus(null);
      if (!reducedMotion()) {
        menu.animate([{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "translateY(0)" }], {
          duration: 200,
          easing: "cubic-bezier(.2,.7,.2,1)",
        });
      }
    }

    // Focus moves after an outcome, a role change or a thread link.
    const wanted = pendingFocus.current;
    if (wanted) {
      const panelHidden = layout === "phone";
      const scope = layout === "phone" ? document.querySelector<HTMLElement>(".margin") : railRef.current;
      // On a phone the Source tab is selected first; after a fold it waits for the sequence so the stub is seen.
      const selectSource = (target: NonNullable<typeof pendingFocus.current>) => {
        const playing = target.afterSequence ? sequenceRuns.current.filter((run) => run.playState === "running") : [];
        if (!playing.length) return setTab("source");
        void Promise.allSettled(playing.map((run) => run.finished)).then(() => {
          if (alive.current && pendingFocus.current === target) setTab("source");
        });
      };
      if (wanted.source) {
        if (panelHidden && tab !== "source") selectSource(wanted);
        else if (sourceRef.current) {
          pendingFocus.current = null;
          sourceRef.current.focus({ preventScroll: true });
        }
      } else if (wanted.button) {
        const card = document.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(wanted.button.card)}"]`);
        const label = wanted.button.verb === "accept" ? "Accept" : "Reject";
        const button = Array.from(card?.querySelectorAll<HTMLButtonElement>(".card-actions button") ?? []).find(
          (item) => item.textContent?.trim() === label && !item.disabled,
        );
        if (button) {
          pendingFocus.current = null;
          button.focus({ preventScroll: true });
        }
      } else if (wanted.card !== undefined) {
        const card = document.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(wanted.card)}"]`);
        pendingFocus.current = null;
        if (card && card.tabIndex >= 0 && card.getClientRects().length) {
          card.focus({ preventScroll: true });
          setFocusedCard(wanted.card);
          const line = Number(card.dataset.line);
          if (Number.isFinite(line) && line > 0) lineElement(line)?.scrollIntoView({ block: "nearest" });
          card.scrollIntoView({ block: "nearest" });
        }
      } else if (wanted.after && scope) {
        const all = Array.from(scope.querySelectorAll<HTMLElement>(".cards > .card"));
        const index = all.findIndex((card) => card.dataset.cardId === wanted.after);
        const open = (card: HTMLElement) => card.dataset.open === "true";
        const next = all.slice(index + 1).find(open) ?? all.slice(0, Math.max(index, 0)).reverse().find(open);
        if (next) {
          pendingFocus.current = null;
          next.focus({ preventScroll: true });
          setFocusedCard(next.dataset.cardId ?? null);
        } else {
          const toSource = { source: true, afterSequence: true };
          pendingFocus.current = toSource;
          if (panelHidden && tab !== "source") selectSource(toSource);
          else if (sourceRef.current) {
            pendingFocus.current = null;
            sourceRef.current.focus({ preventScroll: true });
          }
        }
      }
    }

    if (roleSwap.current) {
      roleSwap.current = false;
      if (document.activeElement === document.body && sourceRef.current && !anyDialogOpen()) sourceRef.current.focus({ preventScroll: true });
    }
  });

  // ---- editing --------------------------------------------------------------------------

  const readSelection = () => {
    const element = sourceRef.current;
    if (!element) return;
    const next = { start: element.selectionStart, end: element.selectionEnd };
    setSelection((current) => (current && current.start === next.start && current.end === next.end ? current : next));
  };

  const onInput = () => {
    const element = sourceRef.current;
    const current = live.current.doc;
    if (!element || !current) return;
    setText(element.value);
    setDirty(element.value !== current.view);
    readSelection();
  };

  /** Stored offsets of a text-field position, through any unsaved change. */
  const toStoredOffset = (position: number): number => {
    const current = live.current.doc as OpenDoc;
    const element = sourceRef.current as HTMLTextAreaElement;
    const span = replacedSpan(current.view, element.value);
    let loaded = position;
    if (position >= span.a + span.n) loaded = position - span.n + (span.b - span.a);
    else if (position > span.a) loaded = span.a;
    return offsetMap(current.stored).toStored(loaded);
  };

  const save = async () => {
    const current = live.current.doc;
    const element = sourceRef.current;
    if (!current || current.file.kind !== "text" || !element || !canEdit(live.current.role) || saving) return;
    const typed = element.value;
    const span = replacedSpan(current.view, typed);
    const map = offsetMap(current.stored);
    const from = map.toStored(span.a);
    const to = map.toStored(span.b);
    const inserted = span.inserted.replace(/\n/g, lineBreakOf(current.stored));
    const content = current.stored.slice(0, from) + inserted + current.stored.slice(to);
    const body = JSON.stringify({ content, baseRevision: current.revision });
    const key = retryKey();
    const path = current.file.path;
    const send = () => api<{ file: TextFile; projectRevision: number }>("PUT", `${base}/files/${current.file.id}`, body, { "Idempotency-Key": key });
    setSaving(true);
    say(`Saving ${path}…`);
    let answer: ApiResult<{ file: TextFile; projectRevision: number }>;
    try {
      try {
        answer = await send();
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        answer = await send();
      }
    } catch {
      setSaving(false);
      say("Not saved. Your text is still here; try again.");
      return;
    }
    clock.answered();
    setSaving(false);
    if (answer.ok) {
      const file = answer.data.file;
      const still = live.current.doc;
      if (still && still.file.id === current.file.id) {
        setDoc({ file: { ...file }, stored: content, view: typed, revision: file.revision });
        const now = sourceRef.current?.value ?? typed;
        setDirty(now !== typed);
        // The saved revision moves this file's anchors as the server just did, so the cards glide with the answer.
        const span = replacedSpan(current.stored, content);
        setReview((data) => (data ? withAnchorsMoved(data, current.file.id, span) : data));
        glide.current = { delay: 0 };
      }
      setInfo((info) => (info ? { ...info, projectRevision: Math.max(info.projectRevision, answer.data.projectRevision) } : info));
      say(`Saved ${path} as r${answer.data.projectRevision}`);
      void refresh();
      return;
    }
    if (answer.status === 412 && answer.error.current) {
      say(`Not saved: a newer version of ${path} exists`);
      setDialog({ kind: "stale", unsaved: element.value, current: answer.error.current });
      return;
    }
    if (answer.status === 422 && answer.error.errors?.content) {
      say(`Not saved: ${path} contains a character that cannot be stored`);
      return;
    }
    if (answer.status === 401) return toSignIn();
    if (answer.status === 403) return void forbidden();
    if (answer.status === 404) return void checkProject();
    say("Not saved. Your text is still here; try again.");
  };

  const loadLatest = (file: TextFile) => {
    const view = toView(file.content ?? "");
    pendingText.current = { value: view };
    setDoc({ file, stored: file.content ?? "", view, revision: file.revision });
    setText(view);
    setDirty(false);
    setDialog(null);
    glide.current = { delay: 0 };
  };

  const openSelectionDialog = (kind: "suggest" | "comment") => {
    const element = sourceRef.current;
    if (!element) return;
    const chosen = { start: element.selectionStart, end: element.selectionEnd };
    if (kind === "comment" && chosen.start === chosen.end) return;
    setMoreOpen(false);
    setDialog({ kind, selection: chosen, quote: element.value.slice(chosen.start, chosen.end) });
  };

  const submitSelection = async (kind: "suggest" | "comment", chosen: Selection, value: string): Promise<{ field?: string } | void> => {
    const current = live.current.doc;
    if (!current) return;
    const from = toStoredOffset(chosen.start);
    const to = toStoredOffset(chosen.end);
    const body =
      kind === "suggest"
        ? { baseRevision: current.revision, from, to, inserted: value }
        : { baseRevision: current.revision, from, to, body: value };
    say("Sending…");
    const answer = await act(() =>
      post<{ suggestion?: NamedSuggestion; thread?: NamedThread }>(`${base}/files/${current.file.id}/${kind === "suggest" ? "suggestions" : "threads"}`, body),
    );
    if (!answer) {
      say(SOMETHING_WRONG);
      return;
    }
    if (answer.ok) {
      const made = answer.data.suggestion ?? answer.data.thread;
      setReview((data) => {
        if (!data) return data;
        if (answer.data.suggestion) {
          return { ...data, suggestions: [...data.suggestions, answer.data.suggestion], openSuggestions: data.openSuggestions + 1 };
        }
        return answer.data.thread ? { ...data, threads: [...data.threads, answer.data.thread] } : data;
      });
      say(kind === "suggest" ? "Suggestion added" : "Comment posted");
      focusOnClose(() => null);
      setDialog(null);
      if (live.current.layout === "phone") setTab("margin");
      if (made) pendingFocus.current = { card: made.id };
      return;
    }
    if (answer.status === 403 || answer.status === 401 || answer.status === 404) return;
    if (answer.status === 412) {
      say("The passage changed; select it again");
      return;
    }
    if (answer.status === 422) {
      const fields = answer.error.errors ?? {};
      const field = kind === "suggest" ? "inserted" : "body";
      if (fields[field]) return { field };
      say(SOMETHING_WRONG);
      return;
    }
    say(SOMETHING_WRONG);
  };

  // ---- deciding suggestions and threads -----------------------------------------------

  /** One resolution of one card. Only the most recently sent resolution speaks and moves focus; every answer folds its own card. */
  const decide = async (suggestion: NamedSuggestion, verb: "accept" | "reject") => {
    if (pending.has(suggestion.id)) return;
    const sent = (lastResolution.current += 1);
    const latest = () => sent === lastResolution.current;
    const settle = () =>
      setPending((current) => {
        const next = new Map(current);
        next.delete(suggestion.id);
        return next;
      });
    setPending((current) => new Map(current).set(suggestion.id, verb));
    say(verb === "accept" ? "Accepting suggestion…" : "Rejecting suggestion…");
    let answer: ApiResult<{ suggestion: NamedSuggestion; file?: TextFile; projectRevision: number; openSuggestions: number }>;
    try {
      answer = await post(`${base}/suggestions/${suggestion.id}/${verb}`);
    } catch {
      settle();
      if (latest()) {
        say("Not applied. Your connection dropped; try again.");
        pendingFocus.current = { button: { card: suggestion.id, verb } };
      }
      return;
    }
    clock.answered();
    const card = document.querySelector<HTMLElement>(`.cards > [data-card-id="${CSS.escape(suggestion.id)}"]`);
    const tall = card?.offsetHeight ?? 0;
    const holdsFocus = card?.contains(document.activeElement) ?? false;
    const motion = !reducedMotion();
    settle();
    if (answer.ok) {
      const decided = answer.data.suggestion;
      const name = decided.resolvedBy?.displayName ?? "";
      const openDoc = live.current.doc;
      const file = verb === "accept" ? answer.data.file : undefined;
      // The source shows the highest file revision seen; an answer behind it changes no text and strikes nothing again.
      const newer = file !== undefined && openDoc !== null && file.id === openDoc.file.id && file.revision > openDoc.revision;
      const textMoves = verb === "reject" || newer;
      if (motion) {
        if (textMoves && openDoc) {
          const element = sourceRef.current;
          const shownText = element ? element.value : text;
          setOverride((current) => playIn(current ?? { text: shownText, ...marksFor(shownText, openDoc, live.current.review, {}) }, suggestion.id, verb));
        }
        fold.current.set(suggestion.id, { height: tall, delay: textMoves ? 400 : 0 });
        glide.current = { delay: textMoves ? 400 : 0 };
      }
      setFolded((current) => new Map(current).set(suggestion.id, `${verb === "accept" ? "Accepted" : "Rejected"} by ${name}`));
      setReview((data) =>
        data
          ? {
              ...data,
              suggestions: data.suggestions.map((s) => (s.id === decided.id ? decided : s)),
              openSuggestions: latest() ? answer.data.openSuggestions : data.openSuggestions,
            }
          : data,
      );
      if (newer && file && file.content !== undefined && !live.current.dirty) {
        const view = toView(file.content);
        pendingText.current = { value: view };
        setDoc({ file, stored: file.content, view, revision: file.revision });
        setText(view);
      }
      setInfo((info) => (info ? { ...info, projectRevision: Math.max(info.projectRevision, answer.data.projectRevision) } : info));
      if (latest()) say(`Suggestion ${verb === "accept" ? "accepted" : "rejected"}, ${openCount(answer.data.openSuggestions)}`);
      if (latest() || holdsFocus) pendingFocus.current = { after: suggestion.id };
      void refresh();
      return;
    }
    if (answer.status === 409 && answer.error.suggestion) {
      const winner = answer.error.suggestion as NamedSuggestion;
      setReview((data) => (data ? { ...data, suggestions: data.suggestions.map((s) => (s.id === winner.id ? winner : s)) } : data));
      if (winner.status === "orphaned") {
        if (latest()) say("This suggestion lost its passage and can no longer be applied");
      } else {
        const outcome = winner.status === "accepted" ? "Accepted" : "Rejected";
        const name = winner.resolvedBy?.displayName ?? "";
        if (motion) glide.current = { delay: 0 };
        setFolded((current) => new Map(current).set(winner.id, `${outcome} by ${name}`));
        if (latest()) say(`Already ${winner.status} by ${name}`);
        if (winner.status === "accepted") {
          const file = await loadFileContent(winner.fileId);
          const shown = live.current.doc;
          if (file && shown && file.id === shown.file.id && file.revision > shown.revision && !live.current.dirty) loadNewer(file);
        }
      }
      if (latest() || holdsFocus) pendingFocus.current = { after: suggestion.id };
      void refresh();
      return;
    }
    if (answer.status === 401) return toSignIn();
    if (answer.status === 403) return void forbidden();
    if (answer.status === 404) return void checkProject();
    if (latest()) say(SOMETHING_WRONG);
  };

  const setThreadBusy = (threadId: string, on: boolean) =>
    setBusyThreads((current) => {
      const next = new Set(current);
      if (on) next.add(threadId);
      else next.delete(threadId);
      return next;
    });

  const postReply = async (thread: NamedThread) => {
    const body = replies.get(thread.id) ?? "";
    setThreadBusy(thread.id, true);
    say("Sending…");
    const answer = await act(() => post<{ comment: NamedThread["comments"][number] }>(`${base}/threads/${thread.id}/comments`, { body }));
    setThreadBusy(thread.id, false);
    if (!answer) return say(SOMETHING_WRONG);
    if (answer.ok) {
      setReplies((current) => new Map(current).set(thread.id, ""));
      setReview((data) =>
        data ? { ...data, threads: data.threads.map((t) => (t.id === thread.id ? { ...t, comments: [...t.comments, answer.data.comment] } : t)) } : data,
      );
      say("Reply posted");
    } else if (answer.status === 409) say("This thread is already resolved");
    else if (answer.status === 422) say(looksEmpty(body) ? "Write a comment of 1 to 4,000 characters." : unstorableOr(body, "Write a comment of 1 to 4,000 characters."));
    else if (answer.status >= 500) say(SOMETHING_WRONG);
  };

  const resolveThread = async (thread: NamedThread) => {
    setThreadBusy(thread.id, true);
    say("Sending…");
    const answer = await act(() => post<{ thread: NamedThread }>(`${base}/threads/${thread.id}/resolve`));
    setThreadBusy(thread.id, false);
    if (!answer) return say(SOMETHING_WRONG);
    if (answer.ok) {
      const resolved = answer.data.thread;
      const card = document.querySelector<HTMLElement>(`.cards > [data-card-id="${CSS.escape(thread.id)}"]`);
      if (card && !reducedMotion()) {
        fold.current.set(thread.id, { height: card.offsetHeight, delay: 0 });
        glide.current = { delay: 0 };
      }
      setFolded((current) => new Map(current).set(thread.id, `Resolved by ${resolved.resolvedBy?.displayName ?? ""}`));
      setReview((data) => (data ? { ...data, threads: data.threads.map((t) => (t.id === thread.id ? resolved : t)) } : data));
      say("Thread resolved");
      pendingFocus.current = { after: thread.id };
    } else if (answer.status === 409) say("This thread is already resolved");
    else if (answer.status >= 500) say(SOMETHING_WRONG);
  };

  // ---- rendering ------------------------------------------------------------------------

  if (phase === "dead") {
    return (
      <main class="paper-page">
        <div class="sign-in">
          <h1>This link is no longer active</h1>
          <p class="muted">Ask the project owner for a new link.</p>
        </div>
      </main>
    );
  }
  if (phase !== "ready" || !info) {
    return (
      <main class="paper-page">
        <p class="muted">{phase === "failed" ? "The project could not be loaded. Try again shortly." : "Loading project…"}</p>
      </main>
    );
  }

  const editable = canEdit(role);
  const suggestible = canSuggest(role);
  const handles = members.map((member) => member.user.handle);
  const textDoc = doc && doc.file.kind === "text" ? doc : null;
  const shownText = textDoc ? text : "";
  const { marks, points } = marksFor(shownText, doc, review, { focused: focusedCard });

  const reviewItems = review ?? { suggestions: [], threads: [], openSuggestions: 0 };
  /** Cards follow saved revisions only: a card sits at its anchor's line in the loaded revision, whatever is typed since. */
  const lineFor = (from: number | null): number | null => {
    if (!textDoc || from === null) return null;
    return lineOf(textDoc.view, offsetMap(textDoc.stored).toView(from));
  };
  const fileCards: (CardItem & { order: number })[] = [];
  if (doc) {
    for (const s of reviewItems.suggestions) {
      if (s.fileId !== doc.file.id || s.from === null) continue;
      const stub = folded.get(s.id) ?? null;
      if (s.status !== "open" && stub === null) continue;
      fileCards.push({ kind: "suggestion", id: s.id, item: s, line: lineFor(s.from), stub, order: s.from });
    }
    for (const t of reviewItems.threads) {
      if (t.fileId !== doc.file.id || t.from === null) continue;
      const stub = folded.get(t.id) ?? null;
      if ((t.status !== "open" || t.orphaned) && stub === null) continue;
      fileCards.push({ kind: "thread", id: t.id, item: t, line: lineFor(t.from), stub, order: t.from });
    }
  }
  // Document order: by `from`, a suggestion before a thread at equal `from`, then creation time, then id.
  const madeAt = (card: CardItem) => (card.kind === "suggestion" ? card.item.createdAt : (card.item.comments[0]?.createdAt ?? ""));
  const kindRank = (card: CardItem) => (card.kind === "suggestion" ? 0 : 1);
  fileCards.sort(
    (a, b) => a.order - b.order || kindRank(a) - kindRank(b) || madeAt(a).localeCompare(madeAt(b)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const orphanCards: CardItem[] = [
    ...reviewItems.suggestions.filter((s) => s.status === "orphaned").map((s) => ({ kind: "suggestion" as const, id: s.id, item: s, line: null, stub: null })),
    ...reviewItems.threads
      .filter((t) => t.orphaned && (t.status === "open" || folded.has(t.id)))
      .map((t) => ({ kind: "thread" as const, id: t.id, item: t, line: null, stub: folded.get(t.id) ?? null })),
  ];

  const actions: CardActions = {
    canResolve: editable,
    canReply: suggestible,
    shared,
    pending,
    busy: busyThreads,
    replies,
    handles,
    onReply: (threadId, value) => setReplies((current) => new Map(current).set(threadId, value)),
    onPostReply: (thread) => void postReply(thread),
    onResolve: (thread) => void resolveThread(thread),
    onDecide: (suggestion, verb) => void decide(suggestion, verb),
    onChoose: (card) => {
      if (layout === "phone") {
        setTab("source");
        if (card.line) pendingView.current = { line: card.line };
      } else if (card.line) lineElement(card.line)?.scrollIntoView({ block: "nearest" });
    },
    onHover: setHovered,
  };

  const context: ViewContext = {
    base,
    role: role ?? "viewer",
    title: info.title,
    projectRevision: info.projectRevision,
    citations,
    review,
    say,
    sayStorage,
    act,
  };

  const margin = (
    <aside class="margin" aria-label="Margin" ref={railRef}
      onPointerDown={() => {
        pressing.current = true;
        const release = () => {
          pressing.current = false;
        };
        document.addEventListener("pointerup", release, { once: true, capture: true });
        document.addEventListener("pointercancel", release, { once: true, capture: true });
      }}
      onFocusIn={(event) => {
        const card = (event.target as HTMLElement).closest<HTMLElement>("[data-card-id]");
        const id = card?.dataset.cardId ?? null;
        if (!pressing.current) return setFocusedCard(id);
        // A press restacks the cards only once its click has landed, so the pressed control never moves under the pointer.
        const apply = () => {
          document.removeEventListener("click", apply);
          document.removeEventListener("pointercancel", apply);
          const still = document.activeElement?.closest<HTMLElement>("[data-card-id]")?.dataset.cardId;
          if (still === id) setFocusedCard(id);
        };
        document.addEventListener("click", apply);
        document.addEventListener("pointercancel", apply);
      }}
      onFocusOut={(event) => {
        const next = event.relatedTarget as HTMLElement | null;
        if (!next || !next.closest("[data-card-id]")) setFocusedCard(null);
      }}
      onKeyDown={(event) => {
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        const target = event.target as HTMLElement;
        if (!target.matches("[data-card-id]")) return;
        // Stubs are never stops: only open cards (Orphaned group first, then the file's cards) take part.
        const cards = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[data-card-id][tabindex="0"]'));
        const next = cards[cards.indexOf(target) + (event.key === "ArrowDown" ? 1 : -1)];
        if (!next) return;
        event.preventDefault();
        next.focus();
      }}>
      {orphanCards.length ? (
        <section class="orphaned" aria-labelledby="orphaned-heading">
          <h3 id="orphaned-heading">Orphaned</h3>
          <div class="orphan-cards">
            {orphanCards.map((card) => <Card key={card.id} card={card} actions={actions} orphan />)}
          </div>
        </section>
      ) : null}
      <div class={`cards${layout === "phone" ? " cards-flow" : ""}`}>
        {layout !== "phone" ? <svg class="tethers" aria-hidden="true" width="20" height="0" /> : null}
        {fileCards.map((card) => <Card key={card.id} card={card} actions={actions} orphan={false} />)}
      </div>
      {fileCards.length === 0 && orphanCards.length === 0 ? <p class="margin-empty">No open notes on this file.</p> : null}
    </aside>
  );

  const sections = textDoc
    ? shownText.split("\n").flatMap((line, index) => {
        const found = SECTION.exec(line);
        return found ? [{ line: index + 1, level: found[1] as string, title: (found[2] as string).trim() || "(untitled)" }] : [];
      })
    : [];

  const tree = (
    <FileTree files={files} openPath={doc?.file.path ?? null} onOpen={chooseFile} focusPath={treeFocus}
      onFocused={() => setTreeFocus(null)} />
  );

  const sectionList = (
    <div class="sections">
      <h3 id="sections-heading">Sections</h3>
      <ul aria-label="Sections">
        {sections.length === 0 ? <li class="muted">No sections in this file.</li> : null}
        {sections.map((section) => (
          <li key={`${section.line}`} class={`section-${section.level}`}>
            <button type="button" class="link-button" onClick={() => {
              const element = sourceRef.current;
              if (element) {
                const at = lineStart(element.value, section.line);
                element.setSelectionRange(at, at);
              }
              setDialog(null);
              scrollLineToTop(section.line);
            }}>
              {section.title}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );

  const showDelete = !shared && editable && doc !== null;

  const sourceArea = doc ? (
    doc.file.kind === "asset" ? (
      <FigurePreview key={doc.file.id} url={`${base}/files/${doc.file.id}/raw`} path={doc.file.path} size={doc.file.size}
        contentType={doc.file.contentType} refreshes={refreshes}
        onStorage={(loaded) => {
          if (loaded) setStorage((current) => (current === STORAGE_DOWN ? "" : current));
          else sayStorage(STORAGE_DOWN);
        }} />
    ) : (
      <Editor key={doc.file.id} path={doc.file.path} text={override ? override.text : shownText}
        marks={override ? override.marks : marks} points={override ? override.points : points}
        readOnly={shared || !editable} sourceRef={sourceRef} mirrorRef={mirrorRef}
        onInput={onInput} onSelection={readSelection} />
    )
  ) : (
    <p class="muted">Opening file…</p>
  );

  const fileHead = doc ? (
    <div class="file-head">
      <span class="mono file-path">{doc.file.path}</span>
      {showDelete && doc ? (
        <button type="button" class="small quiet" aria-label={`Delete ${doc.file.path}`} onClick={() => setDialog({ kind: "delete", file: doc.file })}>
          Delete
        </button>
      ) : null}
    </div>
  ) : null;

  const statusLine = (
    <div class="status-line">
      <div role="status" aria-label="Project updates" class="status-updates">{updates}</div>
      <div role="status" aria-label="Storage status" class="status-storage">{storage}</div>
      <div role="status" aria-label="Citation check" class="status-citations">{citationCopy(citations)}</div>
    </div>
  );

  // Toolbar actions in published order.
  const hasSelection = selection !== null && selection.end > selection.start;
  type Tool = { name: string; icon: IconName; run: () => void; disabled?: boolean; busy?: boolean };
  const tools: Tool[] = shared
    ? []
    : [
        ...(editable ? [{ name: "Save", icon: "save" as const, run: () => void save(), disabled: saving || !dirty, busy: saving }] : []),
        ...(suggestible
          ? [
              { name: "Suggest edit", icon: "pencil" as const, run: () => openSelectionDialog("suggest"), disabled: selection === null || !textDoc },
              { name: "Comment", icon: "message" as const, run: () => openSelectionDialog("comment"), disabled: !hasSelection || !textDoc },
            ]
          : []),
        ...(editable
          ? [
              { name: "New file", icon: "file" as const, run: () => setDialog({ kind: "new-file" }) },
              { name: "Upload file", icon: "upload" as const, run: () => setDialog({ kind: "upload" }) },
            ]
          : []),
        { name: "Citation warnings", icon: "bookCheck", run: () => setDialog({ kind: "citations" }) },
        { name: "History", icon: "history", run: () => setDialog({ kind: "history" }) },
        { name: "People and sharing", icon: "users", run: () => setDialog({ kind: "people" }) },
        { name: "Submission check", icon: "listChecks", run: () => setDialog({ kind: "submission" }) },
      ];

  const toolButton = (tool: Tool, extra = "") => (
    <button key={tool.name} type="button" class={`tool ${extra}`} disabled={tool.disabled} aria-busy={tool.busy ? "true" : undefined}
      onMouseDown={(event) => { if (tool.name === "Suggest edit" || tool.name === "Comment") event.preventDefault(); }}
      onClick={() => { setMoreOpen(false); tool.run(); }}>
      <Icon name={tool.icon} />
      <span>{tool.name}</span>
      {tool.name === "Citation warnings" ? <span class="tool-sub" aria-hidden="true">{citationCopy(citations)}</span> : null}
    </button>
  );

  const unsaved = dirty ? <span class="unsaved">Unsaved changes</span> : null;
  const filesButton = (
    <button type="button" class="tool" data-files-button onClick={() => setDialog({ kind: "files" })}>
      <Icon name="files" />
      <span>Files</span>
    </button>
  );

  /** The menu keyboard model: arrows wrap, Home and End, Escape returns to More, Tab moves on in the page. */
  const onMenuKey = (event: KeyboardEvent) => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const at = items.indexOf(document.activeElement as HTMLElement);
    const move = (index: number) => items[(index + items.length) % items.length]?.focus();
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        move(at + 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        move(at - 1);
        break;
      case "Home":
        event.preventDefault();
        move(0);
        break;
      case "End":
        event.preventDefault();
        move(items.length - 1);
        break;
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        setMoreOpen(false);
        document.querySelector<HTMLElement>("[data-more-button]")?.focus();
        break;
      case "Tab":
        setMoreOpen(false);
        break;
      default:
    }
  };
  const phoneTools = tools.filter((tool) => tool.name !== "Save");
  const saveTool = tools.find((tool) => tool.name === "Save");

  const toolbar = shared ? (
    <header class="share-band">
      <span class="share-flag">Read-only view</span>
      <span class="share-title">{info.title}</span>
      <span class="rev mono">r{info.projectRevision}</span>
      {layout !== "desktop" ? filesButton : null}
    </header>
  ) : (
    <header class="toolbar">
      <a class="skip-link" href="#source" onClick={(event) => {
        event.preventDefault();
        if (layout === "phone" && tab !== "source") {
          setTab("source");
          pendingFocus.current = { source: true };
        } else sourceRef.current?.focus();
      }}>
        Skip to source
      </a>
      <a class="tool tool-back" href="/" onClick={(event) => { event.preventDefault(); navigate("/"); }}>
        <Icon name="back" />
        <span>Projects</span>
      </a>
      <p class="project-title" title={info.title}>{info.title}</p>
      {layout !== "desktop" ? filesButton : null}
      {layout === "phone" ? (
        <>
          {saveTool ? toolButton(saveTool) : null}
          {unsaved}
          <div class="more" onFocusOut={(event) => {
            const next = event.relatedTarget as Node | null;
            if (moreOpen && next && !(event.currentTarget as HTMLElement).contains(next)) setMoreOpen(false);
          }}>
            <button type="button" class="tool" data-more-button aria-haspopup="menu" aria-expanded={moreOpen ? "true" : "false"}
              aria-controls={moreOpen ? "more-menu" : undefined}
              onClick={() => {
                if (!moreOpen) setMenuFocus("first");
                setMoreOpen(!moreOpen);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " " || event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  setMenuFocus(event.key === "ArrowUp" ? "last" : "first");
                  setMoreOpen(true);
                }
              }}>
              <Icon name="more" />
              <span>More</span>
            </button>
            {moreOpen ? (
              <div id="more-menu" role="menu" aria-label="More" class="more-list" ref={menuRef} onKeyDown={onMenuKey}>
                {phoneTools.map((tool) => (
                  <button key={tool.name} type="button" role="menuitem" tabIndex={-1} class="tool more-item"
                    aria-disabled={tool.disabled ? "true" : undefined}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      if (tool.disabled) return;
                      document.querySelector<HTMLElement>("[data-more-button]")?.focus({ preventScroll: true });
                      setMoreOpen(false);
                      tool.run();
                    }}>
                    <Icon name={tool.icon} />
                    <span>{tool.name}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </>
      ) : (
        <div class="tools">
          {tools.flatMap((tool) => (tool.name === "Save" ? [toolButton(tool), unsaved] : [toolButton(tool)]))}
          {saveTool ? null : unsaved}
        </div>
      )}
    </header>
  );

  const phone = layout === "phone";
  const main = (
    <div class="pv-main">
      {phone ? (
        <div role="tablist" aria-label="Project view" class="tabs">
          {(["source", "margin"] as const).map((name) => (
            <button key={name} type="button" role="tab" id={`tab-${name}`} aria-controls={`panel-${name}`}
              aria-selected={tab === name ? "true" : "false"} tabIndex={tab === name ? 0 : -1}
              onClick={() => setTab(name)}
              onKeyDown={(event) => {
                const next =
                  event.key === "ArrowRight" || event.key === "ArrowLeft"
                    ? name === "source" ? "margin" : "source"
                    : event.key === "Home" ? "source" : event.key === "End" ? "margin" : null;
                if (!next) return;
                event.preventDefault();
                setTab(next);
                (document.getElementById(`tab-${next}`) as HTMLElement | null)?.focus();
              }}>
              {name === "source" ? "Source" : "Margin"}
            </button>
          ))}
        </div>
      ) : null}
      <div class="desk-scroll" ref={scrollRef}>
        <div class={`desk${phone ? " desk-phone" : ""}`}>
          <div class="sheet-wrap" id="panel-source" role={phone ? "tabpanel" : undefined}
            aria-labelledby={phone ? "tab-source" : undefined} hidden={phone && tab !== "source"}>
            {fileHead}
            {sourceArea}
          </div>
          <div class="margin-wrap" id="panel-margin" role={phone ? "tabpanel" : undefined}
            aria-labelledby={phone ? "tab-margin" : undefined} hidden={phone && tab !== "margin"}>
            {margin}
          </div>
        </div>
      </div>
      {statusLine}
    </div>
  );

  const dialogs = dialog ? renderDialog() : null;

  function renderDialog(): JSX.Element | null {
    if (!dialog) return null;
    const close = () => setDialog(null);
    switch (dialog.kind) {
      case "suggest":
      case "comment":
        return (
          <SelectionDialog kind={dialog.kind} quote={dialog.quote} handles={handles} onClose={close}
            onSubmit={(value) => submitSelection(dialog.kind as "suggest" | "comment", dialog.selection, value)} />
        );
      case "stale":
        return <StaleDialog path={doc?.file.path ?? ""} unsaved={dialog.unsaved} onClose={close} onLoad={() => loadLatest(dialog.current)} />;
      case "new-file":
        return (
          <NewFileDialog context={context} onClose={close} onCreated={(file) => {
            setFiles((current) => [...current.filter((item) => item.path !== file.path), file].sort((a, b) => (a.path < b.path ? -1 : 1)));
            setDialog(null);
            goTo(fileUrl(file.path));
          }} />
        );
      case "upload":
        return (
          <UploadDialog context={context} onClose={close} onUploaded={(file) => {
            const next = [...live.current.files.filter((item) => item.path !== file.path), file].sort((a, b) => (a.path < b.path ? -1 : 1));
            setFiles(next);
            live.current.files = next;
            if (live.current.layout === "desktop") {
              focusOnClose(() => document.querySelector<HTMLElement>(`.rail-left [role="treeitem"][data-path="${CSS.escape(file.path)}"]`));
            }
            setDialog(null);
            goTo(fileUrl(file.path));
          }} />
        );
      case "delete":
        return (
          <DeleteDialog context={context} file={dialog.file} onClose={close} onDeleted={() => {
            const remaining = live.current.files.filter((file) => file.id !== dialog.file.id);
            setFiles(remaining);
            live.current.files = remaining;
            focusOnClose(() => null);
            setDialog(null);
            const next = defaultFile(remaining);
            if (next) goTo(fileUrl(next.path), true);
          }} />
        );
      case "history":
        return (
          <HistoryDialog context={context} onClose={close} />
        );
      case "people":
        return <PeopleDialog context={context} onClose={close} />;
      case "citations":
        return (
          <CitationsDialog report={citations} hrefFor={fileUrl} onClose={close} onChoose={(path, line) => {
            focusOnClose(() => null);
            setDialog(null);
            goTo(fileUrl(path, line), true);
          }} />
        );
      case "submission":
        return <SubmissionDialog context={context} onClose={close} />;
      case "files":
        return (
          <FilesDialog onClose={close}>
            {tree}
            {sectionList}
          </FilesDialog>
        );
      default:
        return null;
    }
  }

  return (
    <div class={`pv pv-${layout}${shared ? " pv-shared" : ""}`}>
      {toolbar}
      <div class="pv-body">
        {layout === "desktop" ? (
          <nav class="rail-left" aria-label="Files and sections">
            {tree}
            {sectionList}
          </nav>
        ) : null}
        {main}
      </div>
      {dialogs}
    </div>
  );
}

function looksEmpty(value: string): boolean {
  return value.trim().length === 0 || value.length > 4000;
}

function unstorableOr(value: string, fallback: string): string {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code === 0 || (code >= 0xd800 && code <= 0xdfff)) return "This text contains a character that cannot be stored.";
  }
  return fallback;
}

/** A stored offset of the loaded file, as a position in the text the field shows now. */
function currentOffset(doc: OpenDoc, shown: string, stored: number): number {
  const loaded = offsetMap(doc.stored).toView(stored);
  if (shown === doc.view) return loaded;
  return carryCaret(loaded, replacedSpan(doc.view, shown));
}

/** The review after a saved change to one file; anchors the change orphans keep their place until the server reports them. */
function withAnchorsMoved(review: ReviewData, fileId: string, span: ReplacedSpan): ReviewData {
  return {
    ...review,
    suggestions: review.suggestions.map((s) => {
      if (s.fileId !== fileId || s.status !== "open" || s.from === null || s.to === null) return s;
      const moved = moveSuggestionAnchor({ from: s.from, to: s.to }, span);
      return moved ? { ...s, ...moved } : s;
    }),
    threads: review.threads.map((t) => {
      if (t.fileId !== fileId || t.orphaned || t.from === null || t.to === null) return t;
      const moved = moveThreadAnchor({ from: t.from, to: t.to }, span);
      return moved ? { ...t, ...moved } : t;
    }),
  };
}

/** The review marks drawn in the mirror for the open file. */
function marksFor(
  shown: string,
  doc: OpenDoc | null,
  review: ReviewData | null,
  options: { focused?: string | null },
): { marks: Mark[]; points: InsertPoint[] } {
  const marks: Mark[] = [];
  const points: InsertPoint[] = [];
  if (!doc || doc.file.kind !== "text" || !review) return { marks, points };
  const at = (stored: number) => currentOffset(doc, shown, stored);
  for (const thread of review.threads) {
    if (thread.fileId !== doc.file.id || thread.status !== "open" || thread.orphaned || thread.from === null || thread.to === null) continue;
    marks.push({ from: at(thread.from), to: at(thread.to), className: thread.id === options.focused ? "cmt focus-passage" : "cmt" });
  }
  for (const s of review.suggestions) {
    if (s.fileId !== doc.file.id || s.from === null || s.to === null || s.status !== "open") continue;
    const from = at(s.from);
    const to = at(s.to);
    const focus = s.id === options.focused ? " focus-passage" : "";
    if (to > from) marks.push({ from, to, className: `del${focus}`, of: s.id });
    if (s.inserted) points.push({ at: to, text: s.inserted, of: s.id });
  }
  return { marks, points };
}
