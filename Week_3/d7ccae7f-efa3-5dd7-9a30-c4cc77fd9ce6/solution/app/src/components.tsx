import { Check, CircleAlert, LoaderCircle, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

type Tone = "idle" | "pending" | "success" | "error" | "late";
export type StatusMessage = { tone: Tone; text: string };

const icons: Record<Exclude<Tone, "idle">, LucideIcon> = { pending: LoaderCircle, success: Check, error: CircleAlert, late: CircleAlert };

// A named live region: pending, success and error copy is announced here and shown in words.
export function Status({ name, message, tone }: { name: string; message: string; tone?: Tone }) {
  const Icon = tone && tone !== "idle" && message ? icons[tone] : null;
  return (
    <div role="status" aria-label={name} className="status" data-tone={tone ?? "idle"}>
      {Icon ? <Icon size={20} strokeWidth={1.75} aria-hidden="true" /> : null}
      {message}
    </div>
  );
}

export function Field({ id, label, error, children }: { id: string; label: string; error?: string | undefined; children: ReactNode }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="field-error">
          <CircleAlert size={18} strokeWidth={1.75} aria-hidden="true" />
          {error}
        </p>
      ) : null}
    </div>
  );
}

export const describedBy = (id: string, error?: string): { "aria-describedby"?: string; "aria-invalid"?: boolean } =>
  error ? { "aria-describedby": `${id}-error`, "aria-invalid": true } : {};

export function Wordmark({ size = "var(--step-2)" }: { size?: string }) {
  return (
    <span className="wordmark display" style={{ fontSize: size }}>
      Lastbell
    </span>
  );
}

export function TallyMark({ strokes }: { strokes: number }) {
  return (
    <svg className="tally" width={14 + strokes * 12} height={38} viewBox={`0 0 ${14 + strokes * 12} 38`} aria-hidden="true">
      {Array.from({ length: strokes }, (_, i) => (
        <line key={i} x1={9 + i * 12} y1={5} x2={10 + i * 12} y2={33} stroke="currentColor" strokeWidth={3.5} strokeLinecap="round" />
      ))}
    </svg>
  );
}

