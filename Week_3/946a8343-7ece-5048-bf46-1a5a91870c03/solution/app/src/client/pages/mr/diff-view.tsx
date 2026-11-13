// The changes screen's behaviour: rows and files in focus, the address, expanding context, keyboard review, comment boxes, the
// submit dialog and the touch gestures. Drawing is in diff-grid.tsx.
import { expandGap, NO_EXPANSION, type DiffOp, type ExpandDirection, type Expansion } from "../../../shared/diff.ts";
import { useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { Sheet } from "../../a11y/dialog.tsx";
import { isTypingTarget } from "../../a11y/keys.ts";
import { announce } from "../../announce.tsx";
import { setQuery, useQuery } from "../../router.ts";
import { Notice, Skeleton } from "../../ui/feedback.tsx";
import { useMrCaps, type MrPage, type ThreadView } from "./data.ts";
import type { Compare } from "./diff-data.ts";
import { DiffGrid, type FileSection } from "./diff-grid.tsx";
import {
  anchorKey,
  cellAnchor,
  fileItems,
  holdsThreads,
  placeThreads,
  rowId,
  rowRefOf,
  sameRow,
  stepSelection,
  targetFrom,
  type Selection,
} from "./diff-model.ts";
import { wholeFileOps } from "./diff-source.ts";
import { DiffToolbar } from "./diff-toolbar.tsx";
import { targetLabel, type CommentTarget, type DiffFile, type LineCell, type RowRef, type ViewMode } from "./diff-types.ts";
import { Composer, discardReview, pendingCount, postComment, ReviewDialog, submitReview } from "./review.tsx";
import { attempt, setResolved, useRefusal, useThreads } from "./thread-actions.ts";
import { focusThreadRow, ThreadCard } from "./threads.tsx";
import { useDiffGestures } from "./touch.ts";

const PREFETCH_WORKERS = 3;
const ROW = "[data-row]";

function rowsIn(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(ROW)];
}

function openThreadsIn(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>("article[data-thread][data-resolved='false']")];
}

interface DiffScreenProps {
  page: MrPage;
  compare: Compare;
}

export function DiffScreen({ page, compare }: DiffScreenProps) {
  const query = useQuery();
  const view: ViewMode = query.get("view") === "split" ? "split" : "inline";
  const fileParam = query.get("file");
  const lineParam = query.get("line");
  const caps = useMrCaps(page.mr, page.settings);
  const threads = useThreads(page);
  const refused = useRefusal();
  const { diff, from, to, latest, oldRef, newRef } = compare;
  const body = diff.data ?? null;
  const files = useMemo(() => body?.diffs ?? [], [body]);

  const [opsByPath, setOps] = useState<ReadonlyMap<string, readonly DiffOp[]>>(new Map());
  const [expansions, setExpansions] = useState<ReadonlyMap<string, Expansion>>(new Map());
  const [current, setCurrent] = useState<RowRef | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [composer, setComposer] = useState<CommentTarget | null>(null);
  const [sheet, setSheet] = useState<CommentTarget | null>(null);
  const [finishing, setFinishing] = useState(false);
  const region = useRef<HTMLDivElement>(null);
  const finishButton = useRef<HTMLButtonElement>(null);
  const dialogOpener = useRef<HTMLElement | null>(null);
  const sheetOpener = useRef<HTMLElement | null>(null);
  const currentRef = useRef<RowRef | null>(null);
  const addressed = useRef<{ file: string | null; line: string | null } | null>(null);
  const pending = pendingCount(threads);

  const { sections, cells } = useMemo(() => {
    const built = files.map((file) => ({ file, items: fileItems(file, opsByPath.get(file.path) ?? null, expansions.get(file.path) ?? NO_EXPANSION, view) }));
    const placement = placeThreads(threads, to ?? 0, latest ?? 0, from === "target");
    const all: LineCell[] = [];
    const drawn = new Set<string>();
    for (const section of built) {
      for (const item of section.items) {
        if (item.kind === "gap") continue;
        for (const cell of item.kind === "line" ? [item.cell] : [item.left, item.right]) {
          if (cell === null) continue;
          all.push(cell);
          if (holdsThreads(cell)) drawn.add(cellAnchor(cell));
        }
      }
    }
    const withTails: FileSection[] = built.map((section) => ({
      ...section,
      tail: threads.filter((thread) => {
        if (thread.position?.path !== section.file.path) return false;
        const spot = placement.spots.get(thread.id);
        return spot === undefined || !drawn.has(anchorKey(spot.path, spot.side, spot.end));
      }),
    }));
    return { sections: withTails, cells: all };
  }, [files, opsByPath, expansions, view, threads, to, latest, from]);
  const placement = useMemo(() => placeThreads(threads, to ?? 0, latest ?? 0, from === "target"), [threads, to, latest, from]);
  const cellsById = useMemo(() => new Map(cells.map((cell) => [rowId(cell), cell])), [cells]);

  const active = useMemo<RowRef | null>(() => {
    const exact = current !== null ? cells.find((cell) => sameRow(rowRefOf(cell), current)) : undefined;
    if (current !== null && exact) return current;
    const loose = current !== null ? cells.find((cell) => cell.path === current.path && cell.kind === current.kind && cell.n === current.n) : undefined;
    const fallback = loose ?? cells[0];
    return fallback ? rowRefOf(fallback) : null;
  }, [cells, current]);

  // --- finding rows -----------------------------------------------------------------------------------------------------

  const rowElement = (ref: RowRef): HTMLElement | null => {
    const root = region.current;
    if (!root) return null;
    const id = rowId(ref);
    return rowsIn(root).find((row) => row.dataset.key === id) ?? null;
  };
  const currentRow = (): HTMLElement | null => {
    const root = region.current;
    const focused = document.activeElement;
    if (root && focused instanceof HTMLElement && focused.matches(ROW) && root.contains(focused)) return focused;
    const ref = currentRef.current ?? active;
    return ref ? rowElement(ref) : null;
  };
  const cellOfRow = (row: HTMLElement): LineCell | null => cellsById.get(row.dataset.key ?? "") ?? null;
  const targetOf = (row: HTMLElement): CommentTarget | null => {
    const cell = cellOfRow(row);
    if (!cell || to === null || !caps.comment || (cell.side === "old" && from !== "target")) return null;
    return { path: cell.path, side: cell.side, start: cell.n, end: null, version: to, row: rowRefOf(cell) };
  };

  // --- the address ------------------------------------------------------------------------------------------------------

  const onFocusRow = (cell: LineCell) => {
    const ref = rowRefOf(cell);
    currentRef.current = ref;
    setCurrent(ref);
    setSelection((held) => (held !== null && held.path === cell.path && held.side === cell.side && held.anchor === cell.n ? held : null));
    const line = String(cell.n);
    if (query.get("file") !== cell.path || query.get("line") !== line) {
      addressed.current = { file: cell.path, line };
      setQuery({ file: cell.path, line }, { replace: true });
    }
  };

  useLayoutEffect(() => {
    if (body === null || fileParam === null) return;
    if (addressed.current !== null && addressed.current.file === fileParam && addressed.current.line === lineParam) return;
    const inFile = cells.filter((cell) => cell.path === fileParam);
    const wanted = lineParam === null ? inFile[0] : (inFile.find((cell) => String(cell.n) === lineParam && cell.kind !== "removed" && holdsThreads(cell)) ?? inFile.find((cell) => String(cell.n) === lineParam));
    const row = wanted ? rowElement(rowRefOf(wanted)) : null;
    if (!row) return;
    addressed.current = { file: fileParam, line: lineParam };
    row.focus();
    row.scrollIntoView({ block: "center" });
  }, [body, fileParam, lineParam]);

  // The header, buttons and panel above the diff arrive after its rows and push them down: keep the addressed row in view for the
  // first few data arrivals only (never while a reader scrolls on their own).
  const settling = useRef(3);
  useLayoutEffect(() => {
    if (body === null || settling.current === 0) return;
    settling.current -= 1;
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.getAttribute("role") === "row" && region.current?.contains(active)) active.scrollIntoView({ block: "center" });
  }, [body, page.mr, page.threads, caps]);

  // --- context ------------------------------------------------------------------------------------------------------------

  useLayoutEffect(() => {
    if (body === null || newRef === null) return;
    let live = true;
    const queue = [...body.diffs];
    const work = async () => {
      for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
        const found = await wholeFileOps(page.project, file, oldRef, newRef).catch(() => null);
        if (live && found !== null) setOps((held) => new Map(held).set(file.path, found));
      }
    };
    void Promise.all(Array.from({ length: PREFETCH_WORKERS }, work));
    return () => {
      live = false;
    };
  }, [body, oldRef, newRef, page.project]);

  const expand = async (file: DiffFile, gap: number, direction: ExpandDirection) => {
    if (newRef === null) return;
    const known = opsByPath.get(file.path);
    const ops = known ?? (await attempt(() => wholeFileOps(page.project, file, oldRef, newRef)));
    if (ops === undefined) return;
    if (known === undefined) setOps((held) => new Map(held).set(file.path, ops));
    setExpansions((held) => new Map(held).set(file.path, expandGap(held.get(file.path) ?? NO_EXPANSION, gap, direction)));
  };

  // The button that was pressed leaves with the last hidden line; focus goes back to the current row instead of the page.
  useLayoutEffect(() => {
    const root = region.current;
    if (!root || root.contains(document.activeElement)) return;
    const ref = currentRef.current;
    const row = ref ? rowElement(ref) : null;
    if (row && (document.activeElement === document.body || document.activeElement === null)) row.focus();
  }, [expansions]);

  // --- comment boxes ------------------------------------------------------------------------------------------------------

  const [draft, setDraft] = useState<{ text: string; refusal: string | null } | null>(null);
  const closeComposer = () => {
    const row = composer ? rowElement(composer.row) : null;
    row?.focus();
    setDraft(null);
    setComposer(null);
  };
  // The box closes and focus returns to the row before the request answers; a refusal opens the box again with the text.
  const send = (target: CommentTarget, text: string, asPending: boolean, reopen: (target: CommentTarget) => void) => {
    void postComment(page, target, text, asPending).then((refusal) => {
      if (refusal === null) {
        void page.reload();
        return;
      }
      setDraft({ text, refusal });
      reopen(target);
    });
  };
  const postFromBox = (text: string, asPending: boolean) => {
    if (composer === null) return;
    const target = composer;
    closeComposer();
    send(target, text, asPending, setComposer);
  };
  const closeSheet = (target: CommentTarget) => {
    sheetOpener.current = rowElement(target.row);
    setDraft(null);
    setSheet(null);
  };
  const postFromSheet = (text: string, asPending: boolean) => {
    if (sheet === null) return;
    const target = sheet;
    closeSheet(target);
    send(target, text, asPending, setSheet);
  };
  const openBox = (target: CommentTarget) => {
    setSelection(null);
    setComposer(target);
  };

  useLayoutEffect(() => {
    if (composer !== null) region.current?.querySelector<HTMLTextAreaElement>(".sp-composer textarea")?.focus();
  }, [composer?.path, composer?.side, composer?.start, composer?.end]);

  const onNumber = (cell: LineCell, extend: boolean) => {
    const row = rowElement(rowRefOf(cell));
    const target = row ? targetOf(row) : null;
    if (target === null) return;
    if (extend && composer !== null && composer.path === cell.path && composer.side === cell.side) {
      const start = Math.min(composer.start, cell.n);
      const end = Math.max(composer.end ?? composer.start, cell.n);
      openBox({ ...composer, start, end: end === start ? null : end });
    } else {
      openBox(target);
    }
  };

  // --- keyboard -----------------------------------------------------------------------------------------------------------

  const moveRow = (step: 1 | -1) => {
    const root = region.current;
    if (!root) return;
    const rows = rowsIn(root);
    const here = currentRow();
    const index = here ? rows.indexOf(here) : -1;
    const next = index < 0 ? rows[0] : rows[index + step];
    next?.focus();
  };
  const moveFile = (step: 1 | -1) => {
    const root = region.current;
    if (!root) return;
    const groups = [...root.querySelectorAll<HTMLElement>("[data-file]")];
    const here = currentRow()?.closest<HTMLElement>("[data-file]") ?? null;
    const index = here ? groups.indexOf(here) : -1;
    groups[index + step]?.querySelector<HTMLElement>(ROW)?.focus();
  };
  const moveThread = (step: 1 | -1) => {
    const root = region.current;
    if (!root) return;
    const focused = document.activeElement;
    const origin = focused instanceof HTMLElement && root.contains(focused) ? focused : currentRow();
    const open = openThreadsIn(root);
    if (!origin) return;
    const after = (article: HTMLElement) => !article.contains(origin) && (origin.compareDocumentPosition(article) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    const before = (article: HTMLElement) => !article.contains(origin) && (origin.compareDocumentPosition(article) & Node.DOCUMENT_POSITION_PRECEDING) !== 0;
    const next = step === 1 ? open.find(after) : open.findLast(before);
    next?.focus();
    next?.scrollIntoView({ block: "nearest" });
  };
  const resolveFocused = (article: HTMLElement) => {
    const root = region.current;
    const id = Number(article.dataset.thread);
    const thread = threads.find((candidate) => candidate.id === id);
    if (!root || !thread || thread.resolved || !caps.comment) return;
    const open = openThreadsIn(root);
    const at = open.indexOf(article);
    const neighbour = open[at + 1] ?? open[at - 1];
    if (neighbour) neighbour.focus();
    else focusThreadRow(thread);
    void setResolved(page, id, true);
  };
  const extend = (direction: 1 | -1) => {
    const row = currentRow();
    const cell = row ? cellOfRow(row) : null;
    const root = region.current;
    if (!cell || !root || !caps.comment) return;
    const base: Selection = selection !== null && selection.path === cell.path && (selection.anchor === cell.n || selection.head === cell.n) ? selection : { path: cell.path, side: cell.side, anchor: cell.n, head: cell.n };
    const drawn = (n: number) => cells.some((other) => other.path === base.path && other.side === base.side && other.n === n && holdsThreads(other));
    setSelection(stepSelection(base, direction, drawn));
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey || event.isComposing || isTypingTarget(event.target)) return;
    const root = region.current;
    if (!root) return;
    if (event.shiftKey && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      extend(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (event.shiftKey) return;
    switch (event.key) {
      case "j":
        moveRow(1);
        break;
      case "k":
        moveRow(-1);
        break;
      case "n":
        moveFile(1);
        break;
      case "p":
        moveFile(-1);
        break;
      case "]":
        moveThread(1);
        break;
      case "[":
        moveThread(-1);
        break;
      case "c": {
        if (composer !== null) {
          root.querySelector<HTMLTextAreaElement>(".sp-composer textarea")?.focus();
          break;
        }
        const row = currentRow();
        const cell = row ? cellOfRow(row) : null;
        if (!row || !cell) return;
        const target = selection !== null && to !== null ? targetFrom(selection, to, rowRefOf(cell)) : targetOf(row);
        if (target === null) return;
        openBox(target);
        break;
      }
      case "e": {
        const article = event.target instanceof Element ? event.target.closest<HTMLElement>("article[data-thread]") : null;
        if (!article) return;
        resolveFocused(article);
        break;
      }
      case "Escape":
        if (selection === null) return;
        setSelection(null);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  // --- touch --------------------------------------------------------------------------------------------------------------

  useDiffGestures(region, {
    rowSelector: ROW,
    onSwipe(direction) {
      if (files.length === 0) return;
      const shown = currentRef.current?.path ?? fileParam ?? files[0].path;
      const index = files.findIndex((file) => file.path === shown);
      const file = files[(index < 0 ? 0 : index) + direction];
      if (!file) return;
      announce(`File ${files.indexOf(file) + 1} of ${files.length}: ${file.path}`);
      setQuery({ file: file.path, line: null }, { replace: true });
      const group = region.current ? [...region.current.querySelectorAll<HTMLElement>("[data-file]")].find((candidate) => candidate.dataset.file === file.path) : undefined;
      const row = group?.querySelector<HTMLElement>(ROW);
      row?.focus();
      row?.scrollIntoView({ block: "start" });
    },
    onHold(row) {
      const target = targetOf(row);
      if (target === null) return;
      sheetOpener.current = row;
      setSheet(target);
    },
  });

  // --- the review ---------------------------------------------------------------------------------------------------------

  const finish = () => {
    dialogOpener.current = finishButton.current;
    setFinishing(true);
  };
  const leaveDialogForRow = () => {
    const ref = currentRef.current ?? active;
    dialogOpener.current = ref ? rowElement(ref) : null;
    setFinishing(false);
  };
  const submit = async (summary: string): Promise<string | null> => {
    const refusal = await submitReview(page, summary);
    if (refusal === null) {
      leaveDialogForRow();
      void page.reload();
    }
    return refusal;
  };
  const discard = async (): Promise<string | null> => {
    const refusal = await discardReview(page);
    if (refusal === null) {
      leaveDialogForRow();
      void page.reload();
    }
    return refusal;
  };

  const renderThread = (thread: ThreadView) => <ThreadCard key={thread.id} page={page} thread={thread} variant="inline" />;
  const box =
    composer === null ? null : { target: composer, box: <Composer boxName={targetLabel(composer)} reviewing={pending > 0} draft={draft} onPost={postFromBox} onCancel={closeComposer} /> };

  return (
    <div class="sp-diff-screen">
      <DiffToolbar view={view} compare={compare} pending={pending} finishRef={finishButton} onFinish={finish} />
      {refused === null ? null : <Notice>{refused}</Notice>}
      <div ref={region} class="sp-diff-region" onKeyDown={onKeyDown}>
        {diff.error ? (
          <Notice>{diff.error.message}</Notice>
        ) : body === null ? (
          <Skeleton rows={6} height={32} />
        ) : sections.length === 0 ? (
          <p class="sp-muted">There are no changes to show between these versions.</p>
        ) : (
          <DiffGrid
            sections={sections}
            view={view}
            active={active}
            selection={selection}
            placement={placement}
            composer={box}
            renderThread={renderThread}
            onFocusRow={onFocusRow}
            onNumber={onNumber}
            onExpand={(file, gap, direction) => void expand(file, gap, direction)}
          />
        )}
      </div>
      <Sheet name={sheet === null ? "" : targetLabel(sheet)} open={sheet !== null} onClose={() => setSheet(null)} opener={sheetOpener}>
        <div class="sp-dialog__bar">
          <h2 class="sp-dialog__title">{sheet === null ? "" : targetLabel(sheet)}</h2>
        </div>
        <Composer boxName="Comment" reviewing={pending > 0} draft={draft} onPost={postFromSheet} onCancel={() => sheet !== null && closeSheet(sheet)} />
      </Sheet>
      <ReviewDialog open={finishing} count={pending} opener={dialogOpener} onSubmit={submit} onDiscard={discard} onClose={() => setFinishing(false)} />
    </div>
  );
}
