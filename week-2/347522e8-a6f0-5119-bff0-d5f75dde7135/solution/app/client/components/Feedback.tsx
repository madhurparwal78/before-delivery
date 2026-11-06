// Live regions and messages. Errors are ink with a bold rule and an icon, never a new colour.

import { Check, OctagonAlert } from "lucide-react";
import type { ReactNode } from "react";

type Tone = "info" | "success" | "error";

export interface Message {
  text: string;
  tone: Tone;
}

export const info = (text: string): Message => ({ text, tone: "info" });
export const success = (text: string): Message => ({ text, tone: "success" });
export const failure = (text: string): Message => ({ text, tone: "error" });

/** A named `status` region that is always in the page, so its announcements are read. */
export function StatusRegion({ name, message, className = "" }: { name: string; message: Message | null; className?: string }) {
  return (
    <p role="status" aria-label={name} className={`status status--${message?.tone ?? "info"} ${className}`}>
      {message?.tone === "error" ? <OctagonAlert aria-hidden="true" className="status__icon" /> : null}
      {message?.tone === "success" ? <Check aria-hidden="true" className="status__icon" /> : null}
      {message?.text}
    </p>
  );
}

export function ErrorNote({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p id={id} className="note note--error">
      <OctagonAlert aria-hidden="true" className="note__icon" />
      <span>{children}</span>
    </p>
  );
}

/** The empty-state drawing: an order spike with nothing on it (ink and steel only). */
export function EmptySpike({ text }: { text: string }) {
  return (
    <div className="empty">
      <svg className="empty__art" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
        <rect x="14" y="54" width="36" height="5" rx="1" fill="var(--steel)" />
        <path d="M32 54 V8" stroke="var(--ink)" strokeWidth="2.5" strokeLinecap="round" />
        <path d="M32 8 l-2 5 h4 z" fill="var(--ink)" />
        <path d="M22 30 h20 M24 38 h16" stroke="var(--steel)" strokeWidth="1.5" strokeDasharray="2 3" />
      </svg>
      <p className="empty__text">{text}</p>
    </div>
  );
}
