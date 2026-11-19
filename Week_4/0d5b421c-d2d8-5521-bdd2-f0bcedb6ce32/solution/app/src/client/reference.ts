// The published floor and rules never change while the app runs: each is fetched once.
import { useEffect, useState } from "react";
import type { FloorResponse, Rules } from "../shared/api.js";
import { get } from "./api.js";

const cache = new Map<string, Promise<unknown>>();

function once<Body>(path: string): Promise<Body> {
  const known = cache.get(path);
  if (known !== undefined) return known as Promise<Body>;
  const started = get<Body>(path).then((outcome) => {
    if (!outcome.ok) {
      cache.delete(path);
      throw new Error(`could not load ${path}`);
    }
    return outcome.body;
  });
  cache.set(path, started);
  return started;
}

function useFetched<Body>(path: string): Body | null {
  const [value, setValue] = useState<Body | null>(null);
  useEffect(() => {
    let live = true;
    once<Body>(path).then(
      (body) => live && setValue(body),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [path]);
  return value;
}

export const useFloor = (): FloorResponse | null => useFetched<FloorResponse>("/api/floor");
export const useRules = (): Rules | null => useFetched<Rules>("/api/rules");
