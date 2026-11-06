// Drafts (brief: Interactions → Drafts and ended sessions): what a member types into a staff form or dialog is
// kept in the browser, keyed by member and screen, until it saves successfully.
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "./router";
import { useSession } from "./session";

function storageKey(memberId: string, path: string, form: string): string {
  return `hourline:draft:${memberId}:${path}:${form}`;
}

function read<T>(key: string): T | null {
  try {
    const text = localStorage.getItem(key);
    return text ? (JSON.parse(text) as T) : null;
  } catch {
    return null;
  }
}

interface Draft<T> {
  value: T;
  set: (next: T | ((current: T) => T)) => void;
  /** True when the first value came from a kept draft. */
  restored: boolean;
  /** Forgets the kept draft (after a successful save, or a deliberate cancel) and resets the value. */
  clear: (next?: T) => void;
}

export function useDraft<T>(form: string, initial: T): Draft<T> {
  const { member } = useSession();
  const { path } = useRouter();
  const key = member ? storageKey(member.id, path, form) : null;
  const [state, setState] = useState<{ value: T; restored: boolean }>(() => {
    const kept = key ? read<T>(key) : null;
    return kept === null ? { value: initial, restored: false } : { value: kept, restored: true };
  });
  const dirty = useRef(false);
  const initialRef = useRef(initial);
  useEffect(() => {
    if (!key || !dirty.current) return;
    localStorage.setItem(key, JSON.stringify(state.value));
  }, [key, state.value]);
  const set = useCallback((next: T | ((current: T) => T)) => {
    dirty.current = true;
    setState((s) => ({ ...s, value: typeof next === "function" ? (next as (c: T) => T)(s.value) : next }));
  }, []);
  const clear = useCallback(
    (next?: T) => {
      dirty.current = false;
      if (key) localStorage.removeItem(key);
      setState({ value: next === undefined ? initialRef.current : next, restored: false });
    },
    [key],
  );
  return { value: state.value, set, restored: state.restored, clear };
}
