// Feedback components.
//   <ErrorSummary errors={[{field, message}]} focusSignal?>   `alert` with heading `Fix these problems:` and one link per
//       message to its field (`fieldId(field)`). It takes focus when it appears and again whenever `focusSignal` changes
//       (pass the submit attempt counter). Renders nothing when `errors` is empty.
//   <Notice tone? interrupt? class?>   the status strip pattern across the panel: icon, message. Tones error (default), info,
//       success, warning. role=alert only with `interrupt`; otherwise announce() the sentence and render it quietly.
//   <Skeleton rows? height?>           static surface-step blocks for the first fetch (no animation), with "Loading" for
//       assistive technology.
import type { ComponentChildren } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import { fieldId } from "./fields.tsx";
import { Icon, type IconName } from "./icons.tsx";

export interface SummaryError {
  field: string;
  message: string;
}

export function ErrorSummary({ errors, focusSignal }: { errors: readonly SummaryError[]; focusSignal?: unknown }) {
  const box = useRef<HTMLDivElement>(null);
  const present = errors.length > 0;
  useLayoutEffect(() => {
    if (present) box.current?.focus();
  }, [present, focusSignal]);
  if (!present) return null;
  return (
    <div ref={box} role="alert" tabIndex={-1} class="sp-error-summary">
      <h2 class="sp-error-summary__title">Fix these problems:</h2>
      <ul class="sp-error-summary__list">
        {errors.map((error) => (
          <li key={error.field}>
            <a
              href={`#${fieldId(error.field)}`}
              onClick={(event) => {
                event.preventDefault();
                document.getElementById(fieldId(error.field))?.focus();
              }}
            >
              {error.message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

type NoticeTone = "error" | "info" | "success" | "warning";

const noticeIcon: Record<NoticeTone, IconName> = { error: "alert", info: "info", success: "circle-check", warning: "clock" };

export function Notice({ tone = "error", interrupt = false, class: className, children }: { tone?: NoticeTone; interrupt?: boolean; class?: string; children: ComponentChildren }) {
  return (
    <div role={interrupt ? "alert" : undefined} class={`sp-notice sp-notice--${tone}${className ? ` ${className}` : ""}`}>
      <Icon name={noticeIcon[tone]} size={20} class="sp-notice__icon" />
      <div class="sp-notice__body">{children}</div>
    </div>
  );
}

export function Skeleton({ rows = 3, height = 48 }: { rows?: number; height?: number }) {
  return (
    <div class="sp-skeleton" aria-busy="true">
      <span class="sp-visually-hidden">Loading</span>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} class="sp-skeleton__row" style={{ height: `${height}px` }} aria-hidden="true" />
      ))}
    </div>
  );
}
