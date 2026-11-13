// Small shared pieces: the live-region announcer, inline notices and Lucide line icons.

import type { ComponentChildren, JSX } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import type { Me } from "../shared/api.js";

/** Writes into the page's one polite live region, "Kitchen updates". */
export function announce(text: string): void {
  const region = document.getElementById("kitchen-updates");
  if (region) region.textContent = text;
}

type Landing = "heading" | "email" | null;
let landing: Landing = null;
let landingNotice: string | null = null;

/** Where focus goes once the next screen has drawn, and the message that screen shows on arrival. */
export function landOn(target: Exclude<Landing, null>, notice: string | null = null): void {
  landing = target;
  landingNotice = notice;
}

/** Takes the arrival message, if any, and announces it once. */
export function useArrivalNotice(): [NoticeState | null, (n: NoticeState | null) => void] {
  return useState<NoticeState | null>(() => {
    const text = landingNotice;
    landingNotice = null;
    return text ? tell(text) : null;
  });
}

function useLandingFocus<T extends HTMLElement>(target: Exclude<Landing, null>): (el: T | null) => void {
  const seen = useRef<T | null>(null);
  useLayoutEffect(() => {
    if (landing === target && seen.current) {
      landing = null;
      seen.current.focus();
    }
  });
  return (el) => {
    seen.current = el;
  };
}

/** A screen's level-one heading: focusable from script, and the focus target after a landing. */
export function ScreenHeading({ children }: { children: ComponentChildren }): JSX.Element {
  return <h1 tabIndex={-1} ref={useLandingFocus<HTMLHeadingElement>("heading")}>{children}</h1>;
}

/** The ref of the Email field, which takes focus after signing out or a 401. */
export function useEmailLanding(): (el: HTMLInputElement | null) => void {
  return useLandingFocus<HTMLInputElement>("email");
}

export function focusHeading(): void {
  document.querySelector<HTMLElement>("h1")?.focus();
}

export type UserChange = (user: Me | null, path: string) => void;

export type Tone = "info" | "conflict" | "outage";

export interface NoticeState {
  text: string;
  tone: Tone;
}

/** Announces and returns the notice to show next to the control that caused it. */
export function tell(text: string, tone: Tone = "info"): NoticeState {
  announce(text);
  return { text, tone };
}

/** The notice to show next to a control without announcing it (pending copy the brief says is never announced). */
export function show(text: string, tone: Tone = "info"): NoticeState {
  return { text, tone };
}

export function Notice({ notice, id }: { notice: NoticeState | null; id?: string }): JSX.Element {
  return (
    <p id={id} class={`notice notice--${notice?.tone ?? "info"}`} data-empty={notice ? undefined : "true"}>
      {notice?.tone === "outage" ? <Icon name="circle-alert" /> : null}
      {notice?.text ?? ""}
    </p>
  );
}

// Lucide icon paths (ISC licence), drawn at hairline weight.
const ICONS: Readonly<Record<string, readonly string[]>> = {
  "layout-grid": ["M3 3h7v7H3z", "M14 3h7v7h-7z", "M14 14h7v7h-7z", "M3 14h7v7H3z"],
  "clock-3": ["M12 6v6h4", "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20"],
  "file-check-2": ["M4 22h14a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v4", "M14 2v4a2 2 0 0 0 2 2h4", "m3 15 2 2 4-4"],
  users: ["M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", "M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8", "M22 21v-2a4 4 0 0 0-3-3.87", "M16 3.13a4 4 0 0 1 0 7.75"],
  "chart-column": ["M3 3v16a2 2 0 0 0 2 2h16", "M18 17V9", "M13 17V5", "M8 17v-3"],
  "log-out": ["m16 17 5-5-5-5", "M21 12H9", "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"],
  "chevron-left": ["m15 18-6-6 6-6"],
  "chevron-right": ["m9 18 6-6-6-6"],
  "calendar-check": ["M8 2v4", "M16 2v4", "M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z", "M3 10h18", "m9 16 2 2 4-4"],
  "grip-vertical": ["M9 5h.01", "M9 12h.01", "M9 19h.01", "M15 5h.01", "M15 12h.01", "M15 19h.01"],
  snowflake: ["M2 12h20", "M12 2v20", "m20 16-4-4 4-4", "m4 8 4 4-4 4", "m16 4-4 4-4-4", "m8 20 4-4 4 4"],
  upload: ["M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4", "m17 8-5-5-5 5", "M12 3v12"],
  "circle-alert": ["M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20", "M12 8v4", "M12 16h.01"],
  receipt: ["M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z", "M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8", "M12 17.5v-11"],
  x: ["M18 6 6 18", "m6 6 12 12"],
};

export function Icon({ name, size = 16 }: { name: string; size?: number }): JSX.Element {
  return (
    <svg class="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
      {(ICONS[name] ?? []).map((d) => <path key={d} d={d} />)}
    </svg>
  );
}

export function TicketStub({ children }: { children: ComponentChildren }): JSX.Element {
  return (
    <div class="empty">
      <svg class="empty__art" viewBox="0 0 96 72" aria-hidden="true" focusable="false">
        <path d="M14 6h68v52l-5.7 6-5.6-6-5.7 6-5.7-6-5.6 6-5.7-6-5.7 6-5.6-6-5.7 6-5.7-6L14 58z" fill="var(--surface)" stroke="var(--steel-strong)" />
        <circle cx="48" cy="6" r="5" fill="var(--ground)" stroke="var(--steel-strong)" />
        <path d="M24 22h30M24 30h48M24 38h40M24 46h22" stroke="var(--steel)" stroke-linecap="round" />
      </svg>
      <p>{children}</p>
    </div>
  );
}
