import { useEffect, useRef, useState, type RefObject } from "react";
import type { Snapshot } from "../../shared/types";
import { api } from "../lib/api";

const cache = new Map<string, Promise<Snapshot>>();

function load(id: string, revision: number): Promise<Snapshot> {
  const key = `${id}@${revision}`;
  const known = cache.get(key);
  if (known) return known;
  const pending = api.get<{ snapshot: Snapshot }>(`/api/projects/${id}`).then((body) => body.snapshot);
  cache.set(key, pending);
  pending.catch(() => cache.delete(key));
  return pending;
}

/** The snapshot of a project revision, fetched once its card nears the viewport and cached per revision. */
export function useSnapshot(id: string, revision: number): { ref: RefObject<HTMLDivElement | null>; snapshot: Snapshot | null } {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [loaded, setLoaded] = useState<{ key: string; snapshot: Snapshot } | null>(null);
  const key = `${id}@${revision}`;

  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setNear(true);
    }, { rootMargin: "200px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!near) return undefined;
    let current = true;
    load(id, revision).then(
      (snapshot) => { if (current) setLoaded({ key: `${id}@${revision}`, snapshot }); },
      () => undefined,
    );
    return () => { current = false; };
  }, [near, id, revision]);

  return { ref, snapshot: loaded?.key === key ? loaded.snapshot : null };
}
