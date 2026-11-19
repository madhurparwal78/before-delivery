// Small shared pieces: status words (never colour alone), the Overdue badge, named live regions,
// and the drawn illustrations for empty states.
import { CalendarClock, Check, TriangleAlert } from "lucide-react";
import type { Tower } from "../api";

export function StatusWord({ status }: { status: "violation" | "clear" }) {
  return status === "violation" ? (
    <span className="status-word violation">
      <TriangleAlert size={15} strokeWidth={2.2} aria-hidden="true" />
      Violation
    </span>
  ) : (
    <span className="status-word clear">
      <Check size={15} strokeWidth={2.4} aria-hidden="true" />
      Clear
    </span>
  );
}

export function OverdueBadge() {
  return (
    <span className="badge overdue">
      <CalendarClock size={13} aria-hidden="true" />
      Overdue
    </span>
  );
}

/** A named polite live region whose text is also visible. */
export function Notice({ name, text, className = "notice" }: { name: string; text: string; className?: string }) {
  return (
    <p role="status" aria-live="polite" aria-label={name} className={className}>
      {text}
    </p>
  );
}

/** A survey stake on a blank ruled sheet: the empty findings rail. */
export function StakeDrawing() {
  return (
    <svg viewBox="0 0 120 90" aria-hidden="true" fill="none" stroke="var(--rule)" strokeWidth="1">
      {[18, 30, 42, 54, 66].map((y) => (
        <line key={y} x1="8" x2="112" y1={y} y2={y} />
      ))}
      <path d="M60 14 L60 76" stroke="var(--ink)" strokeWidth="2" />
      <path d="M60 14 L78 20 L60 26 Z" fill="var(--paper-sunk)" stroke="var(--ink)" />
      <path d="M52 76 L68 76" stroke="var(--ink)" strokeWidth="1.5" />
    </svg>
  );
}

/** The corridor drawn as a plan: centreline, tower ticks and labels, finding marks. */
export function CorridorPlan({ towers, findings }: { towers: Tower[]; findings: Array<{ chainage_m: number; status: string }> }) {
  const length = towers[towers.length - 1]?.chainage_m ?? 1;
  const x = (c: number) => 20 + (c / length) * 480;
  return (
    <svg className="plan" viewBox="0 0 520 120" aria-hidden="true" fill="none">
      <rect x="20" y="44" width="480" height="32" fill="var(--paper-sunk)" stroke="var(--rule)" />
      {Array.from({ length: Math.floor(length / 100) + 1 }, (_, i) => (
        <line key={i} x1={x(i * 100)} x2={x(i * 100)} y1="56" y2="64" stroke="var(--rule)" />
      ))}
      <line x1="20" x2="500" y1="60" y2="60" stroke="var(--ink)" strokeWidth="1.5" strokeDasharray="6 4" />
      {towers.map((t) => (
        <g key={t.number}>
          <line x1={x(t.chainage_m)} x2={x(t.chainage_m)} y1="36" y2="84" stroke="var(--ink)" strokeWidth="2" />
          <text x={x(t.chainage_m)} y="28" textAnchor="middle" fontFamily="var(--font-mono)" fontSize="11" fill="var(--muted)">
            {t.label}
          </text>
        </g>
      ))}
      {findings.map((f, i) => (
        <circle key={i} cx={x(f.chainage_m)} cy="60" r="5" fill={f.status === "violation" ? "var(--violation)" : "var(--forest)"} stroke="var(--paper)" />
      ))}
    </svg>
  );
}
