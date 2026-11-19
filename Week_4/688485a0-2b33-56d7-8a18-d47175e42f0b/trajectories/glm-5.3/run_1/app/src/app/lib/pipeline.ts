import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, PreviewAnswer } from "./api";
import { apiErrorMessage } from "./copy";
import { StageState } from "../components/Pipeline";

/**
 * Pipeline state (DP-22, DP-25): the person's draft kept on the server, the
 * debounced preview recompute, and the polite status announcements.
 */

export function usePipeline(pid: string, cid: string) {
  const [stages, setStages] = useState<StageState[]>([]);
  const [preview, setPreview] = useState<PreviewAnswer | null>(null);
  const [collectionCount, setCollectionCount] = useState(0);
  const [pinId, setPinId] = useState("");
  const [pending, setPending] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [errorText, setErrorText] = useState("");
  const [cappedLimit, setCappedLimit] = useState<number | null>(null);
  const [focusedStage, setFocusedStage] = useState<number | null>(null);
  const [readOnly, setReadOnly] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stageRef = useRef<StageState[]>([]);
  stageRef.current = stages;
  const loadedRef = useRef(false);

  useEffect(() => {
    void api.get<{ role: string }>(`/api/projects/${pid}`)
      .then(r => setReadOnly(r.role === "reader"))
      .catch(() => setReadOnly(true));
    void api.get<{ count: number }>(`/api/projects/${pid}/collections/${cid}`)
      .then(r => setCollectionCount(r.count));
    void api.get<{ stages: string[]; disabled: number[] }>(`/api/projects/${pid}/collections/${cid}/pipeline`)
      .then(r => {
        setStages(r.stages.map((t, i) => ({ text: t, disabled: r.disabled.includes(i) })));
        loadedRef.current = true;
      });
  }, [pid, cid]);

  const compute = useCallback(async (): Promise<void> => {
    setPending(true);
    setErrorText("");
    try {
      const pipeline = stages.map(s => {
        try {
          return JSON.parse(s.text);
        } catch {
          return null;
        }
      });
      const body: Record<string, unknown> = {
        pipeline,
        disabled: stages.map((s, i) => s.disabled ? i : -1).filter(i => i >= 0),
        preview: true,
      };
      if (pinId.trim() !== "") body.pin = pinId.trim();
      const res = await api.post<PreviewAnswer>(`/api/projects/${pid}/collections/${cid}/aggregate`, body);
      setPreview(res);
      setCappedLimit(null);
    } catch (err) {
      const e = err as ApiError;
      if (e.code === "scan_limit") {
        setCappedLimit(Number(e.extras.limit));
        setPreview({ input: collectionCount, stages: [], pin: null });
      } else {
        setErrorText(apiErrorMessage(e));
      }
    }
    setPending(false);
  }, [pid, cid, stages, pinId, collectionCount]);

  useEffect(() => {
    if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void compute();
      if (loadedRef.current) {
        void api.put(`/api/projects/${pid}/collections/${cid}/pipeline`, {
          stages: stageRef.current.map(s => s.text),
          disabled: stageRef.current.map((s, i) => s.disabled ? i : -1).filter(i => i >= 0),
        });
      }
    }, 300);
    return () => {
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    };
  }, [stages, compute]);

  const saveDraft = useCallback((next: StageState[]): void => {
    void api.put(`/api/projects/${pid}/collections/${cid}/pipeline`, {
      stages: next.map(s => s.text),
      disabled: next.map((s, i) => s.disabled ? i : -1).filter(i => i >= 0),
    });
  }, [pid, cid]);

  const previewStage = useCallback((index: number | null): void => {
    setFocusedStage(index);
  }, []);

  const focusStage = useCallback((index: number): void => {
    setFocusedStage(index);
  }, []);

  const clearPin = useCallback((): void => {
    setPinId("");
  }, []);

  const recompute = useCallback((): void => {
    void compute();
  }, [compute]);

  return {
    stages, setStages, preview, collectionCount, pinId, pending, statusText,
    errorText, cappedLimit, focusedStage, readOnly,
    setPinId, clearPin, saveDraft, previewStage, focusStage, recompute, compute,
    setStatusText,
  };
}
