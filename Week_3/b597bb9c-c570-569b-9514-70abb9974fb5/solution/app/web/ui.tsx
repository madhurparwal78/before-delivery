import { useEffect, useId, useLayoutEffect, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { api } from "./lib/api";
import { clearNotices, useNotices } from "./lib/notices";
import { Link, navigate } from "./lib/router";
import { allowanceStore, projectsStore, useShell } from "./lib/session";
import { useStore } from "./lib/store";

export function Notices(): ReactNode {
  const { message, banners } = useNotices();
  return (
    <div role="status" aria-label="Notices" className="notices">
      {message ? <p>{message}</p> : null}
      {Object.values(banners).map((banner) => (banner ? <p key={banner}>{banner}</p> : null))}
    </div>
  );
}

export function useCanOpenLibrary(): boolean {
  const { session } = useShell();
  const projects = useStore(projectsStore);
  return session.isOwner || (projects ?? []).some((project) => project.role === "editor");
}

export function SignOut(): ReactNode {
  const out = async (): Promise<void> => {
    await api.del("/api/session").catch(() => undefined);
    clearNotices();
    navigate("/sign-in", true);
  };
  return (
    <button type="button" onClick={() => void out()}>
      Sign out
    </button>
  );
}

export function Allowance(): ReactNode {
  const allowance = useStore(allowanceStore);
  return (
    <span data-allowance className="muted tnum">
      {allowance?.text ?? ""}
    </span>
  );
}

/** The links, the allowance and Sign out that every signed-in page carries in its band. */
export function GlobalNav({ withBrand = true }: { withBrand?: boolean }): ReactNode {
  const library = useCanOpenLibrary();
  return (
    <div className="band-row">
      {withBrand ? (
        <Link to="/" className="brand title">
          Gatecut
        </Link>
      ) : null}
      <nav aria-label="Main" className="nav">
        <Link to="/">Projects</Link>
        {library ? <Link to="/library">Library</Link> : null}
        <Link to="/profile">Profile</Link>
      </nav>
      <SignOut />
      <Allowance />
    </div>
  );
}

/** A standard page: the band with the global links, the Notices strip, then the page. */
export function Page({ band, children, className }: { band?: ReactNode; children: ReactNode; className?: string }): ReactNode {
  return (
    <>
      <header className="band">
        <GlobalNav />
        {band}
      </header>
      <Notices />
      <main className={className}>{children}</main>
    </>
  );
}

function FieldError({ id, message }: { id: string; message?: string | undefined }): ReactNode {
  return message ? (
    <p id={id} className="field-error">
      Error: {message}
    </p>
  ) : null;
}

interface FieldProps {
  label: string;
  name: string;
  error?: string | undefined;
  children: (props: { id: string; name: string; "aria-describedby"?: string; "aria-invalid"?: boolean }) => ReactNode;
}

export function Field({ label, name, error, children }: FieldProps): ReactNode {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className="field" data-field={id}>
      <label htmlFor={id}>{label}</label>
      {children({ id, name, ...(error ? { "aria-describedby": errorId, "aria-invalid": true } : {}) })}
      <FieldError id={errorId} message={error} />
    </div>
  );
}

export function TextField(props: {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | undefined;
  type?: string;
  multiline?: boolean;
  readOnly?: boolean;
  autoFocus?: boolean;
}): ReactNode {
  const { label, name, value, onChange, error, type = "text", multiline, readOnly, autoFocus } = props;
  return (
    <Field label={label} name={name} error={error}>
      {(a11y) =>
        multiline ? (
          <textarea {...a11y} value={value} readOnly={readOnly} rows={3} onChange={(event: ChangeEvent<HTMLTextAreaElement>) => onChange(event.target.value)} />
        ) : (
          <input {...a11y} type={type} value={value} readOnly={readOnly} autoFocus={autoFocus} onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)} />
        )
      }
    </Field>
  );
}

export function SelectField(props: {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly { value: string; label: string }[];
  error?: string | undefined;
}): ReactNode {
  const { label, name, value, onChange, options, error } = props;
  return (
    <Field label={label} name={name} error={error}>
      {(a11y) => (
        <select {...a11y} value={value} onChange={(event: ChangeEvent<HTMLSelectElement>) => onChange(event.target.value)}>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) => !element.hasAttribute("hidden") && element.getAttribute("tabindex") !== "-1");
}

interface DialogProps {
  title: string;
  opener: HTMLElement | null;
  onClose: () => void;
  children: ReactNode;
  summary?: { fields: Record<string, string>; labels: Record<string, string>; token: number; message?: string | undefined } | undefined;
}

/** A modal dialog: Tab and Shift+Tab wrap inside it, Escape closes it, and focus returns to the control that opened it. */
export function Dialog({ title, opener, onClose, children, summary }: DialogProps): ReactNode {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const summaryRef = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return undefined;
    dialog.showModal();
    const first = dialog.querySelector<HTMLElement>("[data-autofocus]") ?? focusables(dialog)[0];
    first?.focus();
    return () => {
      dialog.close();
      opener?.focus();
    };
  }, [opener]);

  useEffect(() => {
    if (summary && summary.token > 0) summaryRef.current?.focus();
  }, [summary]);

  const onKeyDown = (event: KeyboardEvent<HTMLDialogElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      close.current();
      return;
    }
    if (event.key !== "Tab" || !ref.current) return;
    const items = focusables(ref.current);
    const active = document.activeElement;
    const edge = event.shiftKey ? items[0] : items[items.length - 1];
    if (!items.length || active === edge || !ref.current.contains(active)) {
      event.preventDefault();
      (event.shiftKey ? items[items.length - 1] : items[0])?.focus();
    }
  };

  const invalid = summary ? Object.keys(summary.fields) : [];
  return (
    <dialog ref={ref} aria-labelledby={titleId} className="dialog" onKeyDown={onKeyDown} onCancel={(event) => event.preventDefault()}>
      <h2 id={titleId} className="title">
        {title}
      </h2>
      {summary && (invalid.length || summary.message) ? (
        <div ref={summaryRef} tabIndex={-1} role="alert" className="summary">
          <p>{invalid.length ? "Check the highlighted fields." : summary.message}</p>
          <ul>
            {invalid.map((field) => (
              <li key={field}>
                <a
                  href={`#${field}`}
                  onClick={(event) => {
                    event.preventDefault();
                    ref.current?.querySelector<HTMLElement>(`[name="${field}"]`)?.focus();
                  }}
                >
                  {summary.labels[field] ?? field}: {summary.fields[field]}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {children}
    </dialog>
  );
}

/** Remembers which control opened a dialog so focus can return to it. */
export function useDialogState(): { opener: HTMLElement | null; open: boolean; show: (opener?: Element | null) => void; hide: () => void } {
  const [state, setState] = useState<{ open: boolean; opener: HTMLElement | null }>({ open: false, opener: null });
  return {
    opener: state.opener,
    open: state.open,
    show: (opener) => setState({ open: true, opener: (opener ?? document.activeElement) as HTMLElement | null }),
    hide: () => setState((current) => ({ ...current, open: false })),
  };
}

export function onSubmit(handler: () => void): (event: FormEvent) => void {
  return (event) => {
    event.preventDefault();
    handler();
  };
}

