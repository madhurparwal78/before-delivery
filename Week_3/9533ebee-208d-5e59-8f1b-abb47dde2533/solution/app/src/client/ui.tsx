import { useCallback, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode, type Ref } from "react";
import { failureOf, type Failure } from "./api.ts";
import { useFeedback, useNav, useSession, type Announcement, type FieldLink } from "./state.tsx";
import { displayAmount, displayPrice } from "../shared/format.ts";
import { liveError, parseAmount } from "./desk.ts";

// Shared pieces of the ledger sheet: figures, fields, buttons and the action runner.

/**
 * A figure in tabular mono, split at the decimal point. In a column mixing assets, `pad` reserves room for that
 * many decimals after the point, so every point in the right-aligned column lines up.
 */
export function Fig({ minor, decimals, asset, pad, className }: { minor: string; decimals: number; asset?: string; pad?: number; className?: string }) {
  const text = displayAmount(minor, decimals);
  const point = decimals === 0 ? text.length : text.indexOf(",");
  return (
    <span className={`fig${pad ? " fig-pad" : ""}${className ? ` ${className}` : ""}`} style={pad ? ({ "--frac": pad + 1 } as CSSProperties) : undefined}>
      <span className="fig-w">{text.slice(0, point)}</span>
      <span className="fig-f">{text.slice(point)}</span>
      {asset ? <span className="fig-code"> {asset}</span> : null}
    </span>
  );
}

/** A price in its desk form, e.g. `$64 000,00000000`. Accepts the API's plain string or price units. */
export function Price({ value, className }: { value: string | bigint; className?: string }) {
  const text = displayPrice(value);
  const point = text.indexOf(",");
  return (
    <span className={`fig${className ? ` ${className}` : ""}`}>
      <span className="fig-w">{text.slice(0, point)}</span>
      <span className="fig-f">{text.slice(point)}</span>
    </span>
  );
}

/** A plain mono figure that is not an amount: ids, health factors, share prices, rates. */
export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={`mono${className ? ` ${className}` : ""}`}>{children}</span>;
}

export function Labelled({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={`kv${className ? ` ${className}` : ""}`}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function counted(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

export function amountCopy(minor: string, decimals: number, asset: string): string {
  return `${displayAmount(minor, decimals)} ${asset}`;
}

/** A button that stays focusable while busy: `aria-disabled` keeps focus where the member pressed. */
export function ActionButton({
  busy,
  children,
  tone,
  buttonRef,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean; tone?: "signal" | "quiet"; buttonRef?: Ref<HTMLButtonElement> }) {
  return (
    <button
      type="button"
      {...rest}
      ref={buttonRef}
      className={`btn${tone ? ` btn-${tone}` : ""}`}
      aria-disabled={busy ? true : undefined}
      onClick={busy ? undefined : rest.onClick}
    >
      {children}
    </button>
  );
}

interface FieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  inputMode?: "decimal" | "email" | "text";
  hint?: ReactNode;
  autoComplete?: string;
  inputRef?: Ref<HTMLInputElement>;
  /** Pressing Enter in the field presses the field's own button: focus moves to it and it is clicked. */
  enterButton?: string;
  /** Pressing Enter runs this instead, leaving focus where it is (the liquidation dialog). */
  onEnter?: () => void;
}

export function Field({ id, label, value, onChange, error, inputMode = "decimal", hint, autoComplete = "off", inputRef, enterButton, onEnter }: FieldProps) {
  const described = [error ? `${id}-error` : null, hint ? `${id}-hint` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className={`field${error ? " field-invalid" : ""}`}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        ref={inputRef}
        type="text"
        inputMode={inputMode}
        autoComplete={autoComplete}
        spellCheck={false}
        value={value}
        aria-invalid={error ? true : undefined}
        aria-describedby={described}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={
          enterButton || onEnter
            ? (event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                if (onEnter) onEnter();
                else {
                  const button = document.getElementById(enterButton ?? "");
                  button?.focus();
                  button?.click();
                }
              }
            : undefined
        }
      />
      {error ? (
        <p className="field-error" id={`${id}-error`}>
          {error}
        </p>
      ) : null}
      {hint ? (
        <p className="field-hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function Select({ id, label, value, onChange, options }: { id: string; label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** An in-app link: navigates without a page load. */
export function Link({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  const { navigate } = useNav();
  return (
    <a
      href={href}
      className={className}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        navigate(href);
      }}
    >
      {children}
    </a>
  );
}

/** Converts a typed desk amount for an asset, returning minor units or the browser-side field message. */
export function typedAmount(typed: string, decimals: number): { minor: string } | { error: string } {
  const parsed = parseAmount(typed, decimals);
  return parsed.ok ? { minor: parsed.value } : { error: parsed.error };
}

/** The browser-side error of an amount field as it is being typed in. */
export function amountError(typed: string, decimals: number): string | undefined {
  return liveError(typed, (value) => parseAmount(value, decimals));
}

/**
 * Runs one member action: pending copy and a busy button while it runs, the success copy in Announcements,
 * refusals in Problems (422s also under their fields), and a refresh of every live view afterwards.
 */
export function useAction(fields: Record<string, FieldLink>) {
  const feedback = useFeedback();
  const { refresh } = useSession();
  const [busy, setBusy] = useState<string | null>(null);
  const running = useRef(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const showFieldErrors = useCallback(
    (byField: Record<string, string>) => {
      const byId: Record<string, string> = {};
      const links: FieldLink[] = [];
      for (const [field, message] of Object.entries(byField)) {
        const link = fields[field];
        if (!link) continue;
        byId[link.id] = message;
        links.push(link);
      }
      setErrors(byId);
      feedback.announce(null);
      feedback.report(links.length > 0 ? { fields: links } : { text: Object.values(byField).join(" ") });
      // A refused submission moves focus to the first field in error.
      const first = links[0];
      if (first) document.getElementById(first.id)?.focus();
    },
    [feedback, fields],
  );

  const run = useCallback(
    async <T,>(name: string, action: { pending: string; call: () => Promise<T>; done: (result: T) => Announcement | null; failed?: (failure: Failure) => void }): Promise<T | undefined> => {
      if (running.current) return undefined;
      running.current = true;
      setBusy(name);
      setErrors({});
      feedback.report(null);
      feedback.announce({ text: action.pending });
      try {
        const result = await action.call();
        feedback.announce(action.done(result));
        return result;
      } catch (error) {
        const failure = failureOf(error);
        feedback.announce(null);
        if (failure.kind === "fields") showFieldErrors(failure.errors);
        else feedback.reportFailure(failure);
        action.failed?.(failure);
        return undefined;
      } finally {
        running.current = false;
        setBusy(null);
        refresh();
      }
    },
    [feedback, refresh, showFieldErrors],
  );

  return { busy, errors, run, showFieldErrors };
}

/** The most decimals among the assets a column shows, for `Fig`'s `pad`. */
export function widestDecimals(assets: string[], decimalsOf: (asset: string) => number): number {
  return assets.reduce((widest, asset) => Math.max(widest, decimalsOf(asset)), 0);
}
