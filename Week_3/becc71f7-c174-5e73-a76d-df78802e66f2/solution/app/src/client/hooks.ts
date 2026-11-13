import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { flushSync } from "react-dom";
import { ApiFailure } from "./api";
import { announce, dialogWasRestored, noteOpenForm, reducedMotion, takeRestoredValues } from "./state";

const REFRESH_MS = 5000;

export function useMedia(query: string): boolean {
  const subscribe = useCallback(
    (listener: () => void) => {
      const media = window.matchMedia(query);
      media.addEventListener("change", listener);
      return () => media.removeEventListener("change", listener);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches);
}

export interface Poll<T> {
  data: T | null;
  failure: ApiFailure | null;
  refresh: () => Promise<void>;
}

/** Reads from the server now and every five seconds; the answer to the latest request always wins, and an unchanged answer changes nothing. */
export function usePoll<T>(load: () => Promise<T>, key: string): Poll<T> {
  const [data, setData] = useState<T | null>(null);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const latest = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const shown = useRef("");
  const loader = useRef(load);
  loader.current = load;

  const tick = useCallback(async () => {
    clearTimeout(timer.current);
    latest.current += 1;
    const request = latest.current;
    try {
      const value = await loader.current();
      if (request !== latest.current) return;
      const text = JSON.stringify(value);
      if (text !== shown.current) {
        shown.current = text;
        setData(value);
      }
      setFailure(null);
    } catch (error) {
      if (request !== latest.current) return;
      if (!(error instanceof ApiFailure)) throw error;
      if (error.status !== 0 && error.status !== 401) setFailure(error);
    }
    timer.current = setTimeout(() => void tick(), REFRESH_MS);
  }, []);

  useEffect(() => {
    void tick();
    return () => {
      latest.current += 1;
      clearTimeout(timer.current);
    };
  }, [key, tick]);

  return { data, failure, refresh: tick };
}

interface Problem {
  message: string;
  fields: Record<string, string>;
}

export interface Action {
  pending: boolean;
  problem: Problem | null;
  summary: RefObject<HTMLDivElement | null>;
  run: (task: () => Promise<void>) => Promise<void>;
  /** Puts focus on this control once the press has finished; a pending button is disabled and can't hold it. */
  focusAfter: (control: HTMLElement | null) => void;
}

/** One async press: the pending state, the announcement cleared for its result, and the refusal shown in the Problems summary. */
export function useAction(): Action {
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const summary = useRef<HTMLDivElement | null>(null);

  const after = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (problem) summary.current?.focus();
  }, [problem]);

  useEffect(() => {
    if (!pending) {
      after.current?.focus();
      after.current = null;
    }
  }, [pending]);

  const focusAfter = useCallback((control: HTMLElement | null) => {
    after.current = control;
  }, []);

  const run = useCallback(async (task: () => Promise<void>) => {
    announce("");
    setProblem(null);
    setPending(true);
    try {
      await task();
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error;
      if (error.code !== "session_ended") {
        announce(error.message);
        setProblem({ message: error.message, fields: error.fields ?? {} });
      }
    } finally {
      setPending(false);
    }
  }, []);

  return { pending, problem, summary, run, focusAfter };
}

export interface DialogControl {
  name: string;
  isOpen: boolean;
  opener: RefObject<HTMLElement | null>;
  open: () => void;
  close: (options?: { returnFocus?: boolean }) => void;
}

export function useDialog(name: string): DialogControl {
  const [isOpen, setOpen] = useState(() => dialogWasRestored(name));
  const opener = useRef<HTMLElement | null>(null);
  const open = useCallback(() => setOpen(true), []);
  const close = useCallback(({ returnFocus = true } = {}) => {
    flushSync(() => setOpen(false));
    if (returnFocus) opener.current?.focus();
  }, []);
  return { name, isOpen, opener, open, close };
}

interface OverlayPhase {
  mounted: boolean;
  closing: boolean;
  /** Counts each opening, so a dialog's form starts fresh. */
  opening: number;
  onAnimationEnd: () => void;
}

/** Keeps a closed overlay on screen only for its closing animation; reopening during it simply cancels it, and no timer exists to undo that. */
export function useOverlayPhase(open: boolean): OverlayPhase {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  const [opening, setOpening] = useState(0);
  if (open && !mounted) {
    setMounted(true);
    setOpening(opening + 1);
  }
  if (open && closing) {
    setClosing(false);
    setOpening(opening + 1);
  }
  if (!open && mounted && !closing) {
    if (reducedMotion()) setMounted(false);
    else setClosing(true);
  }
  const onAnimationEnd = useCallback(() => {
    setClosing(false);
    setMounted(false);
  }, []);
  return { mounted, closing, opening, onAnimationEnd };
}

type FieldValues<K extends string> = Record<K, string>;

export interface Fields<K extends string> {
  values: FieldValues<K>;
  set: (name: K, value: string) => void;
}

/** A form's typed values, noted so an ended session can bring them back. Password fields are never noted. */
export function useFields<K extends string>(dialog: string, initial: FieldValues<K>, secret: readonly string[] = []): Fields<K> {
  const [values, setValues] = useState<FieldValues<K>>(() => ({ ...initial, ...takeRestoredValues(dialog) }));
  useEffect(() => {
    const kept = Object.fromEntries(Object.entries<string>(values).filter(([name]) => !secret.includes(name)));
    noteOpenForm({ dialog, values: kept });
    return () => noteOpenForm(null);
  }, [dialog, values, secret]);
  const set = useCallback((name: K, value: string) => setValues((current) => ({ ...current, [name]: value })), []);
  return { values, set };
}
