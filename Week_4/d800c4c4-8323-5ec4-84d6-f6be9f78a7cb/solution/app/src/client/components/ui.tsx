import type { ComponentChildren, JSX, RefObject } from "preact";
import { useEffect, useLayoutEffect, useRef } from "preact/hooks";
import { dollars } from "../format";

/** Repeats `work` every `ms` while active, each run starting after the previous one finished. */
export function usePoll(work: () => Promise<void>, ms: number, active = true): void {
  const saved = useRef(work);
  saved.current = work;
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    let timer = 0;
    const tick = async () => {
      await saved.current();
      if (!stopped) timer = window.setTimeout(tick, ms);
    };
    timer = window.setTimeout(tick, ms);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [ms, active]);
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** A live region whose whole text is replaced by each announcement. */
export function Announcements({ label, text, signInAgain }: { label: string; text: string; signInAgain: string | null }) {
  return (
    <>
      <div role="status" aria-label={label} aria-live="polite" class="announcements">
        {text}
      </div>
      {signInAgain && (
        <a class="sign-in-again" href={signInAgain} id="sign-in-again">
          Sign in again
        </a>
      )}
    </>
  );
}

export interface Problem {
  field: string;
  label: string;
  message: string;
  /** The element focused by the summary link (defaults to the element with id `field`). */
  target?: string;
}

const SUMMARY = "Check the highlighted fields.";

/** The page's one form-problems summary: one link per invalid field, focusable but not in the Tab order. */
export function FormProblems({ problems, summaryRef }: { problems: Problem[]; summaryRef: RefObject<HTMLDivElement> }) {
  return (
    <div role="alert" aria-label="Form problems" tabIndex={-1} ref={summaryRef} class={problems.length ? "problems" : "problems is-empty"}>
      {problems.length > 0 && (
        <>
          <p class="problems-head">{SUMMARY}</p>
          <ul>
            {problems.map((p) => (
              <li key={p.field}>
                <a
                  href={`#${p.target ?? p.field}`}
                  onClick={(event) => {
                    event.preventDefault();
                    document.getElementById(p.target ?? p.field)?.focus();
                  }}
                >
                  {p.label}: {p.message}
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export function FieldMessage({ id, message }: { id: string; message: string | undefined }) {
  return message ? (
    <p class="field-message" id={`${id}-message`}>
      {message}
    </p>
  ) : null;
}

/** A button that shows its pending label while its request runs and ignores further activation. */
export function ActionButton({
  label,
  pendingLabel,
  pending,
  onAct,
  primary,
  disabled,
  id,
  buttonRef,
  ...rest
}: {
  label: string;
  pendingLabel?: string;
  pending: boolean;
  onAct: () => void;
  primary?: boolean;
  disabled?: boolean;
  id?: string;
  buttonRef?: RefObject<HTMLButtonElement>;
} & Omit<JSX.HTMLAttributes<HTMLButtonElement>, "label" | "disabled" | "ref">) {
  return (
    <button
      {...rest}
      type="button"
      id={id}
      ref={buttonRef}
      class={`btn${primary ? " btn-primary" : ""}${pending ? " is-pending" : ""}`}
      aria-busy={pending ? "true" : undefined}
      aria-disabled={pending ? "true" : undefined}
      disabled={disabled}
      onClick={() => {
        if (!pending && !disabled) onAct();
      }}
    >
      {pending && pendingLabel ? pendingLabel : label}
    </button>
  );
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]):not([tabindex="-1"]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]';

export function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
}

/** A modal dialog: focus starts on its first control (or `initial`), Tab wraps inside it, Escape calls `onEscape`. */
export function Dialog({
  role = "dialog",
  label,
  onEscape,
  initial,
  wide,
  children,
  describedBy,
}: {
  role?: "dialog" | "alertdialog";
  label: string;
  onEscape: () => void;
  initial?: RefObject<HTMLElement>;
  wide?: boolean;
  children: ComponentChildren;
  describedBy?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const target = initial?.current ?? (box.current ? focusables(box.current)[0] : undefined);
    target?.focus();
    // Focus moves once, when the dialog opens.
  }, []);
  return (
    <div class="backdrop">
      <div
        ref={box}
        role={role}
        aria-modal="true"
        aria-label={label}
        aria-describedby={describedBy}
        class={`dialog${wide ? " dialog-sheet" : ""}`}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onEscape();
            return;
          }
          if (event.key !== "Tab" || !box.current) return;
          const list = focusables(box.current);
          if (list.length === 0) return;
          const first = list[0]!;
          const last = list[list.length - 1]!;
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}

const MARKS: Record<string, JSX.Element> = {
  "on the wall": <rect x="3" y="3" width="12" height="12" fill="currentColor" />,
  out: <rect x="3" y="3" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="3 2" />,
  missing: (
    <>
      <rect x="3" y="3" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="3 2" />
      <path d="M11 1 L17 7 M17 1 L11 7" stroke="currentColor" stroke-width="1.8" />
    </>
  ),
  "pending photo": <rect x="3" y="3" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="1 2.4" stroke-linecap="round" />,
  reserved: <path d="M3 3 H7 V6 H11 V3 H15 V15 H3 Z" fill="none" stroke="currentColor" stroke-width="2" />,
  held: (
    <>
      <rect x="2" y="2" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" />
      <rect x="5" y="5" width="8" height="8" fill="none" stroke="currentColor" stroke-width="1.5" />
    </>
  ),
  incomplete: (
    <>
      <rect x="3" y="3" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" />
      <rect x="3" y="9" width="12" height="6" fill="currentColor" />
    </>
  ),
  returned: <rect x="3" y="3" width="12" height="12" fill="currentColor" />,
  settled: <rect x="2" y="4" width="14" height="10" fill="currentColor" />,
  raised: <rect x="2.5" y="4.5" width="13" height="9" fill="none" stroke="currentColor" stroke-width="2" />,
  waived: (
    <>
      <rect x="2.5" y="4.5" width="13" height="9" fill="none" stroke="currentColor" stroke-width="2" />
      <path d="M1 16 L17 2" stroke="currentColor" stroke-width="2" />
    </>
  ),
};

/** A status: always its word plus its outline shape, never colour alone. */
export function Status({ word }: { word: string }) {
  return (
    <span class={`status status-${word.replace(/\s+/g, "-")}`}>
      <svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true" focusable="false">
        {MARKS[word]}
      </svg>
      <span class="status-word">{word}</span>
    </span>
  );
}

/** A decorative strip of the perforated pegboard that opens screens other than the boards. */
export function PegStrip() {
  return (
    <div class="peg-strip" aria-hidden="true">
      <svg width="100%" height="32">
        <defs>
          <pattern id="strip-holes" width="32" height="32" patternUnits="userSpaceOnUse" x="0" y="0">
            <circle cx="16" cy="16" r="3.5" class="hole" />
          </pattern>
        </defs>
        <rect width="100%" height="32" class="board-surface" />
        <rect width="100%" height="32" fill="url(#strip-holes)" />
      </svg>
    </div>
  );
}

/** Mono numerals for dates, times, money and counts. */
export const Num = ({ children }: { children: ComponentChildren }) => <span class="num">{children}</span>;

/** Server-written text (fee line descriptions) with its numerals set in mono. */
export function WithNumerals({ text }: { text: string }) {
  return <>{text.split(/(\$?\d[\d,.:-]*)/).map((piece, index) => (index % 2 === 1 ? <Num key={index}>{piece}</Num> : piece))}</>;
}

/** The due line: `Due <date> by <due by>`, followed for an overdue out loan by the server's overdue line. */
export function DueLine({
  loan,
}: {
  loan: { status: string; due_date: string | null; due_by: string | null; open_days_late: number | null; late_fee_so_far_cents: number | null };
}) {
  if (!loan.due_date) return null;
  const overdue = loan.status === "out" && (loan.open_days_late ?? 0) > 0;
  return (
    <span class="due-line">
      Due <Num>{loan.due_date}</Num> by <Num>{loan.due_by}</Num>
      {overdue && (
        <span class="overdue">
          {" "}
          <OverdueLine days={loan.open_days_late!} cents={loan.late_fee_so_far_cents!} />
        </span>
      )}
    </span>
  );
}

function OverdueLine({ days, cents }: { days: number; cents: number }) {
  return (
    <>
      Overdue — <Num>{days}</Num> open {days === 1 ? "day" : "days"} late, <Num>${dollars(cents)}</Num> so far
    </>
  );
}
