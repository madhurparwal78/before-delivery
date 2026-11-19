import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { UNDO_DEPTH } from "../../shared/limits";
import type { SnapshotCircuit } from "../../shared/types";
import type { EditorController, EditorProps, ExportSource } from "../editors/contract";
import { emptyCircuit, normaliseCircuit } from "./model";

export interface CircuitDocument {
  circuit: SnapshotCircuit;
  /** Always the latest document, readable from timers and handlers without waiting for a render. */
  latest: MutableRefObject<SnapshotCircuit>;
  /** One undo step. Edits with the same `merge` key in a row (typing in one field) share a step. Returns whether anything changed. */
  edit: (change: (circuit: SnapshotCircuit) => SnapshotCircuit, merge?: string) => boolean;
  /** Ends a run of merged edits, so the next edit of the same field starts a new step. */
  seal: () => void;
  /** A change the simulation made (a burnt-out LED): saved with the document but not an undo step. */
  record: (next: SnapshotCircuit) => void;
}

/**
 * Owns the circuit document, its undo history (last 100 steps, not persisted) and the `EditorController`
 * the shell drives. The caller remounts it with a new `key` when `documentKey` changes.
 */
export function useCircuitDocument({ snapshot, onChange, readOnly, controllerRef }: EditorProps): CircuitDocument {
  const [circuit, setCircuit] = useState(() => normaliseCircuit(snapshot.kind === "circuit" ? snapshot : emptyCircuit()));
  const latest = useRef(circuit);
  const past = useRef<SnapshotCircuit[]>([]);
  const future = useRef<SnapshotCircuit[]>([]);
  const merging = useRef<string | null>(null);
  const listeners = useRef(new Set<() => void>());
  const live = useRef({ onChange, readOnly });
  useLayoutEffect(() => {
    live.current = { onChange, readOnly };
  }, [onChange, readOnly]);

  const notify = useCallback(() => listeners.current.forEach((listener) => listener()), []);

  const commit = useCallback((next: SnapshotCircuit) => {
    latest.current = next;
    setCircuit(next);
    live.current.onChange(next);
  }, []);

  const edit = useCallback((change: (c: SnapshotCircuit) => SnapshotCircuit, merge?: string) => {
    if (live.current.readOnly) return false;
    const before = latest.current;
    const next = change(before);
    if (next === before) return false;
    if (merge === undefined || merge !== merging.current) {
      past.current = [...past.current, before].slice(-UNDO_DEPTH);
    }
    merging.current = merge ?? null;
    future.current = [];
    commit(next);
    notify();
    return true;
  }, [commit, notify]);

  const seal = useCallback(() => {
    merging.current = null;
  }, []);

  const record = useCallback((next: SnapshotCircuit) => {
    latest.current = next;
    setCircuit(next);
    if (!live.current.readOnly) live.current.onChange(next);
  }, []);

  const controller = useMemo<EditorController>(() => {
    const step = (from: MutableRefObject<SnapshotCircuit[]>, to: MutableRefObject<SnapshotCircuit[]>) => {
      const target = from.current[from.current.length - 1];
      if (!target || live.current.readOnly) return;
      from.current = from.current.slice(0, -1);
      to.current = [...to.current, latest.current];
      merging.current = null;
      commit(target);
      notify();
    };
    const undo = () => step(past, future);
    const redo = () => step(future, past);
    return {
      undo,
      redo,
      canUndo: () => !live.current.readOnly && past.current.length > 0,
      canRedo: () => !live.current.readOnly && future.current.length > 0,
      subscribe: (listener) => {
        listeners.current.add(listener);
        return () => listeners.current.delete(listener);
      },
      handleKey: (event) => {
        if (!(event.ctrlKey || event.metaKey) || event.altKey) return false;
        const key = event.key.toLowerCase();
        if (key === "z") {
          if (event.shiftKey) redo();
          else undo();
          return true;
        }
        if (key !== "y") return false;
        redo();
        return true;
      },
      exportSource: (): ExportSource => ({ kind: "circuit", snapshot: latest.current }),
    };
  }, [commit, notify]);

  useEffect(() => {
    controllerRef.current = controller;
    return () => {
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [controller, controllerRef]);

  return { circuit, latest, edit, seal, record };
}
