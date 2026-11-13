// Named live regions. Each message replaces the last; a repeated message is re-announced.
import { useCallback, useState } from "react";

export interface Live {
  text: string;
  seq: number;
  say: (text: string) => void;
}

export function useLive(initial = ""): Live {
  const [state, setState] = useState({ text: initial, seq: 0 });
  const say = useCallback((text: string) => setState((s) => ({ text, seq: s.seq + 1 })), []);
  return { ...state, say };
}

export function LiveRegion({ name, live, className }: { name: string; live: Live; className?: string }) {
  return (
    <div role="status" aria-label={name} aria-live="polite" className={className ?? "live"}>
      <span key={live.seq}>{live.text}</span>
    </div>
  );
}
