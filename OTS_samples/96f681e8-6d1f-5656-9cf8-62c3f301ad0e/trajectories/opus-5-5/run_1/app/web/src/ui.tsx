import { ComponentChildren } from "preact";

export function Alert({ text }: { text: string }) {
  if (!text) return null;
  return (
    <p role="alert" class="band">
      {text}
    </p>
  );
}

export function FieldError({ text, id }: { text: string; id?: string }) {
  return (
    <p class="band field-band" id={id}>
      {text}
    </p>
  );
}

type PendingProps = {
  label: string;
  pendingLabel: string;
  pending: boolean;
  onClick: () => void;
  class?: string;
  focusKey?: string;
  ariaLabel?: string;
  pendingAriaLabel?: string;
};

/** An async action pill: while pending it reads its pending label and stays focusable. */
export function PendingButton(p: PendingProps) {
  return (
    <button
      type="button"
      class={p.class ?? "pill pill-cobalt"}
      data-focus={p.focusKey}
      aria-disabled={p.pending ? "true" : undefined}
      aria-label={p.pending ? p.pendingAriaLabel : p.ariaLabel}
      onClick={() => {
        if (!p.pending) p.onClick();
      }}
    >
      {p.pending ? p.pendingLabel : p.label}
    </button>
  );
}

export function Empty({ children }: { children: ComponentChildren }) {
  return (
    <div class="empty">
      <svg viewBox="0 0 24 24" aria-hidden="true" class="empty-icon">
        <rect x="3" y="5" width="18" height="14" rx="3" fill="none" stroke="currentColor" stroke-width="1.6" />
        <circle cx="9" cy="10" r="1.8" fill="currentColor" />
        <path d="M4 17l5-5 4 4 3-3 4 4" fill="none" stroke="currentColor" stroke-width="1.6" />
      </svg>
      <p>{children}</p>
    </div>
  );
}
