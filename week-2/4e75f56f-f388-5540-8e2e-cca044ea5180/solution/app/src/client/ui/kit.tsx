// Small shared pieces: icons drawn for this app, labelled fields with errors, media hooks.
import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";

type IconName = "lock" | "clock" | "dot" | "menu" | "close" | "map" | "download" | "upload" | "check" | "arrow";

const PATHS: Record<IconName, string> = {
  lock: "M7 11V8a5 5 0 0 1 10 0v3M5.5 11h13v9.5h-13z",
  clock: "M12 7v5l3 2M12 3.5a8.5 8.5 0 1 0 0 17a8.5 8.5 0 0 0 0-17z",
  dot: "M12 9a3 3 0 1 0 0 6a3 3 0 0 0 0-6z",
  menu: "M4 7h16M4 12h16M4 17h10",
  close: "M6 6l12 12M18 6L6 18",
  map: "M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11zM12 7.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 0 0 0-5z",
  download: "M12 4v11M7 10.5l5 5l5-5M5 20h14",
  upload: "M12 20V9M7 13.5l5-5l5 5M5 4h14",
  check: "M5 12.5l4.5 4.5L19 7.5",
  arrow: "M5 12h14M13 6l6 6l-6 6",
};

export function Icon({ name, class: className }: { name: IconName; class?: string }) {
  return (
    <svg class={`icon ${className ?? ""}`} viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
      <path d={PATHS[name]} fill={name === "dot" ? "currentColor" : "none"} stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}

export function Field(props: {
  id: string;
  label: string;
  type?: string;
  value: string;
  error?: string | undefined;
  autocomplete?: string;
  role?: string;
  onInput: (value: string) => void;
}) {
  return (
    <div class={`field ${props.error ? "field--error" : ""}`}>
      <label for={props.id}>{props.label}</label>
      <input
        id={props.id}
        name={props.id}
        type={props.type ?? "text"}
        value={props.value}
        autocomplete={props.autocomplete}
        aria-invalid={props.error ? "true" : undefined}
        aria-describedby={props.error ? `${props.id}-error` : undefined}
        onInput={(event) => props.onInput((event.target as HTMLInputElement).value)}
      />
      {props.error && (
        <p class="field__error" id={`${props.id}-error`}>
          {props.error}
        </p>
      )}
    </div>
  );
}

/** Error summary at the top of a form, linking to each field in error. */
export function ErrorSummary({ errors, ids }: { errors: Record<string, string>; ids: Record<string, string> }) {
  const entries = Object.entries(errors).filter(([field]) => ids[field]);
  if (!entries.length) return null;
  return (
    <div class="error-summary" role="alert">
      <p>Check these fields:</p>
      <ul>
        {entries.map(([field, message]) => (
          <li key={field}>
            <a href={`#${ids[field]}`}>{message}</a>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const list = matchMedia(query);
    const update = () => setMatches(list.matches);
    list.addEventListener("change", update);
    update();
    return () => list.removeEventListener("change", update);
  }, [query]);
  return matches;
}

export const NARROW = "(max-width: 767px)";
export const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

export function Live({ label, message }: { label: string; message: string }) {
  return (
    <div class="live" role="status" aria-label={label} aria-live="polite">
      {message}
    </div>
  );
}

export function Page({ title, children, wide }: { title: string; children: ComponentChildren; wide?: boolean }) {
  return (
    <div class="staff">
      <header class="staff__bar">
        <a class="brand" href="/">
          <span class="brand__mark" aria-hidden="true" />
          <span>Opaline Bench Days</span>
        </a>
        <span class="staff__title">{title}</span>
      </header>
      <main id="main" class={`staff__main ${wide ? "staff__main--wide" : ""}`}>
        {children}
      </main>
    </div>
  );
}

/** Opens a document link (fetched fresh, valid 60 seconds) in a new tab. */
export async function openLink(path: string): Promise<{ ok: boolean; status: number }> {
  const response = await fetch(path, { credentials: "same-origin" });
  if (!response.ok) return { ok: false, status: response.status };
  const body = (await response.json()) as { url: string };
  window.open(body.url, "_blank", "noopener");
  return { ok: true, status: 200 };
}
