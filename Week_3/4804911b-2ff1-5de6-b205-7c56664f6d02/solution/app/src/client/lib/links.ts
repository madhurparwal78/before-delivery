// Signed download links for notice versions: one timer per version, on the page's own clock. A link is asked for at load,
// renewed at age 30 s, dropped at age 55 s if nothing newer has come, and asked for again every 5 s while it is missing.
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { COPY } from "../../shared/copy";
import type { LinkAnswer } from "../../shared/types";
import { ApiFailure, get } from "./net";

const RENEW_MS = 30_000;
const DROP_MS = 55_000;
const RETRY_MS = 5_000;

interface Target {
  key: string;
  path: string;
}
interface Slot {
  url: string | null;
  storage: boolean;
  expired: boolean;
  seq: number;
  applied: number;
  timers: ReturnType<typeof setTimeout>[];
  startedAt: number;
}

export interface Links {
  url(key: string): string | null;
  /** the sentence the page-level print status owes the reader because of links, or "" */
  sentence: string;
  /** re-render and focus bookkeeping for a status element */
  registerStatus(el: HTMLElement | null): void;
}

export function useSignedLinks(targets: Target[]): Links {
  const slots = useRef(new Map<string, Slot>());
  const [, bump] = useState(0);
  const status = useRef<HTMLElement | null>(null);
  const focusKey = useRef<string | null>(null);
  const alive = useRef(true);
  const sig = targets.map((t) => `${t.key}=${t.path}`).join("|");

  const clear = (slot: Slot) => {
    slot.timers.forEach(clearTimeout);
    slot.timers = [];
  };

  const mint = useCallback((target: Target) => {
    const slot = slots.current.get(target.key);
    if (!slot || !alive.current) return;
    const seq = ++slot.seq;
    get<LinkAnswer>(target.path)
      .then((answer) => {
        const s = slots.current.get(target.key);
        if (!s || !alive.current || seq < s.applied) return;
        s.applied = seq;
        clear(s);
        s.url = answer.url;
        s.storage = false;
        s.expired = false;
        s.startedAt = performance.now();
        s.timers.push(setTimeout(() => mint(target), RENEW_MS));
        s.timers.push(
          setTimeout(() => {
            const cur = slots.current.get(target.key);
            if (!cur || cur.applied !== seq) return;
            drop(target, cur, false);
          }, DROP_MS),
        );
        bump((n) => n + 1);
      })
      .catch((error) => {
        const s = slots.current.get(target.key);
        if (!s || !alive.current || seq < s.applied) return;
        if (error instanceof ApiFailure && error.body.error === "storage_unavailable") {
          s.applied = seq;
          drop(target, s, true);
          return;
        }
        s.timers.push(setTimeout(() => mint(target), RETRY_MS));
      });
  }, []);

  const drop = (target: Target, slot: Slot, storage: boolean) => {
    const link = document.querySelector<HTMLElement>(`[data-link-key="${CSS.escape(target.key)}"]`);
    if (link && document.activeElement === link) {
      focusKey.current = target.key;
      status.current?.focus();
    }
    clear(slot);
    slot.url = null;
    slot.storage = storage;
    slot.expired = !storage;
    slot.timers.push(setTimeout(() => mint(target), RETRY_MS));
    bump((n) => n + 1);
  };

  useEffect(() => {
    alive.current = true;
    const wanted = new Set(targets.map((t) => t.key));
    for (const [key, slot] of slots.current) {
      if (!wanted.has(key)) {
        clear(slot);
        slots.current.delete(key);
      }
    }
    for (const t of targets) {
      if (slots.current.has(t.key)) continue;
      slots.current.set(t.key, { url: null, storage: false, expired: false, seq: 0, applied: 0, timers: [], startedAt: 0 });
      mint(t);
    }
    return () => void 0;
  }, [sig]);

  useEffect(
    () => () => {
      alive.current = false;
      for (const slot of slots.current.values()) clear(slot);
    },
    [],
  );

  // a link that comes back while focus still rests on the status gets focus again
  useEffect(() => {
    const key = focusKey.current;
    if (!key) return;
    const slot = slots.current.get(key);
    if (!slot?.url) return;
    if (document.activeElement === status.current) document.querySelector<HTMLElement>(`[data-link-key="${CSS.escape(key)}"]`)?.focus();
    focusKey.current = null;
  });

  const all = [...slots.current.values()];
  const sentence = all.some((s) => s.storage) ? COPY.storageOutage : all.some((s) => s.expired) ? COPY.expiredLink : "";
  return {
    url: (key) => slots.current.get(key)?.url ?? null,
    sentence,
    registerStatus: (el) => void (status.current = el),
  };
}
