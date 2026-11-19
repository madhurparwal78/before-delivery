import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";
import { useFocusTrap } from "../lib/hooks";
import { statusWord } from "../lib/format";

export function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string | null;
  hint?: string;
  children: (attributes: { id: string; "aria-describedby": string | undefined }) => ReactNode;
}): JSX.Element {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ");
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children({ id, "aria-describedby": describedBy || undefined })}
      {hint ? (
        <span className="field-hint" id={hintId}>
          {hint}
        </span>
      ) : null}
      {error ? (
        <span className="field-error" id={errorId}>
          {error}
        </span>
      ) : null}
    </div>
  );
}

export function Switch({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      className="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="track" aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}

export function StatusCell({ status }: { status: string }): JSX.Element {
  return (
    <>
      <span className={`status-dot ${status}`} aria-hidden="true" />
      {statusWord(status)}
    </>
  );
}

export function LiveStatus({ name, message }: { name: string; message: string }): JSX.Element {
  return (
    <p className="live-status" role="status" aria-live="polite" aria-label={name}>
      {message}
    </p>
  );
}

export function Alert({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="alert" role="alert">
      {children}
    </div>
  );
}

export function Dialog({
  name,
  kind = "dialog",
  onClose,
  initialFocus,
  children,
}: {
  name: string;
  kind?: "dialog" | "alertdialog";
  onClose: () => void;
  initialFocus?: React.RefObject<HTMLElement>;
  children: ReactNode;
}): JSX.Element {
  const panel = useRef<HTMLDivElement>(null);
  useFocusTrap(true, panel);
  useEffect(() => {
    const target = initialFocus?.current ?? panel.current?.querySelector<HTMLElement>("button, input");
    target?.focus();
  }, [initialFocus]);
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, [onClose]);
  return (
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="dialog" role={kind} aria-modal="true" aria-label={name} ref={panel}>
        {children}
      </div>
    </div>
  );
}

export interface TabDefinition {
  id: string;
  label: string;
}

export function Tabs({
  name,
  tabs,
  selected,
  onSelect,
  disabled,
}: {
  name: string;
  tabs: TabDefinition[];
  selected: string;
  onSelect: (id: string) => void;
  disabled?: (id: string) => boolean;
}): JSX.Element {
  const move = (index: number, step: number) => {
    const next = (index + step + tabs.length) % tabs.length;
    onSelect(tabs[next].id);
    const node = document.getElementById(`tab-${tabs[next].id}`);
    node?.focus();
  };
  return (
    <div className="tablist" role="tablist" aria-label={name}>
      {tabs.map((tab, index) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          id={`tab-${tab.id}`}
          aria-selected={tab.id === selected}
          aria-controls={`panel-${tab.id}`}
          tabIndex={tab.id === selected ? 0 : -1}
          disabled={disabled?.(tab.id) ?? false}
          onClick={() => onSelect(tab.id)}
          onKeyDown={(event) => {
            if (event.key === "ArrowRight") {
              event.preventDefault();
              move(index, 1);
            } else if (event.key === "ArrowLeft") {
              event.preventDefault();
              move(index, -1);
            } else if (event.key === "Home") {
              event.preventDefault();
              move(0, 0);
            } else if (event.key === "End") {
              event.preventDefault();
              move(tabs.length - 1, 0);
            }
          }}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export function TabPanel({
  id,
  hidden,
  children,
}: {
  id: string;
  hidden: boolean;
  children: ReactNode;
}): JSX.Element | null {
  if (hidden) return null;
  return (
    <div role="tabpanel" id={`panel-${id}`} aria-labelledby={`tab-${id}`} tabIndex={-1}>
      {children}
    </div>
  );
}