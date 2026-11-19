import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react";
import { Maximize2, Minimize2, Pause, Play, X } from "lucide-react";
import type { LatestProject, RosterStudent } from "../../shared/types";
import { useConfig } from "../lib/config";
import { focusables } from "../lib/focus";
import { prefersReducedMotion } from "../lib/motion";
import { Turntable } from "../render";
import { controlProps, findControl, watchKey } from "../roster/controls";
import { useKeptSnapshot } from "../roster/useKeptSnapshot";
import { fadeOnClock } from "./fade";
import { meshCount } from "./meshCount";
import "./glancet.css";

const NARROW = "(max-width: 599px)";

function subscribeNarrow(notify: () => void): () => void {
  const query = window.matchMedia(NARROW);
  query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
}

const isNarrow = () => window.matchMedia(NARROW).matches;
const keep = { preventScroll: true } as const;

/** The page control that follows the opener's Watch button, outside the viewer. */
function controlAfter(opener: HTMLElement, viewer: HTMLElement): HTMLElement | null {
  const page = focusables(document.body).filter((element) => !viewer.contains(element));
  const at = page.indexOf(opener);
  return at < 0 ? null : (page[at + 1] ?? null);
}

/** Another modal dialog is open when one is mounted besides the viewer. */
function anotherDialogOpen(viewer: HTMLElement): boolean {
  return Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"]')).some((dialog) => dialog !== viewer && dialog.getAttribute("aria-modal") === "true");
}

interface BarProps {
  nickname: string;
  revision: number | null;
  paused: boolean;
  expanded: boolean;
  canExpand: boolean;
  onPause: () => void;
  onExpand: () => void;
  onClose: () => void;
}

function Bar({ nickname, revision, paused, expanded, canExpand, onPause, onExpand, onClose }: BarProps) {
  return (
    <div className="glancet-bar">
      <div className="glancet-id">
        <p className="glancet-name">{nickname}</p>
        {revision === null ? null : <p className="glancet-rev figures">Rev {revision}</p>}
      </div>
      <div className="glancet-controls">
        <button type="button" className="pill pill--outline pill--icon" aria-label="Pause turntable" aria-pressed={paused} onClick={onPause}>
          {paused ? <Play size={20} aria-hidden="true" /> : <Pause size={20} aria-hidden="true" />}
        </button>
        {canExpand ? (
          <button type="button" className="pill pill--outline pill--icon" aria-label="Expand viewer" aria-expanded={expanded} onClick={onExpand}>
            {expanded ? <Minimize2 size={20} aria-hidden="true" /> : <Maximize2 size={20} aria-hidden="true" />}
          </button>
        ) : null}
        <button type="button" className="pill pill--outline pill--icon" aria-label="Close viewer" onClick={onClose}>
          <X size={20} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

type ViewerState = Omit<BarProps, "nickname" | "revision">;

/** The viewer for a Student with a saved project: the turntable of the revision that has loaded, and the hidden state element. */
function ProjectView({ student, project, bar, paused, open, onReady }: { student: RosterStudent; project: LatestProject; bar: ViewerState; paused: boolean; open: boolean; onReady: () => void }) {
  const { ref, snapshot, revision } = useKeptSnapshot(project);
  return (
    <>
      <Bar nickname={student.nickname} revision={revision ?? project.revision} {...bar} />
      <div className="glancet-stage" ref={ref} data-playing={String(!paused)}>
        {snapshot ? <Turntable snapshot={snapshot} playing={!paused} className="glancet-turntable" onReady={onReady} /> : null}
      </div>
      {open && snapshot && revision !== null ? (
        <div id="qy-glancet-state" className="sr-only" data-student={student.id} data-revision={revision} data-mesh-count={meshCount(snapshot)} />
      ) : null}
    </>
  );
}

function EmptyView({ student, bar, open, onReady }: { student: RosterStudent; bar: ViewerState; open: boolean; onReady: () => void }) {
  useEffect(onReady, [onReady]);
  return (
    <>
      <Bar nickname={student.nickname} revision={null} {...bar} />
      <div className="glancet-stage"><p className="glancet-empty">No saved project yet</p></div>
      {open ? <div id="qy-glancet-state" className="sr-only" data-student={student.id} data-revision={0} data-mesh-count={0} /> : null}
    </>
  );
}

interface ShellProps {
  student: RosterStudent;
  /** False while the viewer fades out. */
  open: boolean;
  focusRequest: number;
  onClose: () => void;
  onGone: () => void;
}

function GlancetShell({ student, open, focusRequest, onClose, onGone }: ShellProps) {
  const { glancetFadeMs } = useConfig();
  const root = useRef<HTMLDivElement>(null);
  const entered = useRef(false);
  const [expanded, setExpanded] = useState(false);
  /** The viewer stays unseen until its first model is drawn, so it never shows an empty stage. */
  const [ready, setReady] = useState(false);
  const markReady = useCallback(() => setReady(true), []);
  useEffect(() => {
    const giveUp = window.setTimeout(markReady, 3000);
    return () => window.clearTimeout(giveUp);
  }, [markReady]);
  const [paused, setPaused] = useState(prefersReducedMotion);
  const narrow = useSyncExternalStore(subscribeNarrow, isNarrow);
  const modal = expanded && !narrow;
  const latest = useRef({ student, modal, onClose, onGone });
  latest.current = { student, modal, onClose, onGone };

  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return undefined;
    if (!open) {
      if (prefersReducedMotion() || glancetFadeMs <= 0) { latest.current.onGone(); return undefined; }
      element.style.pointerEvents = "none";
      const cancel = fadeOnClock(element, Number.parseFloat(getComputedStyle(element).opacity), 0, glancetFadeMs, () => latest.current.onGone());
      return () => { cancel(); element.style.pointerEvents = ""; };
    }
    const first = !entered.current;
    entered.current = true;
    if (prefersReducedMotion() || glancetFadeMs <= 0) { element.style.opacity = ""; return undefined; }
    return fadeOnClock(element, first ? 0 : Number.parseFloat(getComputedStyle(element).opacity), 1, glancetFadeMs, () => element.style.removeProperty("opacity"));
  }, [open, glancetFadeMs]);

  useLayoutEffect(() => {
    if (open && root.current) (focusables(root.current)[0] ?? root.current).focus(keep);
  }, [open, student.id, focusRequest, ready]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const element = root.current;
      if (!element) return;
      const inside = element.contains(document.activeElement);
      if (event.key === "F6" && !latest.current.modal) {
        event.preventDefault();
        if (inside) findControl(watchKey(latest.current.student.id))?.focus(keep);
        else (focusables(element)[0] ?? element).focus(keep);
      } else if (event.key === "Escape" && !event.defaultPrevented && (inside || !anotherDialogOpen(element))) {
        event.preventDefault();
        latest.current.onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const element = root.current;
    if (event.key !== "Tab" || !element) return;
    const items = focusables(element);
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    const active = document.activeElement;
    const atStart = active === first || active === element;
    const opener = findControl(watchKey(student.id));
    if (modal) {
      if (event.shiftKey && atStart) { event.preventDefault(); last.focus(keep); }
      else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(keep); }
    } else if (event.shiftKey && atStart && opener) {
      event.preventDefault();
      opener.focus(keep);
    } else if (!event.shiftKey && active === last && opener) {
      const next = controlAfter(opener, element);
      if (next) { event.preventDefault(); next.focus(keep); }
    }
  };

  const bar: ViewerState = {
    paused, expanded, canExpand: !narrow,
    onPause: () => setPaused((current) => !current),
    onExpand: () => setExpanded((current) => !current),
    onClose,
  };
  const className = `glancet${expanded ? " glancet--expanded" : ""}${modal ? " glancet--modal" : ""}${ready ? "" : " glancet--loading"}`;
  let view: ReactNode;
  if (student.latestProject) view = <ProjectView student={student} project={student.latestProject} bar={bar} paused={paused} open={open} onReady={markReady} />;
  else view = <EmptyView student={student} bar={bar} open={open} onReady={markReady} />;

  return (
    <div
      ref={root}
      className={className}
      role="dialog"
      aria-label={`Glancet: ${student.nickname}`}
      aria-modal={modal ? true : undefined}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      {...controlProps("glancet")}
    >
      {view}
    </div>
  );
}

interface GlancetProps {
  /** The Student being watched; null while the viewer is closed. */
  student: RosterStudent | null;
  /** Changes each time a Watch button is pressed, so pressing it again moves focus into the open viewer. */
  focusRequest: number;
  onClose: () => void;
}

/**
 * The docked viewer: one non-modal dialog fixed to the corner of the viewport (modal while expanded) showing a turntable
 * of a Student's latest saved revision. It stays mounted while it fades out.
 */
export function Glancet({ student, focusRequest, onClose }: GlancetProps) {
  const { glancetFadeMs } = useConfig();
  const [held, setHeld] = useState(student);
  const [mounted, setMounted] = useState(student !== null);
  if (student && student !== held) setHeld(student);
  if (student && !mounted) setMounted(true);
  if (!student && mounted && (prefersReducedMotion() || glancetFadeMs <= 0)) setMounted(false);
  if (!mounted || !held) return null;
  return <GlancetShell student={held} open={student !== null} focusRequest={focusRequest} onClose={onClose} onGone={() => setMounted(false)} />;
}
