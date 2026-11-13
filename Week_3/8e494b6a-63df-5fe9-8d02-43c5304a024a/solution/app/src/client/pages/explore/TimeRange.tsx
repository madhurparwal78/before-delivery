// dialog "Time range": quick, relative and absolute ranges in the viewer's zone, with server time as now.
import { useState, type FormEvent, type KeyboardEvent } from "react";
import { UNIT_MS } from "../../../shared/time";
import { formatDisplay, instantsForWall } from "../../../shared/zone";
import { api } from "../../lib/api";
import { Modal } from "../../lib/dialog";
import { update } from "../../lib/store";
import { Button, useBusy } from "../../lib/ui";

const KINDS = ["Quick", "Relative", "Absolute"] as const;
const QUICK: Array<[string, number]> = [["Last 15 minutes", 900_000], ["Last 1 hour", 3_600_000], ["Last 24 hours", 86_400_000], ["Last 7 days", 604_800_000]];
const UNITS: Array<[string, number]> = [["seconds", UNIT_MS.s as number], ["minutes", UNIT_MS.m as number], ["hours", UNIT_MS.h as number], ["days", UNIT_MS.d as number], ["weeks", UNIT_MS.w as number]];
const WALL = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;

interface Props {
  zone: string;
  from: number;
  to: number;
  onApply: (from: number, to: number) => void;
  onClose: () => void;
}

function wallToInstant(text: string, zone: string): { ms: number } | { error: string } {
  const match = WALL.exec(text.trim());
  const format = { error: "Enter a time as YYYY-MM-DD HH:MM:SS." };
  if (!match) return format;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number) as [number, number, number, number, number, number];
  const check = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day || hour > 23 || minute > 59 || second > 59) return format;
  const [first] = instantsForWall(zone, { year, month, day, hour, minute, second });
  return first === undefined ? { error: `That time doesn't exist in ${zone}.` } : { ms: first };
}

export function TimeRangeDialog({ zone, from, to, onApply, onClose }: Props) {
  const [kind, setKind] = useState<(typeof KINDS)[number]>("Quick");
  const [quick, setQuick] = useState(QUICK[0]?.[0] ?? "");
  const [amount, setAmount] = useState("15");
  const [unit, setUnit] = useState("minutes");
  const [absFrom, setAbsFrom] = useState(formatDisplay(from, zone).slice(0, 19));
  const [absTo, setAbsTo] = useState(formatDisplay(to, zone).slice(0, 19));
  const [errors, setErrors] = useState<Array<{ field: string; message: string }>>([]);
  const [busy, run] = useBusy();

  const onTabKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    const at = KINDS.indexOf(kind);
    const next = event.key === "ArrowRight" ? at + 1 : event.key === "ArrowLeft" ? at - 1 : event.key === "Home" ? 0 : event.key === "End" ? KINDS.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    const target = KINDS[(next + KINDS.length) % KINDS.length] as (typeof KINDS)[number];
    setKind(target);
    event.currentTarget.querySelector<HTMLElement>(`[data-kind="${target}"]`)?.focus();
  };

  const apply = (event: FormEvent): void => {
    event.preventDefault();
    void run(async () => {
      const { now_ms: now } = await api.get<{ now_ms: number }>("/api/time");
      update({ serverNowMs: now });
      if (kind === "Quick") {
        onApply(now - (QUICK.find(([label]) => label === quick)?.[1] ?? 900_000), now);
      } else if (kind === "Relative") {
        const count = Number(amount);
        if (!amount.trim() || !Number.isFinite(count) || count <= 0) {
          setErrors([{ field: "amount", message: "Enter an amount greater than 0." }]);
          return;
        }
        onApply(now - count * (UNITS.find(([name]) => name === unit)?.[1] ?? 60_000), now);
      } else {
        const start = wallToInstant(absFrom, zone);
        const end = wallToInstant(absTo, zone);
        const problems = [
          ...("error" in start && start.error.startsWith("Enter") ? [{ field: "from", message: start.error }] : []),
          ...("error" in end && end.error.startsWith("Enter") ? [{ field: "to", message: end.error }] : []),
        ];
        if (problems.length === 0) {
          if ("error" in start) problems.push({ field: "from", message: start.error });
          if ("error" in end) problems.push({ field: "to", message: end.error });
        }
        if (problems.length === 0 && "ms" in start && "ms" in end && start.ms >= end.ms) problems.push({ field: "from", message: "From must be before To." });
        if (problems.length > 0 || !("ms" in start) || !("ms" in end)) {
          setErrors(problems);
          return;
        }
        onApply(start.ms, end.ms);
      }
      onClose();
    });
  };

  const focusField = (field: string): void => document.getElementById(`range-${field}`)?.focus();

  return (
    <Modal label="Time range" onClose={onClose} sheet>
      <form onSubmit={apply} noValidate>
        {errors.length > 0 ? (
          <div role="alert" aria-label="Error" className="error-box">
            <ul>{errors.map((e) => <li key={e.field}><a href={`#range-${e.field}`} onClick={(event) => { event.preventDefault(); focusField(e.field); }}>{e.message}</a></li>)}</ul>
          </div>
        ) : null}
        <div role="tablist" aria-label="Range kind" className="range-tabs" onKeyDown={onTabKey}>
          {KINDS.map((name) => (
            <button key={name} type="button" role="tab" data-kind={name} aria-selected={kind === name} tabIndex={kind === name ? 0 : -1} className="range-tab" onClick={() => setKind(name)}>{name}</button>
          ))}
        </div>
        {kind === "Quick" ? (
          <div role="radiogroup" aria-label="Quick ranges" className="stack-tight">
            {QUICK.map(([label]) => <label key={label} className="check"><input type="radio" name="quick" checked={quick === label} onChange={() => setQuick(label)} />{label}</label>)}
          </div>
        ) : null}
        {kind === "Relative" ? (
          <div className="grid-fields">
            <div className="field"><label htmlFor="range-amount">Amount</label><input id="range-amount" type="text" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} /></div>
            <div className="field">
              <label htmlFor="range-unit">Unit</label>
              <select id="range-unit" value={unit} onChange={(event) => setUnit(event.target.value)}>{UNITS.map(([name]) => <option key={name} value={name}>{name}</option>)}</select>
            </div>
          </div>
        ) : null}
        {kind === "Absolute" ? (
          <div className="grid-fields">
            <div className="field"><label htmlFor="range-from">From</label><input id="range-from" type="text" className="mono" placeholder="YYYY-MM-DD HH:MM:SS" value={absFrom} onChange={(event) => setAbsFrom(event.target.value)} /></div>
            <div className="field"><label htmlFor="range-to">To</label><input id="range-to" type="text" className="mono" placeholder="YYYY-MM-DD HH:MM:SS" value={absTo} onChange={(event) => setAbsTo(event.target.value)} /></div>
            <p className="hint">Times are in {zone}. The range includes its start and excludes its end.</p>
          </div>
        ) : null}
        <div className="dialog-actions">
          <button type="submit" className="btn btn-primary" aria-busy={busy || undefined}>Apply</button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Modal>
  );
}
