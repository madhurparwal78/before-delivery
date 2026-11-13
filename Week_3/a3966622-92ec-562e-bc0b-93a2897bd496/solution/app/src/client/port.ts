// The port's fixed facts (route, waypoints, store date), read once per page load.
import { useEffect, useState } from "react";
import type { PortInfo } from "../shared/types";
import { get } from "./api";

let cached: Promise<PortInfo | null> | null = null;
let known: PortInfo | null = null;

/** Reads the port's facts once; the session awaits it before the first paint, so screens start with them. */
export function loadPort(): Promise<PortInfo | null> {
  cached ??= get<PortInfo>("/api/port").then((o) => (known = o.kind === "ok" ? o.data : null));
  return cached;
}

export function usePort(): PortInfo | null {
  const [port, setPort] = useState<PortInfo | null>(() => known);
  useEffect(() => {
    void loadPort().then(setPort);
  }, []);
  return port;
}
