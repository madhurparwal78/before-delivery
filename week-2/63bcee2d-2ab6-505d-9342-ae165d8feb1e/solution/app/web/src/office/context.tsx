import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { get, type ErrorBody, type Result } from "../api";
import { navigate, useLocation } from "../router";
import { ACCESS_REMOVED, DRAFT_RESTORED, FORBIDDEN, NETWORK_FAILURE, NOT_FOUND, SESSION_ENDED } from "./copy";

// The signed-in member, the two live regions, and the one way office screens react to a refused call:
// 401 keeps the open form's values and goes to sign-in, 403 access_removed replaces the screen, a missing
// response is the network-failure copy.

export type Role = "director" | "project_lead" | "designer" | "finance" | "client_approver" | "contractor";
export const STUDIO_ROLES: Role[] = ["director", "project_lead", "designer", "finance"];

interface SessionMember {
  id: string;
  name: string;
  role: Role;
  organisation: string;
  email: string;
}

interface DraftForm {
  /** Names the form within its page, e.g. "raise-variation". */
  id: string;
  values: Record<string, unknown>;
}

interface Office {
  member: SessionMember | null;
  loading: boolean;
  removed: boolean;
  status: string;
  problem: string;
  announce: (text: string) => void;
  alert: (text: string) => void;
  clear: () => void;
  refreshSession: () => Promise<SessionMember | null>;
  /**
   * Handles the refusals every screen treats alike. Returns the error body when the caller must
   * decide (409, 412, 422, 503 and the like), or null once handled here.
   */
  refused: (result: Result<unknown> & { ok: false }, form?: DraftForm) => ErrorBody | null;
  /** Takes back a draft kept for this member, page and form, announcing its restoration. */
  takeDraft: (formId: string) => Record<string, unknown> | null;
}

const OfficeContext = createContext<Office | null>(null);
const ENDED_FLAG = "plumbline-session-ended";
const draftKey = (memberId: string): string => `plumbline-draft:${memberId}`;

export function OfficeProvider({ children }: { children: ReactNode }) {
  const [member, setMember] = useState<SessionMember | null>(null);
  const [loading, setLoading] = useState(true);
  const [removed, setRemoved] = useState(false);
  const [status, setStatus] = useState({ text: "", path: "" });
  const [problem, setProblem] = useState({ text: "", path: "" });
  const location = useLocation();
  const memberRef = useRef<SessionMember | null>(null);
  memberRef.current = member;

  const refreshSession = useCallback(async (): Promise<SessionMember | null> => {
    const result = await get<{ member: SessionMember }>("/api/session");
    const next = result.ok ? result.data.member : null;
    flushSync(() => {
      setMember(next);
      setLoading(false);
      if (!result.ok && result.body.error === "access_removed") setRemoved(true);
    });
    return next;
  }, []);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  // Notices belong to the page they were raised on, so a new page starts with empty regions.
  const announce = useCallback((text: string) => flushSync(() => setStatus({ text, path: window.location.pathname })), []);
  const raiseProblem = useCallback((text: string) => flushSync(() => setProblem({ text, path: window.location.pathname })), []);
  const clear = useCallback(() => flushSync(() => {
    setStatus({ text: "", path: "" });
    setProblem({ text: "", path: "" });
  }), []);

  // The sign-in page says why the session ended.
  useEffect(() => {
    if (location.pathname === "/sign-in" && sessionStorage.getItem(ENDED_FLAG)) {
      sessionStorage.removeItem(ENDED_FLAG);
      raiseProblem(SESSION_ENDED);
    }
  }, [location.pathname, raiseProblem]);

  const refused = useCallback((result: Result<unknown> & { ok: false }, form?: DraftForm): ErrorBody | null => {
    const body = result.body;
    if (result.status === 0) {
      raiseProblem(NETWORK_FAILURE);
      return null;
    }
    if (result.status === 401 && body.error === "session_ended") {
      const current = memberRef.current;
      if (current && form) {
        localStorage.setItem(draftKey(current.id), JSON.stringify({ path: location.pathname + location.search, form: form.id, values: form.values }));
      }
      sessionStorage.setItem(ENDED_FLAG, "1");
      navigate(`/sign-in?next=${encodeURIComponent(location.pathname + location.search)}`);
      return null;
    }
    if (result.status === 403 && body.error === "access_removed") {
      const current = memberRef.current;
      if (current) localStorage.removeItem(draftKey(current.id));
      flushSync(() => setRemoved(true));
      raiseProblem(ACCESS_REMOVED);
      return null;
    }
    if (result.status === 403 && body.error === "forbidden") {
      raiseProblem(FORBIDDEN);
      return null;
    }
    if (result.status === 404) {
      raiseProblem(NOT_FOUND);
      return null;
    }
    return body;
  }, [raiseProblem, location.pathname, location.search]);

  const takeDraft = useCallback((formId: string): Record<string, unknown> | null => {
    const current = memberRef.current;
    if (!current) return null;
    const stored = localStorage.getItem(draftKey(current.id));
    if (!stored) return null;
    const draft = JSON.parse(stored) as { path: string; form: string; values: Record<string, unknown> };
    if (draft.form !== formId || draft.path !== location.pathname + location.search) return null;
    localStorage.removeItem(draftKey(current.id));
    announce(DRAFT_RESTORED);
    return draft.values;
  }, [announce, location.pathname, location.search]);

  const statusText = status.path === location.pathname ? status.text : "";
  const problemText = problem.path === location.pathname ? problem.text : "";
  const value = useMemo<Office>(() => ({ member, loading, removed, status: statusText, problem: problemText, announce, alert: raiseProblem, clear,
    refreshSession, refused, takeDraft }),
  [member, loading, removed, statusText, problemText, announce, raiseProblem, clear, refreshSession, refused, takeDraft]);
  return <OfficeContext.Provider value={value}>{children}</OfficeContext.Provider>;
}

export function useOffice(): Office {
  const office = useContext(OfficeContext);
  if (!office) throw new Error("useOffice outside OfficeProvider");
  return office;
}

export const isStudio = (member: SessionMember | null): boolean => !!member && STUDIO_ROLES.includes(member.role);
