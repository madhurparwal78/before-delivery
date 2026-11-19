import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { displayNumber, plural } from "../../shared/display.js";
import type { JsonObject, JsonValue } from "../../shared/json.js";
import { asFailure, get, post, put } from "../api.js";
import { barFraction, type BandTarget, type SieveMotion } from "../components/Sieve.js";
import { pipelineErrorText } from "../copy.js";
import { reducedMotion } from "../focus.js";
import { useShell } from "../shell/ProjectShell.js";

/** The pipeline draft and its Stage Sieve: every change is saved as the person's draft and recomputed on the server. */

export interface StageDraft {
  key: string;
  text: string;
  disabled: boolean;
  /** The stage operator last read from the text, kept while the text is not valid JSON. */
  op: string;
}

interface Preview {
  input: number;
  order: string[];
  disabled: boolean[];
  counts: number[];
  documents: JsonObject[][];
  /** The scan limit when the server refused the run and every count is shown as at most that. */
  capped: number | null;
  pin: { stoppedAt: number | null } | null;
  changedFrom: number;
}

const DEBOUNCE_MS = 300;
const NEW_STAGE = '{"$match":{}}';
let counter = 0;
const nextKey = (): string => `stage-${++counter}`;

function parseStage(text: string): { ok: true; value: JsonValue; op: string | null } | { ok: false } {
  try {
    const value = JSON.parse(text) as JsonValue;
    const keys = typeof value === "object" && value !== null && !Array.isArray(value) ? Object.keys(value) : [];
    return { ok: true, value, op: keys[0] ?? null };
  } catch {
    return { ok: false };
  }
}

function toDraft(text: string, disabled: boolean): StageDraft {
  const parsed = parseStage(text);
  return { key: nextKey(), text, disabled, op: parsed.ok && parsed.op ? parsed.op : "stage" };
}

export function stageStatus(index: number, total: number, stage: StageDraft, preview: Preview | null): string {
  if (!parseStage(stage.text).ok) return "not valid JSON";
  if (stage.disabled) return "pass through";
  if (!preview) return "";
  const position = `Stage ${displayNumber(index + 1)} of ${displayNumber(total)}`;
  if (preview.capped !== null) return `${position}: ≤${displayNumber(preview.capped)} documents out`;
  const at = preview.order.indexOf(stage.key);
  const count = preview.counts[at];
  return count === undefined ? "" : `${position}: ${plural(count, "document")} out`;
}

export interface PipelineState {
  stages: StageDraft[] | null;
  preview: Preview | null;
  error: string;
  status: string;
  pinText: string;
  setPinText: (text: string) => void;
  pin: string | null;
  setPin: (id: string | null) => void;
  focusedKey: string | null;
  setFocusedKey: (key: string | null) => void;
  add: () => void;
  edit: (index: number, text: string) => void;
  toggle: (index: number) => void;
  move: (from: number, to: number) => void;
  remove: (index: number) => void;
  /** Called by the builder to say where focus should land after the next change. */
  focusAfter: RefObject<{ key: string; text?: true } | { add: true } | null>;
}

export function usePipeline(motion: SieveMotion): PipelineState {
  const { project, collection } = useShell();
  const cid = collection?.id ?? "";
  const base = `/api/projects/${project.id}/collections/${cid}`;
  const count = collection?.count ?? 0;
  const [stages, setStages] = useState<StageDraft[] | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [pinText, setPinText] = useState("");
  const [pin, setPinState] = useState<string | null>(null);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const ticket = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusAfter = useRef<{ key: string; text?: true } | { add: true } | null>(null);
  const saving = useRef<{ running: boolean; next: StageDraft[] | null }>({ running: false, next: null });
  const latest = useRef<{ stages: StageDraft[] | null; pin: string | null; count: number }>({ stages: null, pin: null, count });
  latest.current = { stages, pin, count };

  const flushDraft = useCallback(async (): Promise<void> => {
    const queue = saving.current;
    if (queue.running) return;
    queue.running = true;
    while (queue.next) {
      const draft = queue.next;
      queue.next = null;
      const disabled = draft.flatMap((stage, index) => (stage.disabled ? [index] : []));
      await put(`${base}/pipeline`, { stages: draft.map((stage) => stage.text), disabled }).catch(() => undefined);
    }
    queue.running = false;
  }, [base]);

  const saveDraft = useCallback(
    (draft: StageDraft[]): void => {
      saving.current.next = draft;
      void flushDraft();
    },
    [flushDraft],
  );

  /** Ask the server for the counts of the current stages; `announce` names the stage whose status to announce. */
  const recompute = useCallback(
    async (draft: StageDraft[], changedFrom: number, announce: number | null, pinned: string | null): Promise<void> => {
      const parsed = draft.map((stage) => parseStage(stage.text));
      if (parsed.some((stage) => !stage.ok)) return;
      const mine = ++ticket.current;
      const body: JsonObject = {
        pipeline: parsed.map((stage) => (stage.ok ? stage.value : null)),
        disabled: draft.flatMap((stage, index) => (stage.disabled ? [index] : [])),
        preview: true,
      };
      if (pinned !== null) body["pin"] = pinned;
      const order = draft.map((stage) => stage.key);
      const disabled = draft.map((stage) => stage.disabled);
      try {
        const answer = await post<{ input: number; stages: { count: number; documents: JsonObject[] }[]; pin: { stopped_at: number | null } | null }>(`${base}/aggregate`, body);
        if (mine !== ticket.current) return;
        const view: Preview = {
          input: answer.input,
          order,
          disabled,
          counts: answer.stages.map((stage) => stage.count),
          documents: answer.stages.map((stage) => stage.documents),
          capped: null,
          pin: answer.pin ? { stoppedAt: answer.pin.stopped_at } : null,
          changedFrom,
        };
        setPreview(view);
        setError("");
        if (announce !== null && draft[announce]) setStatus(stageStatus(announce, draft.length, draft[announce] as StageDraft, view));
      } catch (failure) {
        if (mine !== ticket.current) return;
        const refusal = asFailure(failure);
        if (refusal.body.error === "scan_limit") {
          const limit = Number(refusal.body["limit"]);
          const view: Preview = {
            input: latest.current.count,
            order,
            disabled,
            counts: draft.map(() => limit),
            documents: draft.map(() => []),
            capped: limit,
            pin: null,
            changedFrom,
          };
          setPreview(view);
          setError(pipelineErrorText(refusal.body));
          if (announce !== null && draft[announce]) setStatus(stageStatus(announce, draft.length, draft[announce] as StageDraft, view));
        } else {
          setError(pipelineErrorText(refusal.body));
        }
      }
    },
    [base],
  );

  useEffect(() => {
    if (!cid) return;
    let current = true;
    setStages(null);
    setPreview(null);
    setError("");
    setStatus("");
    get<{ stages: string[]; disabled: number[] }>(`${base}/pipeline`).then((draft) => {
      if (!current) return;
      const loaded = draft.stages.map((text, index) => toDraft(text, draft.disabled.includes(index)));
      setStages(loaded);
      void recompute(loaded, 0, null, null);
    });
    return () => {
      current = false;
    };
  }, [cid, base, recompute]);

  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
        const draft = latest.current.stages;
        if (draft) saveDraft(draft);
      }
    },
    [saveDraft],
  );

  useLayoutEffect(() => {
    if (!preview) return;
    const targets: BandTarget[] = preview.order.map((key, index) => {
      const count = preview.counts[index] ?? 0;
      return { key, fraction: preview.disabled[index] ? null : barFraction(count, preview.input), count };
    });
    motion.update(targets, preview.changedFrom, reducedMotion());
  }, [preview, motion]);

  const change = (draft: StageDraft[], changedFrom: number, announce: number | null, immediate: boolean, message?: string): void => {
    setStages(draft);
    if (message !== undefined) setStatus(message);
    if (timer.current) clearTimeout(timer.current);
    const run = (): void => {
      timer.current = null;
      saveDraft(draft);
      void recompute(draft, changedFrom, announce, latest.current.pin);
    };
    if (immediate) run();
    else timer.current = setTimeout(run, DEBOUNCE_MS);
  };

  const add = (): void => {
    const draft = [...(latest.current.stages ?? []), toDraft(NEW_STAGE, false)];
    const created = draft[draft.length - 1] as StageDraft;
    focusAfter.current = { key: created.key, text: true };
    change(draft, draft.length - 1, draft.length - 1, true);
  };

  const edit = (index: number, text: string): void => {
    const draft = (latest.current.stages ?? []).map((stage, at) => {
      if (at !== index) return stage;
      const parsed = parseStage(text);
      return { ...stage, text, op: parsed.ok && parsed.op ? parsed.op : stage.op };
    });
    change(draft, index, index, false);
  };

  const toggle = (index: number): void => {
    const draft = (latest.current.stages ?? []).map((stage, at) => (at === index ? { ...stage, disabled: !stage.disabled } : stage));
    change(draft, index, index, true);
  };

  const move = (from: number, to: number): void => {
    const current = latest.current.stages ?? [];
    if (from === to || to < 0 || to >= current.length) return;
    const draft = [...current];
    const [taken] = draft.splice(from, 1);
    draft.splice(to, 0, taken as StageDraft);
    focusAfter.current = { key: (taken as StageDraft).key };
    change(draft, Math.min(from, to), null, true, `Stage moved to position ${displayNumber(to + 1)} of ${displayNumber(draft.length)}`);
  };

  const remove = (index: number): void => {
    const draft = (latest.current.stages ?? []).filter((_, at) => at !== index);
    const next = draft[index];
    focusAfter.current = next ? { key: next.key } : { add: true };
    change(draft, index, null, true, `Stage ${displayNumber(index + 1)} deleted`);
  };

  const setPin = (id: string | null): void => {
    setPinState(id);
    const draft = latest.current.stages ?? [];
    void recompute(draft, 0, null, id);
  };

  return { stages, preview, error, status, pinText, setPinText, pin, setPin, focusedKey, setFocusedKey, add, edit, toggle, move, remove, focusAfter };
}
