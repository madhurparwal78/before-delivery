import { createContext, type JSX } from 'preact';
import { useContext, useEffect, useState } from 'preact/hooks';

export interface ShellState {
  name: string;
  target: string | null;
  fallback: string | null;
}

export const ShellContext = createContext<(state: ShellState) => void>(() => {});

/** Sets the sticky band's context name and countdown target for the current screen. */
export function useShell(name: string, target: string | null, fallback: string | null = null): void {
  const setShell = useContext(ShellContext);
  useEffect(() => {
    setShell({ name, target, fallback });
  }, [setShell, name, target, fallback]);
}

function parts(remaining: number): string {
  const seconds = Math.floor(remaining / 1000);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${days}d ${pad(hours)}:${pad(minutes)}:${pad(rest)}`;
}

export function Countdown({ target }: { target: string }): JSX.Element {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [target]);
  const remaining = new Date(target).getTime() - now;
  const urgent = remaining > 0 && remaining < 86_400_000;
  return (
    <span class="band-timer" role="timer" aria-label="Time remaining" data-urgent={urgent ? 'true' : 'false'}>
      {remaining <= 0 ? 'Closed' : parts(remaining)}
    </span>
  );
}

export function useCountdownPassed(target: string | null, onPassed: () => void): void {
  useEffect(() => {
    if (target === null) return undefined;
    const remaining = new Date(target).getTime() - Date.now();
    if (remaining <= 0) return undefined;
    const timer = window.setTimeout(onPassed, remaining + 250);
    return () => window.clearTimeout(timer);
  }, [target, onPassed]);
}
