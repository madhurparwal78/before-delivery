import { useCallback, useRef } from "react";
import type { FieldJson } from "../../shared/types";
import { api } from "./api";
import type { Track } from "./useDocument";

type Patch = Partial<Pick<FieldJson, "recipientId" | "page" | "x" | "y" | "w" | "h" | "required" | "label">>;

export function useFieldSaver(documentId: string, track: Track, onFailure: () => void) {
  const pending = useRef(new Map<string, Patch>());
  const flying = useRef(new Set<string>());

  const flush = useCallback(
    async (fieldId: string) => {
      if (flying.current.has(fieldId)) return;
      flying.current.add(fieldId);
      try {
        for (let patch = pending.current.get(fieldId); patch; patch = pending.current.get(fieldId)) {
          pending.current.delete(fieldId);
          await api.patch(`/api/documents/${documentId}/fields/${fieldId}`, patch);
        }
      } catch {
        pending.current.delete(fieldId);
        onFailure();
      } finally {
        flying.current.delete(fieldId);
      }
    },
    [documentId, onFailure],
  );

  return useCallback(
    (fieldId: string, patch: Patch) => {
      pending.current.set(fieldId, { ...pending.current.get(fieldId), ...patch });
      void track(flush(fieldId));
    },
    [flush, track],
  );
}
