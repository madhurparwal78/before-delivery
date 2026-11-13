// Shared controls: buttons that show their pending state, fields that carry their own error, and focus trapping.
import type { ComponentChildren, JSX } from "preact";
import { useRef, useState } from "preact/hooks";
import { clearNotice } from "./notices.js";

export function useAction(): [boolean, (work: () => Promise<void>) => Promise<void>] {
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const run = async (work: () => Promise<void>): Promise<void> => {
    if (busy.current) return;
    busy.current = true;
    clearNotice();
    setPending(true);
    try {
      await work();
    } finally {
      busy.current = false;
      setPending(false);
    }
  };
  return [pending, run];
}

interface ActionButtonProps {
  label: string;
  pendingLabel?: string;
  run: () => Promise<void>;
  kind?: "primary" | "secondary" | "quiet";
  class?: string;
  icon?: ComponentChildren;
  type?: "button" | "submit";
  ariaLabel?: string;
}

// A button for one async action: disabled and aria-busy while it runs, showing the pending copy when there is one.
export function ActionButton({ label, pendingLabel, run, kind = "secondary", class: className = "", icon, type = "button", ariaLabel }: ActionButtonProps) {
  const [pending, start] = useAction();
  return (
    <button
      type={type}
      class={`button ${kind} ${className}`}
      disabled={pending}
      aria-busy={pending ? "true" : undefined}
      aria-label={ariaLabel}
      onClick={type === "button" ? () => void start(run) : undefined}
    >
      {icon}
      <span>{pending && pendingLabel !== undefined ? pendingLabel : label}</span>
    </button>
  );
}

interface FieldProps {
  id: string;
  label: string;
  type?: string;
  value: string;
  error?: string | undefined;
  autocomplete?: string;
  onInput: (value: string) => void;
}

export function Field({ id, label, type = "text", value, error, autocomplete, onInput }: FieldProps) {
  const errorId = `${id}-error`;
  return (
    <div class={`field ${error === undefined ? "" : "invalid"}`}>
      <label for={id}>{label}</label>
      <input
        id={id}
        name={id}
        type={type}
        value={value}
        autocomplete={autocomplete}
        aria-invalid={error === undefined ? undefined : "true"}
        aria-describedby={error === undefined ? undefined : errorId}
        onInput={(event: JSX.TargetedEvent<HTMLInputElement>) => onInput(event.currentTarget.value)}
      />
      {error === undefined ? null : <p class="field-error" id={errorId}>{error}</p>}
    </div>
  );
}

const FOCUSABLE = "a[href], button:not([disabled]), input:not([disabled]), textarea, select, [tabindex]:not([tabindex='-1'])";

export function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) => element.offsetParent !== null || element === document.activeElement);
}

// Keeps Tab inside an open dialog and closes it on Escape.
export function trapKeys(event: KeyboardEvent, root: HTMLElement, close: () => void): void {
  if (event.key === "Escape") {
    event.preventDefault();
    close();
    return;
  }
  if (event.key !== "Tab") return;
  const items = focusables(root);
  const first = items[0];
  const last = items[items.length - 1];
  if (first === undefined || last === undefined) return;
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !root.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || !root.contains(active))) {
    event.preventDefault();
    first.focus();
  }
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function SubmitButton({ label, pendingLabel, pending }: { label: string; pendingLabel: string; pending: boolean }) {
  return (
    <button type="submit" class="button primary" disabled={pending} aria-busy={pending ? "true" : undefined}>
      {pending ? pendingLabel : label}
    </button>
  );
}
