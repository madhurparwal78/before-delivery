// The desk store: session, state, the live stream, feedback (G07 status, G08 alert, inline notes)
// and the command runner with retry, step-up and sign-in resume.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ALERT_FIELD_COPIES, F, holdReleased } from "../shared/feedback";
import { draftKey } from "../shared/drafts";
import type { ApiError, DeskState, SessionInfo, StreamEvent } from "../shared/types";
import { api } from "./api";
import { readDraft, writeDraft } from "./drafts";

const SETTLE_QUIET_MS = 600;
const SETTLE_CAP_MS = 2500;

/** Resolves once fonts and photos are in and no resource has finished for a moment, or at the cap. */
function pageSettled(): Promise<void> {
  return new Promise((resolve) => {
    const started = performance.now();
    let seen = -1;
    let since = started;
    const tick = () => {
      const now = performance.now();
      const finished = performance.getEntriesByType("resource").length;
      const loading = document.fonts.status !== "loaded" || Array.from(document.images).some((img) => !img.complete);
      if (finished !== seen || loading) {
        seen = finished;
        since = now;
      }
      if (now - since >= SETTLE_QUIET_MS || now - started >= SETTLE_CAP_MS) resolve();
      else setTimeout(tick, 100);
    };
    tick();
  });
}

type SuccessKind =
  | "intake" | "quarantine" | "reconcile" | "annotation" | "tray" | "fill" | "keeper" | "undo" | "send" | "hold"
  | "release" | "replace" | "accept" | "freeze" | "arrival" | "receipt" | "dispute" | "marker" | "propose" | "approve"
  | "link" | "revoke-link" | "mark";

export interface CommandRequest {
  kind: SuccessKind;
  method: "POST" | "PUT" | "DELETE";
  /** Path below /api/desks/<ns>. */
  path: string;
  body?: Record<string, unknown>;
  form?: FormData;
  commandId: string;
}

type CommandOutcome =
  | { ok: true; body: unknown }
  | { ok: false; status: number; error?: ApiError; stepUp?: boolean; offline?: boolean };

type Phase = "loading" | "ready" | "signed-out" | "unavailable" | "hidden";
type NoteKind = "service" | "conflict" | "session";

interface Note {
  kind: NoteKind;
  copy: string;
  retry?: () => void;
}

interface DeskValue {
  ns: string;
  session: SessionInfo | null;
  state: DeskState | null;
  clock: string | null;
  phase: Phase;
  revoked: boolean;
  online: boolean;
  status: string;
  alertText: string;
  note: Note | null;
  announce: (text: string) => void;
  showError: (text: string) => void;
  refresh: () => Promise<DeskState | null>;
  send: (request: CommandRequest) => Promise<CommandOutcome>;
  stepUp: (request: CommandRequest | null, reopen?: string) => void;
  signInAgain: () => void;
  photoUrl: (id: string) => string;
}

const DeskContext = createContext<DeskValue | null>(null);

export function useDesk(): DeskValue {
  return useContext(DeskContext)!;
}

const pendingKey = (ns: string) => draftKey(ns, "session", "pending");
export const reopenKey = (ns: string) => draftKey(ns, "session", "reopen");

interface StoredCommand {
  request: Omit<CommandRequest, "form">;
}

/** Field copies the brief routes to G08 too; otherwise the 422 headline copy. */
function alertCopy(error: ApiError): string {
  const fieldCopies = Object.values(error.fields ?? {});
  return fieldCopies.length === 1 && ALERT_FIELD_COPIES.includes(fieldCopies[0]!) ? fieldCopies[0]! : error.message;
}

export function DeskProvider({ ns, success, children }: { ns: string; success: (request: CommandRequest, body: unknown, state: DeskState | null) => string | null; children: ReactNode }) {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [state, setState] = useState<DeskState | null>(null);
  const [clock, setClock] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [revoked, setRevoked] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [status, setStatus] = useState("");
  const [alertText, setAlertText] = useState("");
  const [note, setNote] = useState<Note | null>(null);
  const queue = useRef<string[]>([]);
  const speaking = useRef(false);
  const shown = useRef("");
  const own = useRef(new Set<string>());
  const commandTypes = useRef(new Map<string, string>());
  const stateRef = useRef<DeskState | null>(null);
  const sessionRef = useRef<SessionInfo | null>(null);
  stateRef.current = state;
  sessionRef.current = session;

  /** Each announcement lands in its own task so assistive tech and observers hear every one. */
  const announce = useCallback((text: string) => {
    const last = queue.current.at(-1) ?? shown.current;
    if (text !== "" && text === last) queue.current.push("");
    queue.current.push(text);
    if (speaking.current) return;
    speaking.current = true;
    const next = () => {
      const item = queue.current.shift();
      if (item === undefined) {
        speaking.current = false;
        return;
      }
      shown.current = item;
      setStatus(item);
      setTimeout(next, 60);
    };
    next();
  }, []);

  const showError = useCallback((text: string) => setAlertText(text), []);

  const refresh = useCallback(async (): Promise<DeskState | null> => {
    const [who, desk] = await Promise.all([api<SessionInfo>("GET", "/api/session"), api<DeskState>("GET", `/api/desks/${ns}/state`)]);
    if (who.ok) setSession(who.body);
    if (desk.ok) {
      setState(desk.body);
      setClock(desk.headers.get("x-desk-clock"));
      setPhase("ready");
      return desk.body;
    }
    if (desk.status === 401) {
      setPhase((p) => (p === "loading" ? "signed-out" : p));
    } else if (desk.status === 404) {
      setPhase("hidden");
      setAlertText(F.HIDDEN);
    } else if (desk.status === 503 || desk.status === 0) {
      setPhase((p) => (p === "loading" ? "unavailable" : p));
    }
    return null;
  }, [ns]);

  const signInAgain = useCallback(() => {
    window.location.assign(`/auth/login?return_to=${encodeURIComponent(location.pathname + location.search)}`);
  }, []);

  const stepUp = useCallback(
    (request: CommandRequest | null, reopen?: string) => {
      if (request) writeDraft<StoredCommand>(pendingKey(ns), { request: { ...request, form: undefined } as Omit<CommandRequest, "form"> });
      if (reopen) writeDraft(reopenKey(ns), reopen);
      window.location.assign(`/auth/step-up?return_to=${encodeURIComponent(location.pathname + location.search)}`);
    },
    [ns],
  );

  const send = useCallback(
    async (request: CommandRequest): Promise<CommandOutcome> => {
      setAlertText("");
      setNote(null);
      announce(F.PENDING);
      own.current.add(request.commandId);
      const path = `/api/desks/${ns}${request.path}`;
      const result = await api<unknown>(request.method, path, request.form ?? request.body);
      if (result.ok) {
        const latest = await refresh();
        announce(success(request, result.body, latest) ?? "");
        return { ok: true, body: result.body };
      }
      announce("");
      if ("offline" in result) {
        if (!navigator.onLine) announce(F.OFFLINE);
        else {
          setAlertText(F.SERVICE);
          setNote({ kind: "service", copy: F.SERVICE, retry: () => void send(request) });
        }
        return { ok: false, status: 0, offline: true };
      }
      const error = result.error;
      if (result.status === 401) {
        setAlertText(F.SESSION);
        if (!request.form) writeDraft<StoredCommand>(pendingKey(ns), { request });
        setNote({ kind: "session", copy: F.SESSION });
        return { ok: false, status: 401, error };
      }
      if (result.status === 403 && error.error === "step_up_required") {
        setAlertText(F.MFA_REQUIRED);
        return { ok: false, status: 403, error, stepUp: true };
      }
      if (result.status === 503 && error.error === "service_unavailable") {
        setAlertText(F.SERVICE);
        setNote({ kind: "service", copy: F.SERVICE, retry: () => void send(request) });
        return { ok: false, status: 503, error };
      }
      if (result.status === 409 && error.message === F.CONFLICT) {
        setAlertText(F.CONFLICT);
        setNote({ kind: "conflict", copy: F.CONFLICT });
        return { ok: false, status: 409, error };
      }
      setAlertText(alertCopy(error));
      return { ok: false, status: result.status, error };
    },
    [announce, ns, refresh, success],
  );

  const revoke = useCallback(() => {
    setRevoked(true);
    setAlertText(F.REVOKED);
    setNote(null);
    requestAnimationFrame(() => document.getElementById("desk-main")?.focus());
  }, []);

  // Boot: session and state, then the resume of a confirmed command interrupted by sign-in or step-up.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const who = await api<SessionInfo>("GET", "/api/session");
      if (cancelled) return;
      if (!who.ok) {
        if (who.status === 401) {
          setPhase("signed-out");
          setAlertText(F.SESSION);
          setNote({ kind: "session", copy: F.SESSION });
        } else {
          setPhase("unavailable");
          setAlertText(F.SERVICE);
          setNote({ kind: "service", copy: F.SERVICE, retry: () => window.location.reload() });
        }
        return;
      }
      setSession(who.body);
      await refresh();
      const stored = readDraft<StoredCommand | null>(pendingKey(ns), null);
      if (stored && !cancelled) {
        writeDraft(pendingKey(ns), null);
        announce(F.RESUMED);
        await send(stored.request);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ns, refresh, announce, send]);

  // Live stream: replays missed events in order, then streams; each event redraws in place.
  // It opens once the page's own loads have settled (the replay from `after` covers the wait), so a
  // page that finished loading reads as idle rather than as one request that never ends.
  useEffect(() => {
    if (phase !== "ready" || revoked || !stateRef.current) return;
    const after = stateRef.current.version;
    let source: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;
    void pageSettled().then(() => {
      if (closed) return;
      source = new EventSource(`/api/desks/${ns}/stream?after=${after}`);
      source.onmessage = onMessage;
    });
    const onMessage = (message: MessageEvent) => {
      const event = JSON.parse(message.data as string) as StreamEvent;
      const mine = own.current.has(event.command_id);
      const before = commandTypes.current.get(event.command_id);
      commandTypes.current.set(event.command_id, event.type);
      if (event.type === "access.ended" && event.detail.subject === sessionRef.current?.subject) {
        source?.close();
        revoke();
        return;
      }
      if (!mine) {
        const label = event.detail.specimen ? `Specimen ${event.detail.specimen}` : "";
        const copy: Partial<Record<StreamEvent["type"], string>> = {
          "offer.replaced": F.COUNTER_VOID,
          "dispute.opened": F.DISPUTE_OPEN,
          "resolution.proposed": F.RESOLUTION_WAIT,
          "resolution.approved": F.RESOLUTION_DONE,
        };
        if (copy[event.type]) announce(copy[event.type]!);
        if (event.type === "ownership.transferred" && before === "receipt.recorded") announce(F.RECEIPT_DONE);
        if (event.type === "hold.released" && sessionRef.current?.role === "dealer" && label) announce(holdReleased(label));
      }
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void refresh(), 30);
    };
    return () => {
      closed = true;
      source?.close();
      if (timer) clearTimeout(timer);
    };
  }, [phase, revoked, ns, announce, refresh, revoke]);

  // Server-stated values (windows, step-up freshness) refresh at least every 60 seconds.
  useEffect(() => {
    if (phase !== "ready" || revoked) return;
    const id = setInterval(() => void refresh(), 30000);
    return () => clearInterval(id);
  }, [phase, revoked, refresh]);

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => {
      setOnline(false);
      announce(F.OFFLINE);
    };
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, [announce]);

  const photoUrl = useCallback((id: string) => `/api/desks/${ns}/photos/${encodeURIComponent(id)}`, [ns]);

  const value = useMemo<DeskValue>(
    () => ({ ns, session, state, clock, phase, revoked, online, status, alertText, note, announce, showError, refresh, send, stepUp, signInAgain, photoUrl }),
    [ns, session, state, clock, phase, revoked, online, status, alertText, note, announce, showError, refresh, send, stepUp, signInAgain, photoUrl],
  );
  return <DeskContext.Provider value={value}>{children}</DeskContext.Provider>;
}
