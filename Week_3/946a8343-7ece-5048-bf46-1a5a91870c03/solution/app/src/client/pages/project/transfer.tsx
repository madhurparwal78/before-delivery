// Export and import progress: the state of one transfer, kept in sessionStorage per project so a reload shows it again, followed
// live through `export` / `import` messages and by polling its status route while it runs.
import { useCallback, useLayoutEffect, useRef, useState } from "preact/hooks";
import { api } from "../../api.ts";
import { type LiveMessage, useLivePage, useProjectLive } from "../../live.ts";
import { useFocusOnArrival } from "../../router.ts";
import { asNumber, asString, isRecord } from "../../util.ts";
import type { TransferState, TransferStatus } from "./types.ts";

type TransferKind = "export" | "import";

const POLL_MS = 1500;
const STATUSES: readonly TransferStatus[] = ["preview", "running", "finished", "failed"];

function statusOf(value: unknown): TransferStatus | null {
  return STATUSES.find((status) => status === value) ?? null;
}

function storageKey(kind: TransferKind, projectId: string): string {
  return `spurline:${kind}:${projectId}`;
}

function parseState(value: unknown): TransferState | null {
  if (!isRecord(value)) return null;
  const id = asNumber(value.id);
  const status = statusOf(value.status);
  if (id === null || status === null) return null;
  return { id, status, progress: asNumber(value.progress) ?? 0, error: asString(value.error), download: asString(value.download) };
}

function remembered(kind: TransferKind, projectId: string): TransferState | null {
  try {
    const text = sessionStorage.getItem(storageKey(kind, projectId));
    return text === null ? null : parseState(JSON.parse(text));
  } catch {
    return null;
  }
}

function remember(kind: TransferKind, projectId: string, state: TransferState): void {
  try {
    sessionStorage.setItem(storageKey(kind, projectId), JSON.stringify(state));
  } catch {
    // Storage may be unavailable in private windows; the page then only follows the live messages.
  }
}

interface Transfer {
  state: TransferState | null;
  /** Counts starts; the progress bar takes focus whenever it changes. */
  focusToken: number;
  begin(id: number): void;
}

export function useTransfer(kind: TransferKind, projectId: string): Transfer {
  const [state, setState] = useState<TransferState | null>(() => remembered(kind, projectId));
  const [focusToken, setFocusToken] = useState(0);
  const latest = useRef(state);
  latest.current = state;
  const page = useLivePage();

  const commit = useCallback(
    (next: TransferState) => {
      latest.current = next;
      remember(kind, projectId, next);
      setState(next);
    },
    [kind, projectId],
  );

  const fetchState = useCallback(
    async (id: number) => {
      const body: unknown = await api.get(`/api/${kind}s/${id}`);
      const fresh = parseState(body);
      if (fresh === null || latest.current === null || latest.current.id !== id) return;
      commit({ ...fresh, progress: Math.max(fresh.progress, latest.current.progress) });
    },
    [kind, commit],
  );

  const begin = useCallback(
    (id: number) => {
      commit({ id, status: "running", progress: 0, error: null, download: null });
      setFocusToken((n) => n + 1);
    },
    [commit],
  );

  useLayoutEffect(() => {
    const known = latest.current;
    if (known !== null) void fetchState(known.id).catch(() => undefined);
  }, [fetchState]);

  useProjectLive(projectId, (message: LiveMessage) => {
    if (message.type !== kind) return;
    const id = asNumber(message.data.id);
    const status = statusOf(message.data.status);
    const progress = asNumber(message.data.progress);
    if (id === null || status === null || progress === null) return;
    const current = latest.current;
    if (current !== null && current.id > id) return;
    const next: TransferState =
      current !== null && current.id === id
        ? { ...current, status, progress: Math.max(current.progress, progress) }
        : { id, status, progress, error: null, download: null };
    commit(next);
    if (status === "finished" || status === "failed") {
      const done = message.seq !== null && page ? page.begin(message.seq) : null;
      fetchState(id).then(done ?? undefined, done ?? undefined);
    }
  });

  const running = state !== null && state.status === "running";
  const id = state?.id ?? null;
  useLayoutEffect(() => {
    if (!running || id === null) return;
    const timer = window.setInterval(() => void fetchState(id).catch(() => undefined), POLL_MS);
    return () => window.clearInterval(timer);
  }, [running, id, fetchState]);

  return { state, focusToken, begin };
}

export function ProgressPanel({ label, state, focusToken }: { label: string; state: TransferState; focusToken: number }) {
  const bar = useRef<HTMLDivElement>(null);
  useFocusOnArrival(bar);
  useLayoutEffect(() => {
    if (focusToken > 0) bar.current?.focus();
  }, [focusToken]);
  return (
    <div class="sp-progress">
      <div
        ref={bar}
        role="progressbar"
        tabIndex={-1}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={state.progress}
        class="sp-progress__bar"
      >
        <span class="sp-progress__fill" style={{ width: `${state.progress}%` }} />
      </div>
      <p class="sp-progress__value sp-mono">{state.progress}%</p>
    </div>
  );
}
