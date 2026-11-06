// Small shared pieces: spike-tape department strips, status chips, form errors and icons.

import { useLayoutEffect, useRef, type ReactNode } from "react";
import { STATUS_NAMES, departmentByKey, type StatusKey } from "../../../shared/catalog";
import { copy } from "../copy";
import { DURATION, FADE_IN, play } from "../motion";

export const Tape = ({ dept }: { dept: string | null }) => {
  const department = departmentByKey(dept);
  if (!department) return null;
  return <span className={`tape tape-${department.key}`}>{department.name}</span>;
};

// The status chip swaps with a short fade whenever its status changes.
export const StatusChip = ({ status }: { status: StatusKey }) => {
  const ref = useRef<HTMLSpanElement>(null);
  const seen = useRef(status);
  useLayoutEffect(() => {
    if (seen.current === status) return;
    seen.current = status;
    play(ref.current, FADE_IN, { duration: DURATION.chip, easing: "ease-out" });
  }, [status]);
  return (
    <span ref={ref} className={`chip chip-${status}`}>
      {STATUS_NAMES[status]}
    </span>
  );
};

// The Blocked chip and the Freed badge share one slot and crossfade into each other.
export const BlockSlot = ({ blocked, freedBy }: { blocked: boolean; freedBy: string | null }) => {
  const ref = useRef<HTMLSpanElement>(null);
  const state = blocked ? "blocked" : freedBy ? "freed" : "none";
  const seen = useRef(state);
  useLayoutEffect(() => {
    if (seen.current === state) return;
    seen.current = state;
    if (state !== "none") play(ref.current, FADE_IN, { duration: DURATION.crossfade, easing: "ease-out" });
  }, [state]);
  if (state === "blocked") {
    return (
      <span ref={ref} className="chip chip-blocked">
        Blocked
      </span>
    );
  }
  if (state === "freed") {
    return (
      <span ref={ref} className="badge-freed">
        {copy.freedBy(freedBy as string)}
      </span>
    );
  }
  return null;
};

export const FieldError = ({ id, message }: { id: string; message?: string }) =>
  message ? (
    <p className="field-error" id={id}>
      {message}
    </p>
  ) : null;

// The error summary: a heading, then one link per field that moves focus to it.
export const ErrorSummary = ({ errors, fieldIds }: { errors: Record<string, string>; fieldIds: Record<string, string> }) => {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    ref.current?.focus();
  }, [errors]);
  return (
    <div className="error-summary" role="alert" tabIndex={-1} ref={ref}>
      <h3>{copy.problem}</h3>
      <ul>
        {Object.entries(errors).map(([field, message]) => (
          <li key={field}>
            <a
              href={`#${fieldIds[field] ?? ""}`}
              onClick={(e) => {
                e.preventDefault();
                document.getElementById(fieldIds[field] ?? "")?.focus();
              }}
            >
              {message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
};

const Svg = ({ children }: { children: ReactNode }) => (
  <svg className="icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
    {children}
  </svg>
);

export const Icon = {
  list: () => (
    <Svg>
      <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
    </Svg>
  ),
  board: () => (
    <Svg>
      <rect x="3" y="3" width="5" height="18" rx="1" />
      <rect x="10" y="3" width="5" height="12" rx="1" />
      <rect x="17" y="3" width="4" height="8" rx="1" />
    </Svg>
  ),
  plus: () => (
    <Svg>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  ),
  undo: () => (
    <Svg>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </Svg>
  ),
  command: () => (
    <Svg>
      <path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3" />
    </Svg>
  ),
  close: () => (
    <Svg>
      <path d="M18 6 6 18M6 6l12 12" />
    </Svg>
  ),
  menu: () => (
    <Svg>
      <path d="M4 6h16M4 12h16M4 18h16" />
    </Svg>
  ),
};

// A page from the prompt book: the drawn mark beside empty states.
export const PromptBookMark = () => (
  <svg className="empty-mark" viewBox="0 0 72 72" width="72" height="72" aria-hidden="true" focusable="false">
    <rect x="12" y="8" width="48" height="58" rx="2" className="empty-mark-page" />
    <line x1="22" y1="8" x2="22" y2="66" className="empty-mark-margin" />
    <line x1="27" y1="22" x2="52" y2="22" className="empty-mark-rule" />
    <line x1="27" y1="31" x2="48" y2="31" className="empty-mark-rule" />
    <line x1="27" y1="40" x2="52" y2="40" className="empty-mark-rule" />
    <path d="M14 46h7" className="empty-mark-cue" />
  </svg>
);
