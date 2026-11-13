// Shared controls: forms, actions, dialogs, sheets, the action bar and the live regions.

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ApiFailure } from "./api";
import { MEDIUM, play, SHORT } from "./motion";
import {
  announce, clearAnnouncement, closeDialog, focusHeading, isSessionEnded, leaveForSignIn, markClosing, navigate, openDialog, readField, seedForm,
  takeHeadingFocus, useAnnouncement, useFormVersion, useOpenDialogId, writeField,
} from "./stores";

// Polling: every staff, member and visit screen re-reads every 5 seconds while open.

const REFRESH_MS = 5000;

interface Loaded<T> {
  data: T | null;
  failed: ApiFailure | null;
  reload: () => Promise<void>;
}

export function useLoad<T>(load: () => Promise<T>, key: string, poll = true): Loaded<T> {
  const [data, setData] = useState<T | null>(null);
  const [failed, setFailed] = useState<ApiFailure | null>(null);
  const latest = useRef(0);
  const loader = useRef(load);
  loader.current = load;

  const reload = useCallback(async () => {
    if (isSessionEnded()) return;
    latest.current += 1;
    const ticket = latest.current;
    try {
      const value = await loader.current();
      if (ticket === latest.current) {
        setData(value);
        setFailed(null);
      }
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error;
      if (ticket === latest.current) setFailed(error);
    }
  }, []);

  useEffect(() => {
    setData(null);
    setFailed(null);
    void reload();
    if (!poll) return undefined;
    const timer = setInterval(() => void reload(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [key, poll, reload]);

  return { data, failed, reload };
}

// Actions: a pending state, then the action's own copy or the refusal.

interface Problem {
  message: string;
  fields: Record<string, string>;
  stamp: number;
  moveFocus: boolean;
}

export interface Action {
  pending: boolean;
  problem: Problem | null;
  run: (work: () => Promise<string | null>) => Promise<boolean>;
  refuse: (message: string, moveFocus: boolean) => void;
  clear: () => void;
}

export function useAction(): Action {
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const busy = useRef(false);
  const stamp = useRef(0);

  const refuse = useCallback((message: string, moveFocus: boolean, fields: Record<string, string> = {}) => {
    stamp.current += 1;
    setProblem({ message, fields, stamp: stamp.current, moveFocus });
    announce(message);
  }, []);

  const run = useCallback(async (work: () => Promise<string | null>) => {
    if (busy.current) return false;
    busy.current = true;
    setPending(true);
    setProblem(null);
    announce("Working on it.");
    try {
      const copy = await work();
      if (copy !== null) announce(copy);
      return true;
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error;
      if (error.code === "session_ended") return false;
      refuse(error.message, true, error.fields);
      return false;
    } finally {
      busy.current = false;
      setPending(false);
    }
  }, [refuse]);

  const clear = useCallback(() => setProblem(null), []);

  return { pending, problem, run, refuse, clear };
}

// Forms.

export interface Form {
  id: string;
  value: (name: string) => string;
  set: (name: string, value: string) => void;
}

export function useForm(id: string, initial: Readonly<Record<string, string>>): Form {
  useState(() => seedForm(id, initial));
  useFormVersion();
  return {
    id,
    value: (name) => readField(id, name),
    set: (name, value) => writeField(id, name, value),
  };
}

const fieldId = (form: string, name: string): string => `${form}-${name}`;

interface FieldProps {
  form: Form;
  name: string;
  label: string;
  problem: Problem | null;
  type?: "text" | "email" | "password" | "tel" | "number";
  inputMode?: "numeric" | "tel" | "text";
  autoComplete?: string;
  hint?: string;
}

function FieldError({ id, message }: { id: string; message: string | undefined }) {
  return message ? <p id={id} className="field-error">{message}</p> : null;
}

export function TextField({ form, name, label, problem, type = "text", inputMode, autoComplete, hint }: FieldProps) {
  const id = fieldId(form.id, name);
  const error = problem?.fields[name];
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const described = [hint ? hintId : "", error ? errorId : ""].filter(Boolean).join(" ");
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {hint ? <p id={hintId} className="field-hint">{hint}</p> : null}
      <input
        id={id}
        type={type}
        value={form.value(name)}
        onChange={(event) => form.set(name, event.target.value)}
        {...(inputMode ? { inputMode } : {})}
        {...(autoComplete ? { autoComplete } : {})}
        {...(described ? { "aria-describedby": described } : {})}
        {...(error ? { "aria-invalid": true } : {})}
      />
      <FieldError id={errorId} message={error} />
    </div>
  );
}

export function TextArea({ form, name, label, problem, rows = 5 }: Pick<FieldProps, "form" | "name" | "label" | "problem"> & { rows?: number }) {
  const id = fieldId(form.id, name);
  const error = problem?.fields[name];
  const errorId = `${id}-error`;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <textarea
        id={id}
        rows={rows}
        value={form.value(name)}
        onChange={(event) => form.set(name, event.target.value)}
        {...(error ? { "aria-invalid": true, "aria-describedby": errorId } : {})}
      />
      <FieldError id={errorId} message={error} />
    </div>
  );
}

interface Choice {
  value: string;
  label: string;
}

export function SelectField({ form, name, label, problem, choices, prompt }: Pick<FieldProps, "form" | "name" | "label" | "problem"> & { choices: readonly Choice[]; prompt?: string }) {
  const id = fieldId(form.id, name);
  const error = problem?.fields[name];
  const errorId = `${id}-error`;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        value={form.value(name)}
        onChange={(event) => form.set(name, event.target.value)}
        {...(error ? { "aria-invalid": true, "aria-describedby": errorId } : {})}
      >
        {prompt ? <option value="">{prompt}</option> : null}
        {choices.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
      </select>
      <FieldError id={errorId} message={error} />
    </div>
  );
}

export function RadioGroup({ form, name, label, problem, choices }: Pick<FieldProps, "form" | "name" | "label" | "problem"> & { choices: readonly Choice[] }) {
  const labelId = useId();
  const id = fieldId(form.id, name);
  const error = problem?.fields[name];
  return (
    <div id={id} role="radiogroup" aria-labelledby={labelId} className="radio-group" tabIndex={-1}>
      <p id={labelId} className="group-label">{label}</p>
      <div className="radio-options">
        {choices.map((choice) => (
          <label key={choice.value} className="radio-option">
            <input
              type="radio"
              name={id}
              value={choice.value}
              checked={form.value(name) === choice.value}
              onChange={() => form.set(name, choice.value)}
            />
            <span>{choice.label}</span>
          </label>
        ))}
      </div>
      <FieldError id={`${id}-error`} message={error} />
    </div>
  );
}

// The Problems region of a refused form outside a dialog: one link per field error, and focus on arrival.

export function Problems({ form, action }: { form: string; action: Action }) {
  const region = useRef<HTMLDivElement>(null);
  const problem = action.problem;
  useEffect(() => {
    if (problem?.moveFocus) region.current?.focus();
  }, [problem]);
  if (!problem) return null;
  const entries = Object.entries(problem.fields);
  return (
    <div ref={region} role="region" aria-label="Problems" tabIndex={-1} className="problems">
      {entries.length === 0 ? <p>{problem.message}</p> : (
        <ul>
          {entries.map(([name, copy]) => (
            <li key={name}>
              <a
                href={`#${fieldId(form, name)}`}
                onClick={(event) => {
                  event.preventDefault();
                  focusField(fieldId(form, name));
                }}
              >
                {copy}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function focusField(id: string): void {
  const field = document.getElementById(id);
  if (!field) return;
  const target = field.matches("input, select, textarea") ? field : field.querySelector<HTMLElement>("input:checked, input");
  (target ?? field).focus();
}

// A refused dialog's message, which takes focus.

export function DialogMessage({ action }: { action: Action }) {
  const message = useRef<HTMLParagraphElement>(null);
  const problem = action.problem;
  useEffect(() => {
    if (problem?.moveFocus) message.current?.focus();
  }, [problem]);
  if (!problem) return null;
  return <p ref={message} className="dialog-message" tabIndex={-1}>{problem.message}</p>;
}

// Buttons.

interface ActionButtonProps {
  action?: Action;
  children: ReactNode;
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  type?: "button" | "submit";
  kind?: "primary" | "secondary" | "quiet";
  disabled?: boolean;
  ariaLabel?: string;
}

export function Button({ action, children, onClick, type = "button", kind = "primary", disabled, ariaLabel }: ActionButtonProps) {
  const pending = action?.pending ?? false;
  return (
    <button
      type={type}
      className={`button button-${kind}`}
      aria-disabled={pending ? true : undefined}
      disabled={disabled}
      aria-label={ariaLabel}
      onClick={(event) => {
        if (pending) {
          event.preventDefault();
          return;
        }
        onClick?.(event);
      }}
    >
      {children}
    </button>
  );
}

export function Link({ to, children, className, ariaLabel, onFollow }: { to: string; children: ReactNode; className?: string; ariaLabel?: string; onFollow?: () => void }) {
  return (
    <a
      href={to}
      className={className}
      aria-label={ariaLabel}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey) return;
        event.preventDefault();
        clearAnnouncement();
        onFollow?.();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}

// The main action: a bar fixed to the bottom at 375, in the normal flow from 768.

export function ActionBar({ children, always }: { children: ReactNode; always?: boolean }) {
  return <div className={always ? "action-bar action-bar-always" : "action-bar"}>{children}</div>;
}

export function OpenerButton({ dialog, children, kind }: { dialog: string; children: ReactNode; kind?: "primary" | "secondary" | "quiet" }) {
  return (
    <Button kind={kind ?? "primary"} onClick={(event) => openDialog(dialog, event.currentTarget)}>
      {children}
    </Button>
  );
}

// The level-one heading. It takes focus when the app navigated here, and when a focused control disappears.

export function PageHeading({ children }: { children: ReactNode }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => {
    if (takeHeadingFocus()) heading.current?.focus({ preventScroll: true });
  }, []);
  return <h1 ref={heading} tabIndex={-1}>{children}</h1>;
}

// Announcements, outside the page so an open dialog never makes it inert.

function SignInAgainLink({ className }: { className?: string }) {
  return (
    <a
      href="/signin"
      className={className}
      onClick={(event) => {
        event.preventDefault();
        leaveForSignIn();
      }}
    >
      Sign in again
    </a>
  );
}

export function Announcements() {
  const { text, signInAgain } = useAnnouncement();
  const overlays = document.getElementById("overlays");
  if (!overlays) return null;
  return createPortal(
    <div role="status" aria-live="polite" aria-label="Announcements" className={text ? "announcements" : "announcements announcements-empty"}>
      {text}
      {signInAgain ? <> <SignInAgainLink className="announcement-link" /></> : null}
    </div>,
    overlays,
  );
}

// Dialogs, sheets and the draw popover.

const FOCUSABLE = "a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex='0']";

function tabStops(panel: HTMLElement): HTMLElement[] {
  const all = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) => element.getClientRects().length > 0);
  return all.filter((element) => {
    if (!(element instanceof HTMLInputElement) || element.type !== "radio") return true;
    const group = all.filter((other): other is HTMLInputElement => other instanceof HTMLInputElement && other.type === "radio" && other.name === element.name);
    const checked = group.find((radio) => radio.checked);
    return element === (checked ?? group[0]);
  });
}

function firstFocus(panel: HTMLElement): HTMLElement {
  const field = panel.querySelector<HTMLElement>("input:checked, input:not([type=radio]):not(:disabled), select:not(:disabled), textarea:not(:disabled), input:not(:disabled)");
  return field ?? panel.querySelector<HTMLElement>("[data-first] button, [data-first] a") ?? panel.querySelector<HTMLElement>("button") ?? panel;
}

type DialogKind = "dialog" | "sheet" | "popover";

const OPEN_FRAMES: Record<DialogKind, Keyframe[]> = {
  dialog: [{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "translateY(0)" }],
  sheet: [{ transform: "translateY(100%)" }, { transform: "translateY(0)" }],
  popover: [{ opacity: 0 }, { opacity: 1 }],
};
const CLOSE_FRAMES: Record<DialogKind, Keyframe[]> = {
  dialog: [{ opacity: 1 }, { opacity: 0 }],
  sheet: [{ transform: "translateY(0)" }, { transform: "translateY(100%)" }],
  popover: [{ opacity: 1 }, { opacity: 0 }],
};
const DURATION: Record<DialogKind, number> = { dialog: SHORT, sheet: MEDIUM, popover: SHORT };

interface DialogProps {
  id: string;
  title: string;
  kind?: DialogKind;
  action?: Action;
  anchor?: () => DOMRect | null;
  children: ReactNode;
}

export function Dialog({ id, title, kind = "dialog", action, anchor, children }: DialogProps) {
  const open = useOpenDialogId() === id;
  const [mounted, setMounted] = useState(open);
  const closing = !open;
  const panel = useRef<HTMLDivElement>(null);
  const running = useRef<Animation | null>(null);
  const wasOpen = useRef(false);
  const titleId = useId();
  const { signInAgain } = useAnnouncement();

  if (open && !mounted) setMounted(true);

  useLayoutEffect(() => {
    const element = panel.current;
    if (open && !wasOpen.current) {
      wasOpen.current = true;
      markClosing(id, false);
      running.current?.cancel();
      if (element) {
        if (anchor) placeNear(element, anchor());
        firstFocus(element).focus();
        running.current = play(element, OPEN_FRAMES[kind], DURATION[kind]);
      }
    } else if (!open && wasOpen.current) {
      wasOpen.current = false;
      markClosing(id, true);
      running.current?.cancel();
      const finish = (): void => {
        markClosing(id, false);
        setMounted(false);
      };
      running.current = element ? play(element, CLOSE_FRAMES[kind], DURATION[kind], finish) : null;
      if (!element) finish();
    }
  }, [open, id, kind, anchor]);

  useEffect(() => () => markClosing(id, false), [id]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      const element = panel.current;
      if (!element) return;
      if (event.key === "Escape") {
        event.preventDefault();
        closeDialog();
      } else if (event.key === "Tab") {
        const stops = tabStops(element);
        const first = stops[0];
        const last = stops.at(-1);
        if (!first || !last) {
          event.preventDefault();
        } else if (event.shiftKey && (document.activeElement === first || !element.contains(document.activeElement))) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !element.contains(document.activeElement))) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const overlays = document.getElementById("overlays");
  if (!mounted || !overlays) return null;
  return createPortal(
    <div className={`overlay overlay-${kind}${closing ? " overlay-closing" : ""}`} inert={closing || undefined} aria-hidden={closing || undefined}>
      <div className="scrim" onClick={kind === "sheet" ? closeDialog : undefined} />
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} className={`panel panel-${kind}`}>
        <div className="panel-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="button button-quiet" onClick={closeDialog}>Close</button>
        </div>
        {signInAgain ? <p className="dialog-message"><SignInAgainLink className="inline-action" /></p> : null}
        {action ? <DialogMessage action={action} /> : null}
        <div data-first>{children}</div>
      </div>
    </div>,
    overlays,
  );
}

const POPOVER_GAP = 8;
const VIEWPORT_MARGIN = 16;

// The popover sits next to its station and always fully inside the viewport.
function placeNear(panel: HTMLElement, station: DOMRect | null): void {
  const box = panel.getBoundingClientRect();
  const maxLeft = window.innerWidth - box.width - VIEWPORT_MARGIN;
  const maxTop = window.innerHeight - box.height - VIEWPORT_MARGIN;
  const below = station ? station.bottom + POPOVER_GAP : VIEWPORT_MARGIN;
  const above = station ? station.top - box.height - POPOVER_GAP : VIEWPORT_MARGIN;
  const top = below <= maxTop ? below : Math.max(VIEWPORT_MARGIN, Math.min(above, maxTop));
  const left = Math.max(VIEWPORT_MARGIN, Math.min(station ? station.left : VIEWPORT_MARGIN, maxLeft));
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
}

export function onSubmit(handler: () => void): (event: FormEvent) => void {
  return (event) => {
    event.preventDefault();
    handler();
  };
}

// Keeps focus usable: a focused control is scrolled into view, and one that vanished hands focus to the heading.

export function useFocusKeeper(): void {
  useEffect(() => {
    let last: Element | null = null;
    const onFocus = (event: FocusEvent): void => {
      if (!(event.target instanceof Element)) return;
      last = event.target;
      // A focused field shows whole, not only its caret, between the top bar and the bottom bar.
      event.target.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
    };
    const watcher = new MutationObserver(() => {
      if (document.activeElement === document.body && last && !last.isConnected) {
        last = null;
        focusHeading();
      }
    });
    document.addEventListener("focusin", onFocus);
    const page = document.getElementById("app");
    if (page) watcher.observe(page, { childList: true, subtree: true });
    return () => {
      document.removeEventListener("focusin", onFocus);
      watcher.disconnect();
    };
  }, []);
}

export function useMedia(query: string): boolean {
  const subscribe = useCallback((change: () => void) => {
    const list = window.matchMedia(query);
    list.addEventListener("change", change);
    return () => list.removeEventListener("change", change);
  }, [query]);
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches);
}

export function Skeleton({ blocks = 2 }: { blocks?: number }) {
  return (
    <div className="stack" aria-hidden="true">
      {Array.from({ length: blocks }, (_, index) => <div key={index} className="card skeleton" />)}
    </div>
  );
}

export function StatePill({ children, tone }: { children: ReactNode; tone?: "good" | "warn" | "calm" }) {
  return <span className={`pill pill-${tone ?? "calm"}`}>{children}</span>;
}

// Fraunces carries no tabular figures, so each digit of a large numeral sits in its own equal cell.
export function Figures({ text }: { text: string }) {
  return <>{text.split(/(\d)/).map((part, index) => (/\d/.test(part) ? <span key={index} className="figure">{part}</span> : part))}</>;
}
