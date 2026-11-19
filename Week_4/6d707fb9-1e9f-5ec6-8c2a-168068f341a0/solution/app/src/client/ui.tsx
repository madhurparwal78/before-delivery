import type { ComponentChildren, JSX, RefObject } from "preact";
import { createPortal } from "preact/compat";
import { useCallback, useLayoutEffect, useRef, useState } from "preact/hooks";
import { MEASURE_NAMES, STAGE_NAMES, STAGES, type StageId } from "../shared/catalog";
import type { Measure } from "../shared/api";
import { ApiFailure, announce, clearDraft, draftFor, failureText, focusHeading, setActiveForm, sessionEnded, saveDraft, useAction } from "./lib";

// ---- buttons

interface ButtonProps {
  children: ComponentChildren;
  onPress?: (event: Event) => void;
  busy?: boolean;
  busyText?: string;
  green?: boolean;
  /** At the end of a list: focusable, says so, does nothing. */
  inactive?: boolean;
  type?: "button" | "submit";
  class?: string;
  id?: string;
  label?: string;
  [data: `data-${string}`]: string;
}

/** Never the disabled attribute: a pending button keeps focus and refuses a second press. */
export function Button({ children, onPress, busy, busyText = "Working…", green, inactive, type = "button", label, ...rest }: ButtonProps): JSX.Element {
  const off = busy || inactive;
  return (
    <button
      {...rest}
      type={type}
      aria-label={busy ? undefined : label}
      aria-disabled={off ? "true" : undefined}
      class={`button${green ? " button-green" : ""}${rest.class ? ` ${rest.class}` : ""}`}
      onClick={(event) => {
        if (off) {
          event.preventDefault();
          return;
        }
        onPress?.(event);
      }}
    >
      {busy ? busyText : children}
    </button>
  );
}

export const Hidden = ({ children }: { children: ComponentChildren }): JSX.Element => <span class="sr-only">{children}</span>;

// ---- presence: an opening and a closing that never undo each other

export function usePresence(open: boolean, ref: RefObject<HTMLElement>): { mounted: boolean; closing: boolean } {
  const [mounted, setMounted] = useState(open);
  const token = useRef(0);
  if (open && !mounted) setMounted(true);

  useLayoutEffect(() => {
    token.current += 1;
    if (open || !mounted) return;
    const mine = token.current;
    const element = ref.current;
    const motions = element ? element.getAnimations({ subtree: true }) : [];
    if (!motions.length) {
      setMounted(false);
      return;
    }
    void Promise.allSettled(motions.map((motion) => motion.finished)).then(() => {
      if (mine === token.current) setMounted(false);
    });
  }, [open]);

  return { mounted: mounted || open, closing: mounted && !open };
}

// ---- dialogs, sheets and popovers

export interface DialogControl {
  open: boolean;
  show: (event?: Event) => void;
  hide: () => void;
  opener: RefObject<HTMLElement | null>;
}

/** The dialog's opening state; a draft kept through a session end opens it again. */
export function useDialog(id?: string): DialogControl {
  const [open, setOpen] = useState(() => Boolean(id && draftFor(id)));
  const opener = useRef<HTMLElement | null>(null);
  const show = useCallback((event?: Event) => {
    opener.current = ((event?.currentTarget as HTMLElement | null) ?? (document.activeElement as HTMLElement | null));
    setOpen(true);
  }, []);
  const hide = useCallback(() => setOpen(false), []);
  return { open, show, hide, opener };
}

const TABBABLE = 'a[href],button,input,select,textarea,[tabindex="0"]';

function tabStops(box: HTMLElement): HTMLElement[] {
  return [...box.querySelectorAll<HTMLElement>(TABBABLE)].filter((element) => {
    if (element.getClientRects().length === 0 && !(element instanceof HTMLInputElement && element.type === "radio")) return false;
    if (element instanceof HTMLInputElement && element.type === "radio" && !element.checked) {
      const group = box.querySelectorAll<HTMLInputElement>(`input[type=radio][name="${element.name}"]`);
      return ![...group].some((radio) => radio.checked);
    }
    return true;
  });
}

interface ModalProps {
  name: string;
  control: DialogControl;
  /** dialog: centred, full-height below 768. side: the Unit sheet. popover: uncut in the viewport. */
  kind?: "dialog" | "side" | "popover" | "menu-sheet" | "top-sheet";
  dismissOutside?: boolean;
  children: ComponentChildren;
}

export function Modal({ name, control, kind = "dialog", dismissOutside, children }: ModalProps): JSX.Element | null {
  const box = useRef<HTMLDivElement>(null);
  const shade = useRef<HTMLDivElement>(null);
  const { mounted, closing } = usePresence(control.open, shade);
  const wasOpen = useRef(false);

  useLayoutEffect(() => {
    const page = document.getElementById("root") as HTMLElement;
    if (control.open && !wasOpen.current) {
      wasOpen.current = true;
      page.inert = true;
      const first = box.current?.querySelector<HTMLElement>("input:not([type=radio]):not([type=checkbox]),select,textarea") ?? (box.current ? tabStops(box.current)[0] : null);
      first?.focus();
    }
    if (!control.open && wasOpen.current) {
      wasOpen.current = false;
      page.inert = false;
      setActiveForm(null);
      const opener = control.opener.current;
      if (opener?.isConnected) opener.focus();
      else focusHeading();
    }
  }, [control.open, mounted]);

  useLayoutEffect(
    () => () => {
      if (wasOpen.current) (document.getElementById("root") as HTMLElement).inert = false;
    },
    [],
  );

  useLayoutEffect(() => {
    if (!control.open) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        control.hide();
        return;
      }
      if (event.key !== "Tab" || !box.current) return;
      const stops = tabStops(box.current);
      const band = document.querySelector<HTMLElement>("[data-session-link]");
      if (band) stops.push(band);
      const first = stops[0];
      const last = stops[stops.length - 1];
      if (!first || !last) return;
      const here = document.activeElement;
      if (event.shiftKey && (here === first || !stops.includes(here as HTMLElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (here === last || !stops.includes(here as HTMLElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [control.open]);

  if (!mounted) return null;
  return createPortal(
    <div
      ref={shade}
      class={`shade shade-${kind}${closing ? " is-closing" : ""}`}
      inert={closing}
      onPointerDown={(event) => {
        if (!dismissOutside || !box.current) return;
        const inside = box.current.getBoundingClientRect();
        const within = event.clientX >= inside.left && event.clientX <= inside.right && event.clientY >= inside.top && event.clientY <= inside.bottom;
        if (!within) control.hide();
      }}
    >
      <div ref={box} class={`panel-${kind}${closing ? " is-closing" : ""}`} role="dialog" aria-modal="true" aria-label={name} tabIndex={-1}>
        {children}
      </div>
    </div>,
    document.getElementById("overlays") as HTMLElement,
  );
}

// ---- forms

export interface FormApi<T> {
  values: T;
  set: <K extends keyof T>(key: K, value: T[K]) => void;
  busy: boolean;
  problems: { message: string | null; fields: Record<string, string> };
  submit: (work: () => Promise<void>) => Promise<void>;
  summary: RefObject<HTMLDivElement>;
  refuse: (message: string, fields?: Record<string, string>) => void;
}

/** One form: as typed through a refusal, a refresh and, by its draft, a session end. */
export function useForm<T extends Record<string, unknown>>(dialog: string | null, initial: T): FormApi<T> {
  const [values, setValues] = useState<T>(() => ({ ...initial, ...(dialog ? draftFor(dialog) : null) }) as T);
  const [problems, setProblems] = useState<FormApi<T>["problems"]>({ message: null, fields: {} });
  const [busy, run] = useAction();
  const summary = useRef<HTMLDivElement>(null);
  const [focusTick, setFocusTick] = useState(0);
  const current = useRef(values);
  current.current = values;

  useLayoutEffect(() => {
    if (!dialog) return undefined;
    setActiveForm({ dialog, values: () => current.current });
    if (sessionEnded.get()) saveDraft();
    clearDraft();
    return undefined;
  }, []);

  useLayoutEffect(() => {
    if (focusTick) summary.current?.focus();
  }, [focusTick]);

  const refuse = (message: string, fields: Record<string, string> = {}): void => {
    setProblems({ message, fields });
    setFocusTick((tick) => tick + 1);
    announce(message);
  };

  const submit = async (work: () => Promise<void>): Promise<void> => {
    await run(async () => {
      setProblems({ message: null, fields: {} });
      try {
        await work();
      } catch (error) {
        if (error instanceof ApiFailure && error.status === 401 && error.code !== "invalid_credentials") return;
        refuse(failureText(error), error instanceof ApiFailure ? error.fields : undefined);
      }
    });
  };

  return {
    values,
    set: (key, value) => setValues((previous) => ({ ...previous, [key]: value })),
    busy,
    problems,
    submit,
    summary,
    refuse,
  };
}

const fieldId = (key: string): string => `field-${key}`;

/** Which field a server key lands on when the form has no field of that exact name. */
export function Problems({ form, title = "Problems", aliases = {}, onField }: { form: Pick<FormApi<Record<string, unknown>>, "problems" | "summary">; title?: string; aliases?: Record<string, string>; onField?: (key: string) => void }): JSX.Element | null {
  const { message, fields } = form.problems;
  const keys = Object.keys(fields);
  if (!message && !keys.length) return null;
  return (
    <div ref={form.summary} class="problems" role="region" aria-label={title} tabIndex={-1}>
      {keys.length ? (
        <ul>
          {keys.map((key) => (
            <li key={key}>
              <a
                href={`#${fieldId(aliases[key] ?? key)}`}
                onClick={(event) => {
                  event.preventDefault();
                  onField?.(key);
                  setTimeout(() => document.getElementById(fieldId(aliases[key] ?? key))?.focus(), 0);
                }}
              >
                {fields[key]}
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p>{message}</p>
      )}
    </div>
  );
}

interface FieldProps {
  form: { problems: { fields: Record<string, string> } };
  name: string;
  label: string;
  value: string;
  onValue: (value: string) => void;
  type?: string;
  options?: { value: string; label: string }[];
  autoComplete?: string;
  inputMode?: "decimal" | "numeric" | "text";
  dir?: "ltr" | "rtl";
  rows?: number;
  hint?: string;
  aliasOf?: string[];
}

export function Field({ form, name, label, value, onValue, type = "text", options, autoComplete, inputMode, dir, rows, hint, aliasOf = [] }: FieldProps): JSX.Element {
  const invalid = [name, ...aliasOf].some((key) => form.problems.fields[key]);
  const shared = {
    id: fieldId(name),
    "aria-invalid": invalid ? ("true" as const) : undefined,
  };
  return (
    <div class="field">
      <label for={fieldId(name)}>{label}</label>
      {hint ? <p class="hint">{hint}</p> : null}
      {options ? (
        <select {...shared} value={value} onChange={(event) => onValue(event.currentTarget.value)}>
          {options.map((option) => (
            <option key={option.value} value={option.value} label={option.label}>
              {option.label}
            </option>
          ))}
        </select>
      ) : rows ? (
        <textarea {...shared} rows={rows} value={value} onInput={(event) => onValue(event.currentTarget.value)} />
      ) : (
        <input
          {...shared}
          type={type}
          value={value}
          dir={dir}
          autoComplete={autoComplete}
          inputMode={inputMode}
          onInput={(event) => onValue(event.currentTarget.value)}
        />
      )}
    </div>
  );
}

// ---- the frame a wide table scrolls inside

export function TableFrame({ name, children }: { name: string; children: ComponentChildren }): JSX.Element {
  return (
    <div class="table-frame" role="region" aria-label={name} tabIndex={0}>
      {children}
    </div>
  );
}

// ---- rolling numerals

function reduced(): boolean {
  return matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** The old figure moves one line up and out while the new one moves up into place. */
export function RollingFigure({ text, part, stage }: { text: string; part: string; stage?: string }): JSX.Element {
  const [previous, setPrevious] = useState<{ text: string; key: number } | null>(null);
  const shown = useRef(text);
  const counter = useRef(0);
  const box = useRef<HTMLSpanElement>(null);

  if (shown.current !== text) {
    if (!reduced()) {
      counter.current += 1;
      setPrevious({ text: shown.current, key: counter.current });
    }
    shown.current = text;
  }

  useLayoutEffect(() => {
    if (!previous) return;
    const mine = previous.key;
    const motions = box.current?.getAnimations({ subtree: true }) ?? [];
    void Promise.allSettled(motions.map((motion) => motion.finished)).then(() => {
      setPrevious((current) => (current?.key === mine ? null : current));
    });
  }, [previous]);

  return (
    <span ref={box} class={`roll${previous ? " is-rolling" : ""}`} data-part={part} data-stage={stage}>
      {previous ? (
        <span key={`old-${previous.key}`} class="roll-old" aria-hidden="true">
          {previous.text}
        </span>
      ) : null}
      <span key={`new-${previous?.key ?? 0}`} class="roll-new">
        {text}
      </span>
    </span>
  );
}

// ---- Stage strata

const shareNumber = (share: string): number => Number(share);

/** Only a position on screen: no published figure passes through these numbers. */
function markerAt(measure: Measure, stacked: boolean): JSX.CSSProperties {
  const index = STAGES.indexOf(measure.hotspot);
  if (stacked) return { top: `${(index + 0.5) * 20}%` };
  const before = measure.stages.slice(0, index).reduce((sum, stage) => sum + shareNumber(stage.share), 0);
  const own = shareNumber((measure.stages[index] as Measure["stages"][number]).share);
  return { left: `${Math.min(99, before + own / 2)}%` };
}

interface StrataProps {
  measure: Measure;
  stacked: boolean;
  ghost?: Measure | null;
  onStage?: (stage: StageId, event: Event) => void;
}

/** The same elements move: widths, numerals and the marker are never redrawn. */
export function Strata({ measure, stacked, ghost, onStage }: StrataProps): JSX.Element {
  return (
    <div class="strata-wrap">
      <div class="strata" data-part="strata">
        {STAGES.map((stage) => {
          const figure = measure.stages.find((entry) => entry.stage === stage) as Measure["stages"][number];
          return (
            <div
              key={stage}
              class={`stratum weave-${stage}${onStage ? " is-pressable" : ""}`}
              data-part="stratum"
              data-stage={stage}
              data-share={figure.share}
              style={{ "--share": `${figure.share}%` }}
              onClick={onStage ? (event) => onStage(stage, event) : undefined}
            >
              <span class="stratum-name">{STAGE_NAMES[stage]}</span>
              <span class="stratum-bar" />
            </div>
          );
        })}
        <span class="hotspot" data-part="hotspot-marker" data-stage={measure.hotspot} style={markerAt(measure, stacked)} aria-hidden="true" />
      </div>
      {ghost ? (
        <div class="strata strata-ghost" aria-hidden="true">
          {STAGES.map((stage) => {
            const figure = ghost.stages.find((entry) => entry.stage === stage) as Measure["stages"][number];
            return <div key={stage} class={`stratum weave-${stage}`} data-part="ghost-stratum" data-stage={stage} style={{ "--share": `${figure.share}%` }}><span class="stratum-bar" /></div>;
          })}
        </div>
      ) : null}
      <dl class="stage-figures">
        {STAGES.map((stage) => {
          const figure = measure.stages.find((entry) => entry.stage === stage) as Measure["stages"][number];
          return (
            <div key={stage} class={`stage-figure${onStage ? " is-pressable" : ""}`} onClick={onStage ? (event) => onStage(stage, event) : undefined}>
              <dt>
                <span class={`swatch weave-${stage}`} aria-hidden="true" />
                {STAGE_NAMES[stage]}
              </dt>
              <dd>
                <RollingFigure text={figure.shown} part="stratum-figure" stage={stage} /> <span class="share">{figure.share}%</span>
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}

export function measureLine(measure: Measure): string {
  return `${MEASURE_NAMES[measure.measure]}: ${measure.totalShown}, hotspot ${STAGE_NAMES[measure.hotspot]}.`;
}
