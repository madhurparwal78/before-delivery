// Formula bar, sync strip and the Season menu.
import { type KeyboardEvent, type RefObject, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { NUMBER_FORMATS, type NumberFormat } from "../../shared/values.js";
import { count } from "../copy.js";
import { Icon } from "../ui/Icon.js";
import { type Furrow } from "./furrow.js";
import { type SyncPhase } from "./session.js";

const FORMAT_LABEL: Record<NumberFormat, string> = { general: "General", "0": "0", "0.0": "0.0", "0.00": "0.00", "0.000": "0.000", "0.0%": "0.0%", date: "Date" };

export function FormulaBar({
  refText,
  input,
  format,
  bold,
  canEdit,
  inputRef,
  onFormat,
  onBold,
  onCommit,
  onEscape,
  onReadOnlyType,
}: {
  refText: string;
  input: string;
  format: NumberFormat;
  bold: boolean;
  canEdit: boolean;
  inputRef: RefObject<HTMLInputElement>;
  onFormat(f: NumberFormat): void;
  onBold(): void;
  onCommit(value: string): void;
  onEscape(): void;
  onReadOnlyType(): void;
}): JSX.Element {
  const [draft, setDraft] = useState(input);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    setDraft(input);
    setDirty(false);
  }, [input, refText]);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (!canEdit) onReadOnlyType();
      else if (dirty) onCommit(draft);
      setDirty(false);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setDraft(input);
      setDirty(false);
      onEscape();
    }
  };

  return (
    <div className="formula-bar">
      <div className="format-tools">
        <label className="sr-only" htmlFor="number-format">
          Number format
        </label>
        <select id="number-format" value={format} disabled={!canEdit} onChange={(e) => onFormat(e.target.value as NumberFormat)}>
          {NUMBER_FORMATS.map((f) => (
            <option key={f} value={f}>
              {FORMAT_LABEL[f]}
            </option>
          ))}
        </select>
        <button type="button" className="btn btn-icon btn-toggle" aria-pressed={bold} aria-label="Bold" disabled={!canEdit} onClick={onBold}>
          <Icon name="bold" />
        </button>
      </div>
      <div className="formula-input">
        <output className="cell-ref mono" aria-label="Active cell">
          {refText}
        </output>
        <input
          ref={inputRef}
          aria-label="Formula"
          className="mono"
          value={draft}
          readOnly={!canEdit}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => {
            setDraft(e.target.value);
            setDirty(true);
          }}
          onKeyDown={onKeyDown}
        />
      </div>
    </div>
  );
}

function syncText(online: boolean, phase: SyncPhase, pending: number, inFlight: number): string {
  if (!online) return pending ? `Offline · ${count(pending, "edit")} waiting` : "Offline · edits will sync when you're back in range";
  if (phase === "syncing") return `Syncing ${count(inFlight || pending, "edit")}…`;
  if (phase === "failed") return "Sync failed · retrying";
  if (pending) return `Syncing ${count(pending, "edit")}…`;
  return "All edits synced";
}

export function SyncStrip({
  online,
  phase,
  pending,
  inFlight,
  conflicts,
  furrow,
  onConflicts,
}: {
  online: boolean;
  phase: SyncPhase;
  pending: number;
  inFlight: number;
  conflicts: number;
  furrow: Furrow;
  onConflicts(): void;
}): JSX.Element {
  const text = syncText(online, phase, pending, inFlight);
  const tone = !online ? "offline" : phase === "failed" ? "failed" : text === "All edits synced" ? "synced" : "syncing";
  return (
    <div className={`sync-strip tone-${tone}`}>
      {phase === "syncing" && online && <span className="sync-bar" aria-hidden="true" />}
      <p className="sync-state">
        <Icon name={tone === "offline" ? "offline" : tone === "failed" ? "alert" : tone === "synced" ? "check" : "sync"} size={16} />
        <span role="status" aria-label="Sync status">
          {text}
        </span>
      </p>
      <RecalcLine furrow={furrow} />
      <button type="button" className={`btn btn-secondary conflicts-btn${conflicts ? " has" : ""}`} onClick={onConflicts}>
        {`Conflicts (${conflicts})`}
      </button>
    </div>
  );
}

/** The polite Recalc announcement, made in both motion modes. */
function RecalcLine({ furrow }: { furrow: Furrow }): JSX.Element {
  useSyncExternalStore(furrow.subscribe, furrow.getVersion);
  return (
    <p className="recalc-line" role="status" aria-label="Recalc">
      {furrow.announcement}
    </p>
  );
}

export interface MenuItem {
  label: string;
  enabled: boolean;
  run(): void;
}

export function SeasonMenu({ items, busy }: { items: MenuItem[]; busy: boolean }): JSX.Element {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  const itemEls = (): HTMLElement[] => [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
  const focusEnabled = (from: number, step: 1 | -1): void => {
    const els = itemEls();
    for (let i = 1; i <= els.length; i++) {
      const el = els[(from + step * i + els.length * 4) % els.length];
      if (el.getAttribute("aria-disabled") !== "true") {
        el.focus();
        return;
      }
    }
    els[0]?.focus();
  };

  useLayoutEffect(() => {
    if (open) focusEnabled(-1, 1);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent): void => {
      if (!menu.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  const close = (): void => {
    setOpen(false);
    button.current?.focus();
  };

  const onButtonKey = (e: KeyboardEvent<HTMLButtonElement>): void => {
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setOpen(true);
    }
  };

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    const els = itemEls();
    const at = els.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") focusEnabled(at, 1);
    else if (e.key === "ArrowUp") focusEnabled(at < 0 ? 0 : at, -1);
    else if (e.key === "Home") focusEnabled(-1, 1);
    else if (e.key === "End") focusEnabled(els.length, -1);
    else if (e.key === "Escape" || e.key === "Tab") {
      if (e.key === "Escape") e.preventDefault();
      close();
      return;
    } else return;
    e.preventDefault();
  };

  return (
    <div className="menu-wrap">
      <button
        ref={button}
        type="button"
        className="btn btn-secondary"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="season-menu"
        disabled={busy}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onButtonKey}
      >
        <Icon name="season" />
        {busy ? "Saving…" : "Season"}
      </button>
      {open && (
        <div ref={menu} id="season-menu" role="menu" aria-label="Season" className="menu" onKeyDown={onMenuKey}>
          {items.map((item) => (
            <div
              key={item.label}
              role="menuitem"
              tabIndex={-1}
              aria-disabled={!item.enabled}
              className="menu-item"
              onClick={() => {
                if (!item.enabled) return;
                setOpen(false);
                item.run();
              }}
              onKeyDown={(e) => {
                if ((e.key === "Enter" || e.key === " ") && item.enabled) {
                  e.preventDefault();
                  setOpen(false);
                  item.run();
                }
              }}
            >
              {item.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
