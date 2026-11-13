// Fetching with an answer for the current request only: a reply for an earlier request is
// dropped even when it arrives last.

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiFailure, newKey, type Bookmark, type ChapterSummary } from "./api.js";
import { useApp } from "./state.js";
import { COPY, copyFor } from "../shared/copy.js";

interface Loaded<T> {
  data: T | null;
  failure: ApiFailure | null;
  loading: boolean;
  reload: () => void;
}

export function useApi<T>(path: string | null): Loaded<T> {
  const [state, setState] = useState<{ data: T | null; failure: ApiFailure | null; loading: boolean }>({ data: null, failure: null, loading: path !== null });
  const [version, setVersion] = useState(0);
  const latest = useRef(0);
  useEffect(() => {
    if (path === null) return;
    const ticket = ++latest.current;
    setState((s) => ({ ...s, loading: true }));
    api<T>(path).then(
      (data) => ticket === latest.current && setState({ data, failure: null, loading: false }),
      (error: unknown) => ticket === latest.current && setState({ data: null, failure: error instanceof ApiFailure ? error : null, loading: false }),
    );
  }, [path, version]);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { ...state, reload };
}

export function useChapters(signedInAs: string | null, pathVersion: number): ChapterSummary[] | null {
  const { data } = useApi<{ chapters: ChapterSummary[] }>(`/api/chapters?for=${signedInAs ?? ""}&v=${pathVersion}`);
  return data?.chapters ?? null;
}

/**
 * One Idempotency-Key per set of field values: an unchanged resubmit (after a failed or lost
 * reply) reuses it, any change gets a new one (brief: Interactions › Donating).
 */
export function useStableKey(signature: string): () => string {
  const current = useRef<{ signature: string; key: string } | null>(null);
  return useCallback(() => {
    if (current.current?.signature !== signature) current.current = { signature, key: newKey() };
    return current.current.key;
  }, [signature]);
}

/** The signed-in visitor's bookmarks and a toggle that keeps them and the Notices in step. */
export function useBookmarks() {
  const app = useApp();
  const listed = useApi<{ bookmarks: Bookmark[] }>(app.user ? `/api/me/bookmarks?for=${app.user.id}` : null);
  const [marks, setMarks] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    setMarks(new Map((listed.data?.bookmarks ?? []).map((b) => [b.target_id, b.id])));
  }, [listed.data]);
  const toggle = useCallback(
    async (target_type: Bookmark["target_type"], target_id: string, title: string, opener: HTMLElement) => {
      if (!app.user) return app.openSignIn(opener);
      const existing = marks.get(target_id);
      try {
        if (existing) {
          await api(`/api/me/bookmarks/${existing}`, { method: "DELETE" });
          setMarks((m) => {
            const next = new Map(m);
            next.delete(target_id);
            return next;
          });
          app.announce(COPY.bookmarkRemoved);
        } else {
          const { bookmark } = await api<{ bookmark: Bookmark }>("/api/me/bookmarks", { body: { target_type, target_id } });
          setMarks((m) => new Map(m).set(target_id, bookmark.id));
          app.announce(copyFor.bookmarked(title));
        }
      } catch (error) {
        if (error instanceof ApiFailure) {
          app.announce(error.error.message);
          if (error.error.code === "accounts_unavailable") app.setServiceNotice(COPY.accountsDown);
        }
      }
    },
    [app, marks],
  );
  return { marked: (targetId: string) => marks.has(targetId), toggle };
}
