import { useEffect, useState } from "react";
import { secondsLeft } from "./serverClock";

const REFRESH_MS = 200;

// Whole seconds left on the server's deadline, corrected for this device's clock; 0 once it stops running.
export function useCountdown(deadlineAt: number | null, running: boolean): number {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => tick((n) => n + 1), REFRESH_MS);
    return () => clearInterval(timer);
  }, [running]);
  return deadlineAt === null || !running ? 0 : secondsLeft(deadlineAt);
}
