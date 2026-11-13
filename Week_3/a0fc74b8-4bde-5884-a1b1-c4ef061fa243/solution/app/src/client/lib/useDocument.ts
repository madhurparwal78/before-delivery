import { useCallback, useEffect, useRef, useState } from "react";
import { STATUS_WORDS } from "../../shared/copy";
import type { DocumentJson } from "../../shared/types";
import { ApiFailure, api } from "./api";
import { useLiveEvents } from "./live";

export type Track = <T>(write: Promise<T>) => Promise<T>;

interface DocumentState {
  doc: DocumentJson | null;
  missing: boolean;
  announcement: string;
  setDoc: (update: (doc: DocumentJson) => DocumentJson) => void;
  reload: () => Promise<void>;
  track: Track;
}

/**
 * The page shows its own writes at once and the server's reads otherwise. Reads and writes share one
 * sequence: a read that overlaps a write from this page (or arrives after a newer read) may predate that
 * write, so it is dropped and the page reads again once its writes have settled.
 */
export function useDocument(id: string): DocumentState {
  const [doc, setDocState] = useState<DocumentJson | null>(null);
  const [missing, setMissing] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const status = useRef<string | null>(null);
  const sequence = useRef(0);
  const writes = useRef({ open: 0, settledAt: 0, dropped: false });
  const applied = useRef(0);

  const reload = useCallback(async () => {
    const started = (sequence.current += 1);
    try {
      const fresh = await api.get<DocumentJson>(`/api/documents/${id}`);
      if (writes.current.open > 0 || writes.current.settledAt > started) {
        writes.current.dropped = true;
        return;
      }
      if (started < applied.current) return;
      applied.current = started;
      if (status.current !== null && status.current !== fresh.status) setAnnouncement(`${fresh.title}: ${STATUS_WORDS[fresh.status]}`);
      status.current = fresh.status;
      setDocState(fresh);
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 404) setMissing(true);
    }
  }, [id]);

  const track = useCallback<Track>(
    (write) => {
      writes.current.open += 1;
      const settle = () => {
        const state = writes.current;
        state.open -= 1;
        state.settledAt = sequence.current += 1;
        if (state.open === 0 && state.dropped) {
          state.dropped = false;
          void reload();
        }
      };
      return write.then(
        (value) => {
          settle();
          return value;
        },
        (error: unknown) => {
          settle();
          throw error;
        },
      );
    },
    [reload],
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  useLiveEvents((event) => {
    if (event.type === "resync" || (event.type === "document" && event.documentId === id)) void reload();
  });

  const setDoc = useCallback((update: (doc: DocumentJson) => DocumentJson) => {
    setDocState((previous) => (previous ? update(previous) : previous));
  }, []);

  return { doc, missing, announcement, setDoc, reload, track };
}
