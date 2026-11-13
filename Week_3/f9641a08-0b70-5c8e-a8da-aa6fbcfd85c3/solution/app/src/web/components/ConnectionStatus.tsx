import { useApp } from "../lib/store";

/** `status "Connection"`: a notice while the live stream is down, empty once back. */
export function ConnectionStatus() {
  const { connected } = useApp();
  return (
    <div role="status" aria-label="Connection" aria-live="polite" className={connected ? "sr-only" : "connection"}>
      {connected ? "" : "Reconnecting to live updates."}
    </div>
  );
}
